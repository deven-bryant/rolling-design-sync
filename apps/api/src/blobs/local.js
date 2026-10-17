'use strict';

/*
 * Local-disk blob driver (RDS_STORE=local): one file per key under
 * `RDS_DATA_DIR/blobs`, plus a `.type` sidecar with the content type. Keys are
 * `/`-separated segments of [A-Za-z0-9._-].
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const { ensureDataDir } = require('../config');

const SEGMENT = /^[A-Za-z0-9._-]+$/;

class LocalBlobs {
  /** @param {{ dir: string }} options */
  constructor({ dir }) {
    this.driver = 'local';
    this.dir = path.resolve(dir);
  }

  file(key) {
    const parts = String(key).split('/');
    if (!parts.every(p => SEGMENT.test(p) && p !== '.' && p !== '..')) throw new Error(`Invalid blob key: ${key}`);
    return path.join(this.dir, ...parts);
  }

  async put(key, bytes, contentType) {
    const file = this.file(key);
    ensureDataDir(path.dirname(file));
    await fs.writeFile(`${file}.type`, String(contentType), { mode: 0o600 });
    await fs.writeFile(file, bytes, { mode: 0o600 });
  }

  async get(key) {
    const file = this.file(key);
    try {
      const [bytes, contentType] = await Promise.all([fs.readFile(file), fs.readFile(`${file}.type`, 'utf8')]);
      return { bytes, contentType };
    } catch (err) {
      if (err && err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async delete(key) {
    const file = this.file(key);
    await Promise.all([fs.rm(file, { force: true }), fs.rm(`${file}.type`, { force: true })]);
  }
}

module.exports = { LocalBlobs };
