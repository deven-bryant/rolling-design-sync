'use strict';

/*
 * Blob drivers (memory, local disk, Postgres via PGlite, S3 against a fake),
 * image validation / re-encoding and the render diff + heatmap.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const util = require('node:util');
const sharp = require('sharp');
const { MemoryBlobs, LocalBlobs, PostgresBlobs, S3Blobs, createBlobStore } = require('../src/blobs');
const { parseBlobUrl } = require('../src/blobs/s3');
const { openLocalStore } = require('../src/store/pglite');
const { loadConfig } = require('../src/config');
const images = require('../src/images');
const { compareImages, heatmap, MAX_REGIONS } = require('../src/renderDiff');

async function roundTrip(blobs) {
  assert.equal(await blobs.get('a/missing'), null);
  await blobs.put('f/a.png', Buffer.from([1, 2, 3]), 'image/png');
  assert.deepEqual(await blobs.get('f/a.png'), { bytes: Buffer.from([1, 2, 3]), contentType: 'image/png' });
  await blobs.put('f/a.png', Buffer.from([4]), 'image/webp');
  assert.deepEqual(await blobs.get('f/a.png'), { bytes: Buffer.from([4]), contentType: 'image/webp' });
  await blobs.delete('f/a.png');
  assert.equal(await blobs.get('f/a.png'), null);
  await blobs.delete('f/a.png');
}

test('memory and local blob drivers', async t => {
  await roundTrip(new MemoryBlobs());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fds-blobs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await roundTrip(new LocalBlobs({ dir }));
});

test('postgres blob driver (PGlite) is size-capped', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fds-blobs-pg-'));
  const { store } = await openLocalStore({ dataDir: path.join(dir, 'data') });
  t.after(async () => { await store.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const db = /** @type {any} */ (store);
  await roundTrip(new PostgresBlobs({ db, maxBytes: 10 }));
  const small = new PostgresBlobs({ db, maxBytes: 4 });
  await small.put('x', Buffer.alloc(3), 'image/png');
  await small.put('x', Buffer.alloc(4), 'image/png');
  await assert.rejects(small.put('y', Buffer.alloc(1), 'image/png'), err => err.code === 'blob_store_full');
});

test('s3 blob driver signs requests and never leaks credentials', async () => {
  const objects = new Map();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const key = new URL(url).pathname;
    if (init.method === 'PUT') { objects.set(key, { body: Buffer.from(init.body), type: init.headers['content-type'] }); return new Response(null, { status: 200 }); }
    if (init.method === 'DELETE') { objects.delete(key); return new Response(null, { status: 204 }); }
    const found = objects.get(key);
    if (key.includes('boom')) return new Response('nope', { status: 500 });
    return found ? new Response(found.body, { status: 200, headers: { 'content-type': found.type } }) : new Response(null, { status: 404 });
  };
  const s3 = new S3Blobs({ url: 's3://my-bucket/rds', endpoint: 'http://127.0.0.1:9000', region: 'auto', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'shhh-secret', pathStyle: true, fetchImpl });
  await roundTrip(s3);
  assert.match(calls[1].url, /^http:\/\/127\.0\.0\.1:9000\/my-bucket\/rds\/f\/a\.png$/);
  const auth = calls[1].init.headers.authorization;
  assert.match(auth, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(calls).includes('shhh-secret'));
  assert.ok(!util.inspect(s3, { depth: 5 }).includes('shhh-secret'));
  assert.ok(!JSON.stringify(s3).includes('shhh-secret'));
  await assert.rejects(s3.get('boom'), err => !String(err.message).includes('shhh') && /HTTP 500/.test(err.message));
  const hosted = new S3Blobs({ url: 's3://bucket-1', region: 'eu-west-1', accessKeyId: 'a', secretAccessKey: 'b', fetchImpl });
  await hosted.put('k', Buffer.from('x'), 'image/png');
  assert.equal(calls.at(-1).url, 'https://bucket-1.s3.eu-west-1.amazonaws.com/k');
  assert.throws(() => parseBlobUrl('http://x/y'), /s3:\/\//);
});

test('blob driver selection and RDS_BLOB_* validation', () => {
  assert.equal(createBlobStore({ config: loadConfig({}), store: null }).driver, 'memory');
  assert.equal(createBlobStore({ config: { ...loadConfig({}), store: 'local', dataDir: os.tmpdir() }, store: null }).driver, 'local');
  assert.equal(createBlobStore({ config: { ...loadConfig({}), store: 'postgres' }, store: { query() {} } }).driver, 'postgres');
  const cfg = loadConfig({ RDS_BLOB_URL: 's3://bkt/p', RDS_BLOB_ACCESS_KEY_ID: 'id', RDS_BLOB_SECRET_ACCESS_KEY: 'sec', RDS_BLOB_ENDPOINT: 'https://acct.r2.example' });
  assert.equal(createBlobStore({ config: cfg, store: null }).driver, 's3');
  assert.throws(() => loadConfig({ RDS_BLOB_URL: 's3://bkt/p' }), /RDS_BLOB_ACCESS_KEY_ID/);
  assert.throws(() => loadConfig({ RDS_BLOB_URL: 'bkt/p', RDS_BLOB_ACCESS_KEY_ID: 'id', RDS_BLOB_SECRET_ACCESS_KEY: 'sec' }), /RDS_BLOB_URL/);
  assert.throws(() => loadConfig({ RDS_BLOB_URL: 's3://bkt/p', RDS_BLOB_ACCESS_KEY_ID: 'id', RDS_BLOB_SECRET_ACCESS_KEY: 'sec', RDS_BLOB_ENDPOINT: 'ftp://x' }), /RDS_BLOB_ENDPOINT/);
  let msg = '';
  try { loadConfig({ RDS_BLOB_URL: 's3://bkt/p', RDS_BLOB_ACCESS_KEY_ID: 'id', RDS_BLOB_SECRET_ACCESS_KEY: 'sec', RDS_BLOB_ENDPOINT: 'ftp://x' }); } catch (err) { msg = err.message; }
  assert.ok(!msg.includes('sec'.repeat(1) + '\'') && !msg.includes('=sec'));
});

const solid = (width, height, rgb = [255, 255, 255]) => {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...rgb, 255], i * 4);
  return { data, width, height };
};
const paint = (img, { x, y, width, height }, rgb) => {
  for (let j = y; j < y + height; j++) for (let i = x; i < x + width; i++) img.data.set([...rgb, 255], (j * img.width + i) * 4);
  return img;
};

test('images: sniffs PNG/JPEG/WebP, rejects the rest, re-encodes without metadata, thumbnails', async () => {
  const png = await sharp({ create: { width: 1000, height: 500, channels: 3, background: '#f00' } }).png().toBuffer();
  const jpeg = await sharp(png).jpeg().withMetadata({ exif: { IFD0: { Copyright: 'gps-here' } } }).toBuffer();
  const webp = await sharp(png).webp().toBuffer();
  assert.equal(images.sniff(png), 'png');
  assert.equal(images.sniff(jpeg), 'jpeg');
  assert.equal(images.sniff(webp), 'webp');
  for (const bad of ['<svg xmlns="http://www.w3.org/2000/svg"></svg>', '<!doctype html><html>', 'GIF89a......']) {
    await assert.rejects(images.processImage(Buffer.from(bad), { field: 'f', maxBytes: 1e6 }), err => err.code === 'invalid_image');
  }
  await assert.rejects(images.processImage(png, { field: 'f', maxBytes: 10 }), err => err.code === 'image_too_large');
  await assert.rejects(images.processImage(png.subarray(0, 40), { field: 'f', maxBytes: 1e6 }), err => err.code === 'invalid_image');
  const huge = await sharp({ create: { width: images.MAX_SIDE + 1, height: 1, channels: 3, background: '#000' } }).png().toBuffer();
  await assert.rejects(images.processImage(huge, { field: 'f', maxBytes: 1e8 }), err => err.code === 'image_too_large' || err.code === 'invalid_image');
  const out = await images.processImage(jpeg, { field: 'f', maxBytes: 1e7 });
  assert.equal(out.contentType, 'image/webp');
  assert.deepEqual([out.width, out.height], [1000, 500]);
  assert.ok(!out.bytes.includes(Buffer.from('gps-here')));
  assert.equal((await sharp(out.bytes).metadata()).exif, undefined);
  const thumb = await sharp(out.thumb.bytes).metadata();
  assert.equal(thumb.width, images.THUMB_WIDTH);
  assert.match(out.sha256, /^[0-9a-f]{64}$/);
  await assert.rejects(images.processImage(jpeg, { field: 'f', maxBytes: 1e7, only: ['png'] }), err => err.code === 'invalid_image');
});

test('render diff: identical, masks, antialiasing, size mismatch, regions, heatmap', async () => {
  const ref = solid(100, 80);
  assert.equal(compareImages(ref, solid(100, 80)).score, 0);
  const nearly = paint(solid(100, 80), { x: 0, y: 0, width: 100, height: 80 }, [252, 253, 251]);
  assert.equal(compareImages(ref, nearly).score, 0, 'tiny colour noise is tolerated');
  const box = paint(solid(100, 80), { x: 10, y: 20, width: 20, height: 10 }, [0, 0, 0]);
  const diff = compareImages(ref, box);
  assert.equal(diff.different, 200);
  assert.equal(diff.score, 2.5);
  assert.deepEqual(diff.regions, [{ x: 10, y: 20, width: 20, height: 10, pixels: 200 }]);
  assert.equal(compareImages(ref, box, { masks: [{ x: 5, y: 15, width: 30, height: 20 }] }).different, 0);
  const two = paint(paint(solid(100, 80), { x: 0, y: 0, width: 5, height: 5 }, [0, 0, 0]), { x: 7, y: 0, width: 5, height: 5 }, [0, 0, 0]);
  assert.equal(compareImages(ref, two).regions.length, 1, 'regions within 8 px merge');
  const short = compareImages(ref, solid(100, 60));
  assert.equal(short.sizeMatch, false);
  assert.equal(short.different, 2000);
  assert.equal(short.score, 25);
  const many = solid(100, 80);
  for (let i = 0; i < 12; i++) paint(many, { x: (i % 4) * 25, y: Math.floor(i / 4) * 27, width: 2, height: 2 }, [0, 0, 0]);
  assert.ok(compareImages(ref, many).regions.length <= MAX_REGIONS);
  const heat = heatmap(box, diff);
  assert.deepEqual([heat.width, heat.height], [100, 80]);
  const at = (x, y) => [...heat.data.subarray((y * 100 + x) * 4, (y * 100 + x) * 4 + 3)];
  const hot = at(15, 25);
  const cold = at(80, 70);
  assert.ok(hot[0] > hot[2], `hot ${hot}`);
  assert.equal(cold[0], cold[1], 'unchanged pixels are grey');
  const png = await images.encodeRgba(heat);
  assert.equal(images.sniff(png.bytes || png), 'png');
});

const FIXTURES = path.join(__dirname, 'fixtures', 'render-diff');
const fixture = name => images.decodeRgba(fs.readFileSync(path.join(FIXTURES, `${name}.png`)));

test('render diff: anti-aliasing is ignored, real differences still count', async () => {
  const shifted = paint(solid(100, 80), { x: 11, y: 20, width: 20, height: 10 }, [0, 0, 0]);
  const box = paint(solid(100, 80), { x: 10, y: 20, width: 20, height: 10 }, [0, 0, 0]);
  const moved = compareImages(box, shifted);
  assert.equal(moved.different, 20, 'a solid block shifted by 1 px: both hard edges count');
  assert.equal(moved.antialiased, 0);
  const recoloured = compareImages(box, paint(solid(100, 80), { x: 10, y: 20, width: 20, height: 10 }, [200, 0, 0]));
  assert.equal(recoloured.different, 200, 'a colour change on a flat area counts');
  assert.equal(compareImages(solid(100, 80), box).different, 200, 'a missing element counts');

  // The same text, 13 px, cropped to it (170×22).
  const text = await fixture('text');
  const subpixel = compareImages(text, await fixture('text-subpixel'));
  assert.ok(subpixel.score < 1, `0.4 px sub-pixel offset: ${subpixel.score}%`);
  assert.ok(subpixel.antialiased > subpixel.different * 10, `${subpixel.antialiased} ignored, ${subpixel.different} counted`);
  for (const name of ['text-missing-word', 'text-bold', 'text-wrong-letter']) {
    const diff = compareImages(text, await fixture(name));
    assert.ok(diff.score > 1, `${name}: ${diff.score}%`);
    assert.ok(diff.regions.length > 0, name);
  }
  const missing = compareImages(text, await fixture('text-missing-word'));
  assert.ok(missing.regions[0].x >= 100, 'the missing word is where the difference is');

  // Regression: Figma's export vs the browser's render of the same component (563×90).
  const ref = await fixture('claim-holder-reference');
  const built = await fixture('claim-holder-built');
  const claim = compareImages(ref, built);
  assert.ok(claim.score <= 1, `Claim Holder: ${claim.score}%`);
  assert.ok((claim.different + claim.antialiased) / claim.compared > 0.04, 'without the detector it would fail');

  const heat = heatmap(built, claim);
  const p = claim.aa.findIndex(Boolean);
  const [r, g, b] = heat.data.subarray(p * 4, p * 4 + 3);
  assert.ok(Math.abs(r - g) < 20 && b >= r, `ignored pixels are a faint neutral colour, not the hot scale: ${[r, g, b]}`);
});
