'use strict';

/*
 * Pluggable blob store for images (docs/setup.md, "Image storage"): one
 * interface — `put(key, bytes, contentType)`, `get(key)` → `{ bytes,
 * contentType } | null`, `delete(key)` — and four drivers: `s3` when
 * RDS_BLOB_URL is set, else `local` (RDS_DATA_DIR/blobs) with RDS_STORE=local,
 * `postgres` (the `blob` table) with DATABASE_URL, `memory` otherwise.
 */
const path = require('node:path');
const { MemoryBlobs } = require('./memory');
const { LocalBlobs } = require('./local');
const { PostgresBlobs } = require('./postgres');
const { S3Blobs } = require('./s3');

/**
 * @typedef {{ driver: string, put(key: string, bytes: Buffer, contentType: string): Promise<void>,
 *   get(key: string): Promise<{ bytes: Buffer, contentType: string } | null>, delete(key: string): Promise<void> }} BlobStore
 */

/**
 * The blob store for `config` (loadConfig) and the data `store`.
 * @param {{ config: any, store: any }} deps
 * @returns {BlobStore}
 */
function createBlobStore({ config, store }) {
  const blob = config.blob || {};
  if (blob.url) {
    return new S3Blobs({
      url: blob.url, endpoint: blob.endpoint, region: blob.region, accessKeyId: blob.accessKeyId,
      secretAccessKey: blob.secretAccessKey, pathStyle: blob.pathStyle,
    });
  }
  if (config.store === 'local') return new LocalBlobs({ dir: path.join(config.dataDir, 'blobs') });
  if (config.store !== 'memory' && store && typeof store.query === 'function') return new PostgresBlobs({ db: store, maxBytes: blob.maxBytes });
  return new MemoryBlobs();
}

module.exports = { createBlobStore, MemoryBlobs, LocalBlobs, PostgresBlobs, S3Blobs };
