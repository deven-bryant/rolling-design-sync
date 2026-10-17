'use strict';

/*
 * Postgres blob driver (the default with DATABASE_URL): rows of the `blob`
 * table. The table is size-capped: a put that would take the total over
 * `maxBytes` fails with `blob_store_full`.
 */
const { problem } = require('../v3/problem');

class PostgresBlobs {
  /** @param {{ db: { query: Function }, maxBytes: number }} options */
  constructor({ db, maxBytes }) {
    this.driver = 'postgres';
    this.db = db;
    this.maxBytes = maxBytes;
  }

  async put(key, bytes, contentType) {
    const size = bytes.length;
    const { rows: [row] } = await this.db.query(
      `with used as (select coalesce(sum(size), 0)::bigint as total from blob where key <> $1)
       insert into blob (key, content_type, size, bytes)
       select $1, $2, $3, $4 from used where used.total + $3 <= $5
       on conflict (key) do update set content_type = excluded.content_type, size = excluded.size, bytes = excluded.bytes, created_at = now()
       returning key`,
      [key, contentType, size, bytes, this.maxBytes]);
    if (!row) {
      throw problem('blob_store_full', `The image store is full (RDS_BLOB_MAX_BYTES=${this.maxBytes}).`, {
        hint: 'Delete notes or screens with images, raise RDS_BLOB_MAX_BYTES, or configure an S3-compatible bucket with RDS_BLOB_URL.',
      });
    }
  }

  async get(key) {
    const { rows: [row] } = await this.db.query('select content_type, bytes from blob where key = $1', [key]);
    return row ? { bytes: Buffer.from(row.bytes), contentType: row.content_type } : null;
  }

  async delete(key) { await this.db.query('delete from blob where key = $1', [key]); }
}

module.exports = { PostgresBlobs };
