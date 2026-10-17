'use strict';

/*
 * S3-compatible blob driver (RDS_BLOB_URL=s3://bucket/prefix): AWS S3,
 * Cloudflare R2, Supabase Storage, MinIO. Plain fetch + AWS Signature V4; the
 * credentials are never logged or put in an error message.
 */
const { createHash, createHmac } = require('node:crypto');

const sha256 = data => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
const encodeKey = key => key.split('/').map(s => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');

/** Parses `s3://bucket/prefix`; throws a startup error otherwise. */
function parseBlobUrl(url) {
  const m = /^s3:\/\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])(?:\/(.*))?$/.exec(String(url || ''));
  if (!m) throw new Error(`RDS_BLOB_URL: '${url}' is not an s3://<bucket>/<prefix> URL.`);
  return { bucket: m[1], prefix: (m[2] || '').replace(/^\/+|\/+$/g, '') };
}

class S3Blobs {
  // Private: the credentials never show up in a log or inspect() of the driver.
  #secrets;
  #fetch;

  /**
   * @param {{ url: string, endpoint?: string, region?: string, accessKeyId: string, secretAccessKey: string, pathStyle?: boolean, fetchImpl?: typeof fetch }} options
   */
  constructor({ url, endpoint = '', region = 'us-east-1', accessKeyId, secretAccessKey, pathStyle = false, fetchImpl = globalThis.fetch }) {
    this.driver = 's3';
    const { bucket, prefix } = parseBlobUrl(url);
    this.bucket = bucket;
    this.prefix = prefix;
    this.region = region || 'us-east-1';
    const base = new URL(endpoint || `https://s3.${this.region}.amazonaws.com`);
    this.pathStyle = !!pathStyle;
    this.origin = this.pathStyle ? `${base.protocol}//${base.host}` : `${base.protocol}//${bucket}.${base.host}`;
    this.basePath = this.pathStyle ? `/${bucket}` : '';
    this.#secrets = { accessKeyId, secretAccessKey };
    this.#fetch = fetchImpl;
  }

  objectPath(key) { return `${this.basePath}/${encodeKey(this.prefix ? `${this.prefix}/${key}` : key)}`; }

  /**
   * @param {string} method
   * @param {string} key
   * @param {{ body?: Buffer | null, contentType?: string | null }} [options]
   */
  async send(method, key, { body = null, contentType = null } = {}) {
    const path = this.objectPath(key);
    const url = new URL(this.origin + path);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const day = amzDate.slice(0, 8);
    const payloadHash = sha256(body || '');
    /** @type {Record<string, string>} */
    const headers = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
    if (contentType) headers['content-type'] = contentType;
    const names = Object.keys(headers).sort();
    const canonical = [method, path, '', ...names.map(n => `${n}:${headers[n]}`), '', names.join(';'), payloadHash].join('\n');
    const scope = `${day}/${this.region}/s3/aws4_request`;
    const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
    let key2 = hmac(`AWS4${this.#secrets.secretAccessKey}`, day);
    for (const part of [this.region, 's3', 'aws4_request']) key2 = hmac(key2, part);
    const signature = createHmac('sha256', key2).update(toSign).digest('hex');
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.#secrets.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
    const { host: _host, ...sent } = headers;
    return this.#fetch(url.toString(), { method, headers: sent, ...(body ? { body } : {}) });
  }

  async put(key, bytes, contentType) {
    const res = await this.send('PUT', key, { body: Buffer.from(bytes), contentType });
    if (!res.ok) throw new Error(`S3 PUT failed for blob ${key}: HTTP ${res.status}`);
  }

  async get(key) {
    const res = await this.send('GET', key);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`S3 GET failed for blob ${key}: HTTP ${res.status}`);
    return { bytes: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') || 'application/octet-stream' };
  }

  async delete(key) {
    const res = await this.send('DELETE', key);
    if (!res.ok && res.status !== 404) throw new Error(`S3 DELETE failed for blob ${key}: HTTP ${res.status}`);
  }
}

module.exports = { S3Blobs, parseBlobUrl };
