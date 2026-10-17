'use strict';

/*
 * Stored images (docs/api-v3-design.md, "Note screenshots"): an attachment is
 * one re-encoded image plus its thumbnail, kept in the blob store (blobs/) and
 * served only by `GET /v3/files/{fileKey}/attachments/{attachmentId}` to a
 * signed-in caller. Blobs are written before the row's transaction and deleted
 * after it, so a failed write leaves no orphan row (orphan blobs are removed
 * best-effort).
 */
const { randomUUID } = require('node:crypto');
const { fileSettings } = require('../nodeService');
const { decodeBase64, processImage } = require('../images');
const address = require('./address');
const schemas = require('./schemas');
const { problem } = require('./problem');

const SIZES = ['full', 'thumb'];

const attachmentPath = (fileKey, attachmentId) => `/v3/files/${encodeURIComponent(fileKey)}/attachments/${attachmentId}`;

/** The public shape of an attachment: metadata plus its authenticated URLs. */
function attachmentOut(a) {
  if (!a) return null;
  const url = attachmentPath(a.fileKey, a.attachmentId);
  return {
    attachmentId: a.attachmentId, kind: a.kind, contentType: a.contentType, size: a.size, width: a.width, height: a.height,
    url, thumbUrl: a.thumbKey ? `${url}?size=thumb` : null, createdBy: a.createdBy, createdAt: a.createdAt,
  };
}

const attachmentSchema = schemas.attachment;

/** Throws images_disabled when the file's `storeImages` setting is off. */
async function assertImagesEnabled(store, fileKey) {
  const [file] = await store.listFiles({ fileKey });
  if (file && !fileSettings(file).storeImages) {
    throw problem('images_disabled', `File ${fileKey} does not store images (settings.storeImages is false).`, {
      hint: 'Send the request without images, or have an agent set storeImages to true with update_file_settings.',
    });
  }
}

/**
 * Decodes + validates + re-encodes a base64 upload.
 * @param {string} data
 * @param {{ field: string, config: any, format?: 'png' | 'webp', only?: string[] }} options
 */
async function prepareImage(data, { field, config, format, only }) {
  return processImage(decodeBase64(data, field), { field, maxBytes: config.imageMaxBytes || 5 * 1024 * 1024, format, only });
}

/**
 * Writes a processed image's blobs; returns the attachment row to insert.
 * @param {import('../blobs').BlobStore} blobs
 */
async function putImage(blobs, { fileKey, ownerKind, ownerId, kind, image, by, at }) {
  const attachmentId = randomUUID();
  const blobKey = `${fileKey}/${attachmentId}`;
  const thumbKey = `${blobKey}.thumb`;
  await blobs.put(blobKey, image.bytes, image.contentType);
  await blobs.put(thumbKey, image.thumb.bytes, image.thumb.contentType);
  return {
    attachmentId, fileKey, ownerKind, ownerId, kind, contentType: image.contentType, size: image.bytes.length,
    width: image.width, height: image.height, sha256: image.sha256, blobKey, thumbKey, createdBy: by, createdAt: at,
  };
}

/**
 * Deletes the blobs of `attachments`, best-effort (logs and keeps going).
 * @param {import('../blobs').BlobStore} blobs
 * @param {any[]} attachments
 * @param {any} [log]
 */
async function deleteBlobs(blobs, attachments, log = null) {
  for (const a of attachments) {
    for (const key of [a.blobKey, a.thumbKey].filter(Boolean)) {
      try { await blobs.delete(key); } catch (err) { if (log) log.warn({ err, attachmentId: a.attachmentId }, 'blob delete failed'); }
    }
  }
}

/** Attachments by owner id for `ownerIds`. */
async function attachmentsByOwner(store, fileKey, ownerKind, ownerIds) {
  const byOwner = new Map();
  if (!ownerIds.length) return byOwner;
  for (const a of await store.listAttachments(fileKey, ownerKind, ownerIds)) {
    if (!byOwner.has(a.ownerId)) byOwner.set(a.ownerId, []);
    byOwner.get(a.ownerId).push(attachmentOut(a));
  }
  return byOwner;
}

/** Sets `attachments` on each note. */
async function withNoteAttachments(store, fileKey, notes) {
  const byOwner = await attachmentsByOwner(store, fileKey, 'note', notes.map(n => n.noteId));
  for (const n of notes) n.attachments = byOwner.get(n.noteId) || [];
  return notes;
}

const getAttachment = {
  summary: 'Get an attached image',
  description: [
    'The bytes of a stored image: a note screenshot, a screen\'s reference image or a render check\'s built screenshot or heatmap. `size=thumb` returns the thumbnail (WebP, at most 480 px wide).',
    'Any signed-in caller (agent, viewer, portal session) of the file; served with `cache-control: private` and `x-content-type-options: nosniff`.',
  ].join(' '),
  tags: schemas.listNodes.tags,
  security: schemas.listNodes.security,
  ...schemas.agentOp('get_attachment', 'attachments get'),
  params: {
    type: 'object',
    required: ['fileKey', 'attachmentId'],
    properties: {
      fileKey: schemas.getFile.params.properties.fileKey,
      attachmentId: { type: 'string', description: 'The attachment id (`attachments[].attachmentId` of a note, or a render check\'s image ids).' },
    },
  },
  querystring: {
    type: 'object',
    properties: { size: { type: 'string', enum: SIZES, description: 'full (default) or thumb.' } },
  },
  response: {
    200: { description: 'The image (image/png, image/jpeg or image/webp).', type: 'string', format: 'binary' },
    ...Object.fromEntries([400, 401, 403, 404].map(s => [s, { ...schemas.getFile.response[404] }])),
  },
};

/**
 * @param {any} app
 * @param {{ store: import('../store/types').Store, blobs: import('../blobs').BlobStore }} deps
 */
function registerAttachmentRoutes(app, { store, blobs }) {
  app.get('/files/:fileKey/attachments/:attachmentId', { schema: getAttachment }, async (/** @type {any} */ request, /** @type {any} */ reply) => {
    const { fileKey } = address.resolveFile(request.params.fileKey, request.query && request.query.url);
    const { attachmentId } = request.params;
    const found = await store.getAttachment(fileKey, attachmentId);
    const notFound = () => problem('attachment_not_found', `No attachment ${attachmentId} in file ${fileKey}.`, {
      hint: 'Use an attachmentId (or url) from a note or a render check of this file.',
    });
    if (!found) throw notFound();
    const thumb = request.query.size === 'thumb' && found.thumbKey;
    const blob = await blobs.get(thumb ? String(found.thumbKey) : found.blobKey);
    if (!blob) throw notFound();
    return reply
      .type(blob.contentType)
      .header('cache-control', 'private, max-age=3600')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('content-disposition', 'inline')
      .send(blob.bytes);
  });
}

module.exports = {
  attachmentOut, attachmentSchema, assertImagesEnabled, prepareImage, putImage, deleteBlobs, attachmentsByOwner, withNoteAttachments,
  registerAttachmentRoutes, getAttachment,
};
