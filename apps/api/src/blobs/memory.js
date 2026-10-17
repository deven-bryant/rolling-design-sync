'use strict';

/** In-process blob driver (RDS_STORE=memory and tests). */
class MemoryBlobs {
  constructor() {
    this.driver = 'memory';
    this.blobs = new Map();
  }

  async put(key, bytes, contentType) { this.blobs.set(key, { bytes: Buffer.from(bytes), contentType }); }

  async get(key) {
    const found = this.blobs.get(key);
    return found ? { bytes: Buffer.from(found.bytes), contentType: found.contentType } : null;
  }

  async delete(key) { this.blobs.delete(key); }
}

module.exports = { MemoryBlobs };
