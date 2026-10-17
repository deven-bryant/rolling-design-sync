'use strict';

/*
 * Uploaded images (docs/api-v3-design.md, "Note screenshots"): only PNG, JPEG
 * and WebP, recognized by their magic bytes (never by a name or a declared
 * type), at most RDS_IMAGE_MAX_BYTES and 8192 px a side. Every image is
 * decoded and re-encoded, which drops EXIF and other metadata and anything
 * appended to the file, and gets a thumbnail at most 480 px wide.
 */
const { createHash } = require('node:crypto');
const sharp = require('sharp');
const { problem } = require('./v3/problem');

const MAX_SIDE = 8192;
const THUMB_WIDTH = 480;
const TYPES = Object.freeze({ png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' });

sharp.cache(false);

/** The image format from the magic bytes; null for anything else (SVG, HTML, GIF, …). */
function sniff(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Decodes the base64 `data` of an upload; `field` names it in errors. */
function decodeBase64(data, field) {
  if (typeof data !== 'string' || !data) throw problem('invalid_image', `${field}: expected base64 image data.`, { hint: 'Send the PNG, JPEG or WebP file as base64.' });
  const clean = data.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(clean)) throw problem('invalid_image', `${field}: not valid base64.`, { hint: 'Send the PNG, JPEG or WebP file as base64.' });
  return Buffer.from(clean, clean.includes('-') || clean.includes('_') ? 'base64url' : 'base64');
}

/**
 * Validates and re-encodes `bytes`.
 * @param {Buffer} bytes
 * @param {{ field: string, maxBytes: number, format?: 'png' | 'webp', only?: string[] }} options
 *   `format`: the stored encoding (default: WebP, PNG for PNG input); `only`: accepted input formats.
 * @returns {Promise<{ bytes: Buffer, contentType: string, width: number, height: number, sha256: string, thumb: { bytes: Buffer, contentType: string } }>}
 */
async function processImage(bytes, { field, maxBytes, format, only = Object.keys(TYPES) }) {
  if (bytes.length > maxBytes) {
    throw problem('image_too_large', `${field}: ${bytes.length} bytes is over the ${maxBytes}-byte limit.`, { hint: 'Send a smaller image (crop it or lower the resolution).' });
  }
  const kind = sniff(bytes);
  if (!kind || !only.includes(kind)) {
    throw problem('invalid_image', `${field}: not a ${only.map(k => k.toUpperCase()).join(', ')} image.`, {
      hint: `Send ${only.map(k => k.toUpperCase()).join(', ')}; other formats (SVG, GIF, HTML, …) are rejected.`,
    });
  }
  let meta;
  try { meta = await sharp(bytes, { limitInputPixels: MAX_SIDE * MAX_SIDE }).metadata(); }
  catch (_) { throw problem('invalid_image', `${field}: the image could not be decoded.`, { hint: 'Send an intact PNG, JPEG or WebP file.' }); }
  const width = meta.autoOrient ? meta.autoOrient.width : meta.width;
  const height = meta.autoOrient ? meta.autoOrient.height : meta.height;
  if (!width || !height || width > MAX_SIDE || height > MAX_SIDE) {
    throw problem('image_too_large', `${field}: ${width}×${height} px is over the ${MAX_SIDE} px limit per side.`, { hint: `Send an image at most ${MAX_SIDE} px wide and tall.` });
  }
  const out = format || (kind === 'png' ? 'png' : 'webp');
  try {
    const base = () => sharp(bytes, { limitInputPixels: MAX_SIDE * MAX_SIDE }).rotate();
    const encoded = out === 'png' ? await base().png().toBuffer() : await base().webp({ quality: 90 }).toBuffer();
    const thumb = await base().resize({ width: THUMB_WIDTH, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    return {
      bytes: encoded, contentType: TYPES[out], width, height,
      sha256: createHash('sha256').update(encoded).digest('hex'),
      thumb: { bytes: thumb, contentType: TYPES.webp },
    };
  } catch (_) {
    throw problem('invalid_image', `${field}: the image could not be decoded.`, { hint: 'Send an intact PNG, JPEG or WebP file.' });
  }
}

/** Raw RGBA pixels of a stored image. */
async function decodeRgba(bytes) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** PNG + thumbnail of raw RGBA pixels (a heatmap). */
async function encodeRgba({ data, width, height }) {
  const raw = { raw: { width, height, channels: /** @type {4} */ (4) } };
  const bytes = await sharp(data, raw).png().toBuffer();
  const thumb = await sharp(data, raw).resize({ width: THUMB_WIDTH, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  return {
    bytes, contentType: TYPES.png, width, height, sha256: createHash('sha256').update(bytes).digest('hex'),
    thumb: { bytes: thumb, contentType: TYPES.webp },
  };
}

module.exports = { sniff, decodeBase64, processImage, decodeRgba, encodeRgba, MAX_SIDE, THUMB_WIDTH, TYPES };
