'use strict';

/*
 * Screens and render checks (docs/api-v3-design.md, "Screens and render
 * checks"). A screen is a FRAME or COMPONENT configured with the route and
 * viewport its built page renders at. The plugin uploads its 1x reference
 * PNG; anyone signed in may request a check; an agent renders the route,
 * submits the screenshot, and the API compares it with the reference for the
 * screen's current design version. A mismatch leaves a `render_check` note on
 * the screen (dirty, category `render`); a pass resolves those notes. RDS never
 * runs a check itself.
 */
const { createHash } = require('node:crypto');
const { writeActor } = require('../auth');
const { withEvents } = require('../events/outbox');
const { refreshNoteState } = require('../nodeService');
const { decodeRgba, encodeRgba } = require('../images');
const { compareImages, heatmap } = require('../renderDiff');
const address = require('./address');
const schemas = require('./schemas');
const { problem } = require('./problem');
// Lazy: actions -> read -> screens would be circular.
const rejectUnknownKeys = (...args) => require('./actions').rejectUnknownKeys(...args);
const { attachmentOut, assertImagesEnabled, prepareImage, putImage, deleteBlobs } = require('./attachments');

const SCREEN_TYPES = ['FRAME', 'COMPONENT'];
const KEEP_CHECKS = 10;
const DEFAULT_THRESHOLD = 1;
const MIN_VIEWPORT = 200;
const MAX_VIEWPORT = 8192;
const CHECK_STATUSES = ['requested', 'passed', 'mismatch', 'error'];
const RENDER_AUTHOR = 'render-check';

// --- schemas -------------------------------------------------------------------
const { tags, security } = schemas.listNodes;
const { agentOp } = schemas;
const nullable = (type, extra = {}) => ({ type: [type, 'null'], ...extra });
const problemResponse = schemas.getFile.response[404];
const errors = (...statuses) => Object.fromEntries([400, 401, 403, 404, ...statuses].map(s => [s, { ...problemResponse }]));
const fileKeyParam = schemas.getFile.params.properties.fileKey;
const nodeIdParam = schemas.getNode.params.properties.nodeId;
const screenParams = { type: 'object', required: ['fileKey', 'nodeId'], properties: { fileKey: fileKeyParam, nodeId: nodeIdParam } };
const checkParams = {
  type: 'object', required: ['fileKey', 'checkId'],
  properties: { fileKey: fileKeyParam, checkId: { type: 'string', description: 'The check id (`checkId` from request_render_check / list_render_checks).' } },
};
const underQuery = { type: 'string', description: 'Only screens at or under this node id (e.g. a section).' };
const rect = {
  type: 'object', required: ['x', 'y', 'width', 'height'],
  properties: { x: { type: 'integer', minimum: 0 }, y: { type: 'integer', minimum: 0 }, width: { type: 'integer', minimum: 1 }, height: { type: 'integer', minimum: 1 } },
};
const region = { type: 'object', properties: { ...rect.properties, pixels: { type: 'integer', description: 'Differing pixels in it.' } } };
const imageData = { type: 'string', minLength: 1, description: 'The PNG, base64.' };

const lastCheck = nullable('object', {
  description: 'The newest check of the screen.',
  properties: {
    checkId: { type: 'string' }, status: { type: 'string', enum: CHECK_STATUSES }, score: nullable('number'),
    designVersion: { type: 'string' }, requestedAt: { type: 'string' }, submittedAt: nullable('string'),
  },
});
const screen = {
  type: 'object',
  properties: {
    nodeId: { type: 'string' },
    name: nullable('string'),
    route: { type: 'string', description: 'The app route the screen renders at (e.g. `/settings`).' },
    viewport: { type: 'object', properties: { width: { type: 'integer' }, height: { type: 'integer' } } },
    theme: nullable('string'),
    query: nullable('string', { description: 'Query string added to the route.' }),
    masks: { type: 'array', items: rect, description: 'Rectangles (screen px) ignored by the comparison (dynamic content).' },
    threshold: { type: 'number', description: 'Max % of differing pixels that still passes.' },
    designVersion: { type: 'string', description: 'Hash of the content hashes of the screen and every node under it.' },
    referenceVersion: nullable('string', { description: 'The design version of the stored reference image.' }),
    reference: nullable('object', { properties: schemas.attachment.properties }),
    status: { type: 'string', enum: schemas.SCREEN_STATUSES },
    stale: { type: 'boolean', description: 'The last result is for an older design version.' },
    score: nullable('number'),
    lastCheck,
    updatedBy: { type: 'string' },
    updatedAt: { type: 'string' },
  },
};
const check = {
  type: 'object',
  properties: {
    checkId: { type: 'string' }, nodeId: { type: 'string' }, status: { type: 'string', enum: CHECK_STATUSES },
    designVersion: { type: 'string' }, requestedBy: { type: 'string' }, requestedAt: { type: 'string' },
    submittedBy: nullable('string'), submittedAt: nullable('string'), commitRef: nullable('string'), source: nullable('string'),
    score: nullable('number', { description: '% of the compared pixels that differ.' }), threshold: nullable('number'),
    regions: { type: 'array', items: region, description: 'Up to 10 differing areas, largest first.' },
    error: nullable('string'),
    route: nullable('string'), viewport: nullable('object', { properties: { width: { type: 'integer' }, height: { type: 'integer' } } }),
    theme: nullable('string'), query: nullable('string'), masks: { type: 'array', items: rect },
    reference: nullable('object', { properties: schemas.attachment.properties }),
    built: nullable('object', { properties: schemas.attachment.properties }),
    heatmap: nullable('object', { properties: schemas.attachment.properties }),
  },
};

const listScreens = {
  summary: 'List screens',
  description: 'The frames configured for render checks, by node id, each with its settings and computed `status` (building: nodes under it are dirty; ready: built and no result for its current design; requested; passed; mismatch; error), `stale` (the last result is for an older design) and last check.',
  tags, security,
  ...agentOp('list_screens', 'screens ls'),
  params: { type: 'object', required: ['fileKey'], properties: { fileKey: fileKeyParam } },
  querystring: { type: 'object', properties: { under: underQuery } },
  response: { 200: { type: 'object', properties: { fileKey: { type: 'string' }, screens: { type: 'array', items: screen } } }, ...errors() },
};
const putScreen = {
  summary: 'Configure a screen',
  description: `Makes a FRAME or COMPONENT a screen for render checks, or changes its settings: the \`route\` its built page renders at, the \`viewport\` (${MIN_VIEWPORT}–${MAX_VIEWPORT} px; default: the frame's size), optional \`theme\` / \`query\`, \`masks\` (rectangles inside the viewport ignored by the comparison) and \`threshold\` (0–100 % of pixels; default ${DEFAULT_THRESHOLD}). The plugin uploads its reference image at its next sync. Agent tokens and agent sessions only.`,
  tags, security,
  ...agentOp('set_screen', 'screens set'),
  params: screenParams,
  body: {
    type: 'object', required: ['route'],
    properties: {
      route: { type: 'string', minLength: 1, maxLength: 2000, description: 'App route, starting with `/` (e.g. `/settings`).' },
      viewport: { type: 'object', required: ['width', 'height'], properties: { width: { type: 'integer' }, height: { type: 'integer' } }, description: 'Render size in px (default: the frame size).' },
      theme: nullable('string', { maxLength: 100, description: 'Theme the page renders in (e.g. `dark`), passed to the renderer.' }),
      query: nullable('string', { maxLength: 2000, description: 'Query string added to the route (no leading `?`).' }),
      masks: { type: 'array', maxItems: 50, items: rect, description: 'Up to 50 rectangles (screen px from the top-left) the comparison ignores, e.g. dates or avatars.' },
      threshold: { type: 'number', minimum: 0, maximum: 100, description: `Max % of differing pixels that still passes (default ${DEFAULT_THRESHOLD}).` },
    },
  },
  response: { 200: { type: 'object', properties: { fileKey: { type: 'string' }, screen } }, ...errors() },
};
const deleteScreen = {
  summary: 'Remove a screen',
  description: 'Stops render-checking a frame: deletes its settings, reference image and checks (their images too). Agent tokens and agent sessions only.',
  tags, security,
  ...agentOp('delete_screen', 'screens rm'),
  params: screenParams,
  response: { 200: { type: 'object', properties: { fileKey: { type: 'string' }, nodeId: { type: 'string' }, deleted: { type: 'boolean' } } }, ...errors() },
};
const requestCheck = {
  summary: 'Request a render check',
  description: 'Asks for a render check of a screen; an agent runs it (`rds-agent check`) and submits the result. Returns the open request when one is already pending (idempotent). Any signed-in caller, viewers included. Emits `render_check.requested`.',
  tags, security,
  ...agentOp('request_render_check', 'checks request'),
  params: screenParams,
  response: { 200: { type: 'object', properties: { fileKey: { type: 'string' }, created: { type: 'boolean' }, check } }, ...errors() },
};
const listChecks = {
  summary: 'List render checks',
  description: `Render checks, newest first; \`status=requested\` lists the ones waiting for an agent to run them (with each screen's route, viewport, theme, query and masks). The ${KEEP_CHECKS} newest checks of each screen are kept.`,
  tags, security,
  ...agentOp('list_render_checks', 'checks ls'),
  params: { type: 'object', required: ['fileKey'], properties: { fileKey: fileKeyParam } },
  querystring: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: CHECK_STATUSES, description: 'Only checks in this status (`requested`: waiting for an agent).' },
      nodeId: { type: 'string', description: 'Only this screen\'s checks.' },
      limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Default 100.' },
    },
  },
  response: { 200: { type: 'object', properties: { fileKey: { type: 'string' }, checks: { type: 'array', items: check } } }, ...errors() },
};
const getCheck = {
  summary: 'Get a render check',
  description: 'One render check with its score, differing regions and the reference, built and heatmap images (get_attachment fetches them).',
  tags, security,
  ...agentOp('get_render_check', 'checks show'),
  params: checkParams,
  response: { 200: { type: 'object', properties: { fileKey: { type: 'string' }, check } }, ...errors() },
};
const submitResult = {
  summary: 'Submit a render check result',
  description: [
    'Submits the built screenshot (PNG, base64, rendered at the screen\'s viewport) for a requested check. The API compares it with the reference for the screen\'s current design (no resizing; pixels outside the smaller image differ; masks are skipped) and returns the score, regions and a heatmap.',
    'score <= threshold passes (resolves open render-check notes; emits `render_check.passed`); otherwise mismatch: a `render_check` note with the images is added to the screen (dirty, category `render`) and `render_check.mismatch` is emitted. Send `error` instead of `image` when the page could not be rendered.',
    'reference_missing when the plugin has not uploaded a reference for the current design. Agent tokens only.',
  ].join(' '),
  tags, security,
  ...agentOp('submit_render_check', 'checks submit'),
  params: checkParams,
  body: {
    type: 'object',
    properties: {
      image: imageData,
      error: { type: 'string', minLength: 1, maxLength: 2000, description: 'Why the screen could not be rendered (instead of image).' },
      commitRef: { type: 'string', maxLength: 200, description: 'The commit the screenshot was rendered from.' },
      source: { type: 'string', maxLength: 200, description: 'What rendered it (e.g. `rds-agent check`, a CI job).' },
    },
  },
  response: { 200: { type: 'object', properties: { fileKey: { type: 'string' }, check } }, ...errors(409, 413) },
};
const referencesNeeded = {
  summary: 'Screens needing a reference (plugin)',
  description: 'Configured screens under `under` whose reference image is missing or for an older design version: export each at 1x and upload it. Plugin tokens only.',
  tags: ['plugin'], security: [{ pluginToken: [] }],
  params: { type: 'object', required: ['fileKey'], properties: { fileKey: fileKeyParam } },
  querystring: { type: 'object', properties: { under: underQuery } },
  response: {
    200: {
      type: 'object',
      properties: { screens: { type: 'array', items: { type: 'object', properties: { nodeId: { type: 'string' }, designVersion: { type: 'string' } } } } },
    },
    ...errors(),
  },
};
const putReference = {
  summary: 'Upload a screen reference (plugin)',
  description: 'The 1x PNG export of a screen for `designVersion` (from references-needed). Plugin tokens only.',
  tags: ['plugin'], security: [{ pluginToken: [] }],
  params: screenParams,
  body: {
    type: 'object', required: ['designVersion', 'image'],
    properties: { designVersion: { type: 'string', minLength: 1, maxLength: 200 }, image: imageData },
  },
  response: {
    200: { type: 'object', properties: { fileKey: { type: 'string' }, nodeId: { type: 'string' }, designVersion: { type: 'string' }, current: { type: 'boolean' } } },
    ...errors(409, 413),
  },
};

// --- state -------------------------------------------------------------------------
/** Hash of the content hashes of `nodeId` and its live descendants. */
async function designVersion(store, fileKey, nodeId) {
  const nodes = await store.listNodeSubtree(fileKey, nodeId, { includeDeleted: false });
  const hash = createHash('sha256');
  for (const n of [...nodes].sort((a, b) => (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0))) hash.update(`${n.nodeId}\u0000${n.contentHash || ''}\n`);
  return hash.digest('hex').slice(0, 32);
}

/** Whether a node is dirty only because of open render-check notes. */
const renderOnly = n => n.changeType === 'requested' && (n.changeCategories || []).every(c => c === 'render');

/**
 * The computed state of `s`: design version, status, staleness, last check.
 * @param {import('../store/types').Store} store
 * @param {import('../store/types').Screen} s
 * @param {import('../store/types').RenderCheck | null} last
 */
async function screenState(store, s, last) {
  const version = await designVersion(store, s.fileKey, s.nodeId);
  const dirty = (await store.listNodeSubtree(s.fileKey, s.nodeId, { dirty: true, includeDeleted: false })).filter(n => !renderOnly(n));
  let status;
  let stale = false;
  if (last && last.status === 'requested') status = 'requested';
  else if (last && last.designVersion === version) status = last.status;
  else {
    status = dirty.length ? 'building' : 'ready';
    stale = !!last;
  }
  return { designVersion: version, status, stale, score: last ? last.score : null, lastCheck: last };
}

/** Sets `screen: { status, stale, score }` on the node rows that are screens. */
async function withScreens(store, fileKey, rows) {
  const live = rows.filter(Boolean);
  if (!live.length) return rows;
  const screens = new Map((await store.listScreens(fileKey)).map(s => [s.nodeId, s]));
  const hit = live.filter(n => screens.has(n.nodeId));
  if (!hit.length) return rows;
  const latest = new Map((await store.latestChecks(fileKey, hit.map(n => n.nodeId))).map(c => [c.nodeId, c]));
  for (const n of hit) {
    const st = await screenState(store, /** @type {any} */ (screens.get(n.nodeId)), latest.get(n.nodeId) || null);
    n.screen = { status: st.status, stale: st.stale, score: st.score };
  }
  return rows;
}

const lastCheckOut = c => c && ({ checkId: c.checkId, status: c.status, score: c.score, designVersion: c.designVersion, requestedAt: c.requestedAt, submittedAt: c.submittedAt });

// --- routes ------------------------------------------------------------------------
function common(store) {
  async function file(request) {
    const { fileKey } = address.resolveFile(request.params.fileKey, request.query && request.query.url);
    const [found] = await store.listFiles({ fileKey });
    if (!found) throw address.fileNotFound(fileKey);
    return fileKey;
  }
  async function storedNode(tx, fileKey, raw) {
    const ids = address.nodeIdCandidates(raw);
    const rows = await tx.getNodes(fileKey, ids);
    const found = ids.map(id => rows.find(n => n.nodeId === id)).find(Boolean);
    if (!found) throw address.nodeNotFound(fileKey, raw);
    return found;
  }
  const screenNotFound = (fileKey, nodeId) => problem('screen_not_found', `Node ${nodeId} of file ${fileKey} is not a screen.`, {
    hint: 'Configure it with set_screen first, or pick one from list_screens.',
  });
  async function storedScreen(tx, fileKey, raw) {
    const node = await storedNode(tx, fileKey, raw);
    const s = await tx.getScreen(fileKey, node.nodeId);
    if (!s) throw screenNotFound(fileKey, node.nodeId);
    return { node, screen: s };
  }
  /** Screens at or under `under` (all without it). */
  async function screensUnder(fileKey, under) {
    const all = await store.listScreens(fileKey);
    if (!under) return all;
    const root = await storedNode(store, fileKey, under);
    const ids = new Set((await store.listNodeSubtree(fileKey, root.nodeId, { includeDeleted: false })).map(n => n.nodeId));
    return all.filter(s => ids.has(s.nodeId));
  }
  return { file, storedNode, storedScreen, screensUnder, screenNotFound };
}

/**
 * Agent / viewer / session routes.
 * @param {any} app
 * @param {{ store: import('../store/types').Store, blobs: import('../blobs').BlobStore, now: () => Date, bus?: any, config?: any }} deps
 */
function registerScreenRoutes(app, { store, blobs, now, bus = null, config = {} }) {
  const { file, storedNode, storedScreen, screensUnder } = common(store);

  async function attachments(fileKey, ids) {
    const out = new Map();
    for (const id of ids.filter(Boolean)) {
      const a = await store.getAttachment(fileKey, id);
      if (a) out.set(id, attachmentOut(a));
    }
    return out;
  }

  async function screenOut(s, last) {
    const st = await screenState(store, s, last);
    const [node] = await store.getNodes(s.fileKey, [s.nodeId]);
    const ref = s.referenceId ? (await attachments(s.fileKey, [s.referenceId])).get(s.referenceId) || null : null;
    return {
      nodeId: s.nodeId, name: node ? node.name ?? null : null, route: s.route, viewport: s.viewport, theme: s.theme, query: s.query,
      masks: s.masks, threshold: s.threshold, designVersion: st.designVersion, referenceVersion: s.referenceVersion, reference: ref,
      status: st.status, stale: st.stale, score: st.score, lastCheck: lastCheckOut(last), updatedBy: s.updatedBy, updatedAt: s.updatedAt,
    };
  }

  async function checkOut(c, screenRow) {
    const s = screenRow === undefined ? await store.getScreen(c.fileKey, c.nodeId) : screenRow;
    const images = await attachments(c.fileKey, [c.referenceId, c.builtId, c.heatmapId]);
    const { fileKey: _f, builtId: _b, heatmapId: _h, referenceId: _r, ...rest } = c;
    return {
      ...rest,
      route: s ? s.route : null, viewport: s ? s.viewport : null, theme: s ? s.theme : null, query: s ? s.query : null, masks: s ? s.masks : [],
      reference: images.get(c.referenceId) || null, built: images.get(c.builtId) || null, heatmap: images.get(c.heatmapId) || null,
    };
  }

  app.get('/files/:fileKey/screens', { schema: listScreens }, async (/** @type {any} */ request) => {
    const fileKey = await file(request);
    const list = await screensUnder(fileKey, request.query.under || null);
    const latest = new Map((await store.latestChecks(fileKey, list.map(s => s.nodeId))).map(c => [c.nodeId, c]));
    const screens = [];
    for (const s of list) screens.push(await screenOut(s, latest.get(s.nodeId) || null));
    return { fileKey, screens };
  });

  app.put('/files/:fileKey/screens/:nodeId', { schema: putScreen }, async (/** @type {any} */ request) => {
    rejectUnknownKeys('body', request.body, putScreen.body);
    const fileKey = await file(request);
    const body = request.body;
    const node = await storedNode(store, fileKey, request.params.nodeId);
    if (node.deletedAt || !SCREEN_TYPES.includes(node.nodeType)) {
      throw problem('invalid_parameter', `nodeId: node ${node.nodeId} is ${node.deletedAt ? 'deleted' : `a ${node.nodeType || 'node'}`}; screens are live FRAME or COMPONENT nodes.`, {
        hint: 'Pick a frame (usually a direct child of a section), not a section, page or layer.',
      });
    }
    if (!body.route.startsWith('/')) throw problem('invalid_parameter', 'route: must start with `/`.', { hint: 'Pass the app path, e.g. /settings.' });
    const attrs = node.attrs || {};
    const viewport = body.viewport || { width: Math.round(Number(attrs.width) || 0), height: Math.round(Number(attrs.height) || 0) };
    for (const side of ['width', 'height']) {
      if (!(viewport[side] >= MIN_VIEWPORT && viewport[side] <= MAX_VIEWPORT)) {
        throw problem('invalid_parameter', `viewport.${side}: ${viewport[side]} is not within ${MIN_VIEWPORT}–${MAX_VIEWPORT} px.`, {
          hint: body.viewport ? `Pass a viewport between ${MIN_VIEWPORT} and ${MAX_VIEWPORT} px.` : 'The frame size is unknown or out of range: pass viewport.',
        });
      }
    }
    const masks = body.masks || [];
    masks.forEach((m, i) => {
      if (m.x + m.width > viewport.width || m.y + m.height > viewport.height) {
        throw problem('invalid_parameter', `masks[${i}]: the rectangle is not inside the ${viewport.width}×${viewport.height} viewport.`, { hint: 'Masks are in screen px from its top-left.' });
      }
    });
    const at = now().toISOString();
    const saved = await store.upsertScreen({
      fileKey, nodeId: node.nodeId, route: body.route, viewport, theme: body.theme ?? null, query: body.query ?? null, masks,
      threshold: body.threshold ?? DEFAULT_THRESHOLD, by: writeActor(request), at,
    });
    const [last] = await store.latestChecks(fileKey, [node.nodeId]);
    return { fileKey, screen: await screenOut(saved, last || null) };
  });

  app.delete('/files/:fileKey/screens/:nodeId', { schema: deleteScreen }, async (/** @type {any} */ request) => {
    const fileKey = await file(request);
    let removed = [];
    await store.transaction(async tx => {
      const { node, screen: s } = await storedScreen(tx, fileKey, request.params.nodeId);
      const checks = await tx.deleteChecks(fileKey, node.nodeId);
      const ids = [...(s.referenceId ? [s.referenceId] : []), ...(await tx.listAttachments(fileKey, 'screen', [node.nodeId])).map(a => a.attachmentId)];
      for (const c of checks) ids.push(...(await tx.listAttachments(fileKey, 'check', [c.checkId])).map(a => a.attachmentId));
      removed = await tx.deleteAttachments(fileKey, [...new Set(ids)]);
      await tx.deleteScreen(fileKey, node.nodeId);
    });
    await deleteBlobs(blobs, removed, request.log);
    const node = await storedNode(store, fileKey, request.params.nodeId);
    return { fileKey, nodeId: node.nodeId, deleted: true };
  });

  app.post('/files/:fileKey/screens/:nodeId/checks', { schema: requestCheck, config: { viewerWrite: true } }, async (/** @type {any} */ request) => {
    const fileKey = await file(request);
    const by = writeActor(request);
    const at = now().toISOString();
    const result = await withEvents(store, bus, async (tx, emit) => {
      const { node, screen: s } = await storedScreen(tx, fileKey, request.params.nodeId);
      const [pending] = await tx.listChecks(fileKey, { status: 'requested', nodeId: node.nodeId, limit: 1 });
      if (pending) return { created: false, check: pending, screen: s };
      const created = await tx.insertCheck({ fileKey, nodeId: node.nodeId, designVersion: await designVersion(tx, fileKey, node.nodeId), requestedBy: by, at });
      await emit(fileKey, 'render_check.requested', { actor: by, data: { nodeId: node.nodeId, checkId: created.checkId } });
      return { created: true, check: created, screen: s };
    });
    return { fileKey, created: result.created, check: await checkOut(result.check, result.screen) };
  });

  app.get('/files/:fileKey/checks', { schema: listChecks }, async (/** @type {any} */ request) => {
    const fileKey = await file(request);
    let nodeId = null;
    if (request.query.nodeId) nodeId = (await storedNode(store, fileKey, request.query.nodeId)).nodeId;
    const list = await store.listChecks(fileKey, { status: request.query.status || null, nodeId, limit: request.query.limit || 100 });
    const screens = new Map((await store.listScreens(fileKey)).map(s => [s.nodeId, s]));
    const checks = [];
    for (const c of list) checks.push(await checkOut(c, screens.get(c.nodeId) || null));
    return { fileKey, checks };
  });

  const checkNotFound = (fileKey, checkId) => problem('check_not_found', `No render check ${checkId} in file ${fileKey}.`, {
    hint: 'Use a checkId from request_render_check or list_render_checks (the 10 newest of each screen are kept).',
  });

  app.get('/files/:fileKey/checks/:checkId', { schema: getCheck }, async (/** @type {any} */ request) => {
    const fileKey = await file(request);
    const found = await store.getCheck(fileKey, request.params.checkId);
    if (!found) throw checkNotFound(fileKey, request.params.checkId);
    return { fileKey, check: await checkOut(found) };
  });

  const resultBodyLimit = Math.ceil((config.imageMaxBytes || 5 * 1024 * 1024) * 1.4) + 64 * 1024;
  app.post('/files/:fileKey/checks/:checkId/result', { schema: submitResult, bodyLimit: Math.max(resultBodyLimit, config.bodyLimit || 0) }, async (/** @type {any} */ request) => {
    rejectUnknownKeys('body', request.body, submitResult.body);
    const fileKey = await file(request);
    const { checkId } = request.params;
    const body = request.body || {};
    if (!body.image === !body.error) throw problem('invalid_body', 'Send exactly one of image or error.', { hint: 'image: the built screenshot (PNG, base64); error: why it could not be rendered.' });
    const found = await store.getCheck(fileKey, checkId);
    if (!found) throw checkNotFound(fileKey, checkId);
    if (found.status !== 'requested') {
      throw problem('check_not_requested', `Render check ${checkId} already has a result (${found.status}).`, { hint: 'Request a new check with request_render_check.' });
    }
    const s = await store.getScreen(fileKey, found.nodeId);
    if (!s) throw checkNotFound(fileKey, checkId);
    const by = writeActor(request);
    const at = now().toISOString();
    const version = await designVersion(store, fileKey, s.nodeId);
    const meta = { designVersion: version, submittedBy: by, submittedAt: at, commitRef: body.commitRef ?? null, source: body.source ?? null };

    if (body.error) {
      const done = await withEvents(store, bus, async tx => {
        const row = await tx.finishCheck(fileKey, checkId, { ...meta, status: 'error', error: body.error, threshold: s.threshold });
        if (!row) throw problem('check_not_requested', `Render check ${checkId} already has a result.`, { hint: 'Request a new check with request_render_check.' });
        return row;
      });
      return { fileKey, check: await checkOut(done, s) };
    }

    await assertImagesEnabled(store, fileKey);
    if (!s.referenceId || s.referenceVersion !== version) {
      throw problem('reference_missing', `Screen ${s.nodeId} has no reference image for its current design (${version}).`, {
        hint: 'Sync the screen with the Figma plugin (it uploads the reference), then submit again.',
      });
    }
    const refRow = await store.getAttachment(fileKey, s.referenceId);
    const refBlob = refRow && await blobs.get(refRow.blobKey);
    if (!refRow || !refBlob) throw problem('reference_missing', `Screen ${s.nodeId}'s reference image is gone.`, { hint: 'Sync the screen with the Figma plugin again.' });
    const built = await prepareImage(body.image, { field: 'image', config, format: 'png', only: ['png'] });
    const ref = await decodeRgba(refBlob.bytes);
    const shot = await decodeRgba(built.bytes);
    const diff = compareImages(ref, shot, { masks: s.masks });
    const heat = await encodeRgba(heatmap(shot, diff));
    const passed = diff.score <= s.threshold;
    const stored = [];
    let done;
    let pruned = [];
    try {
      stored.push(await putImage(blobs, { fileKey, ownerKind: 'check', ownerId: checkId, kind: 'built', image: built, by, at }));
      stored.push(await putImage(blobs, { fileKey, ownerKind: 'check', ownerId: checkId, kind: 'heatmap', image: heat, by, at }));
      done = await withEvents(store, bus, async (tx, emit) => {
        for (const a of stored) await tx.insertAttachment(a);
        const row = await tx.finishCheck(fileKey, checkId, {
          ...meta, status: passed ? 'passed' : 'mismatch', score: diff.score, threshold: s.threshold, regions: diff.regions,
          builtId: stored[0].attachmentId, heatmapId: stored[1].attachmentId, referenceId: s.referenceId,
        });
        if (!row) throw problem('check_not_requested', `Render check ${checkId} already has a result.`, { hint: 'Request a new check with request_render_check.' });
        const notes = (await tx.listNotes(fileKey, [s.nodeId], { status: 'open' })).filter(n => n.source === 'render_check');
        if (passed) {
          for (const n of notes) await tx.closeNote(fileKey, n.noteId, { status: 'resolved', by, at, commitRef: meta.commitRef });
          if (notes.length) await refreshNoteState(tx, fileKey, s.nodeId);
          await emit(fileKey, 'render_check.passed', { actor: by, data: { nodeId: s.nodeId, checkId, score: diff.score, resolvedNoteIds: notes.map(n => n.noteId) } });
        } else {
          for (const n of notes) await tx.closeNote(fileKey, n.noteId, { status: 'dismissed', by: RENDER_AUTHOR, at });
          const text = `Render check: ${diff.score}% of pixels differ from the design (threshold ${s.threshold}%)`
            + `${diff.sizeMatch ? '' : `; the screenshot is ${shot.width}×${shot.height}, the design ${ref.width}×${ref.height}`}`
            + `${diff.regions.length ? `; largest differing area at ${diff.regions[0].x},${diff.regions[0].y} (${diff.regions[0].width}×${diff.regions[0].height} px)` : ''}.`
            + ' See the heatmap and fix the screen to match the design.';
          const note = await tx.insertNote({ fileKey, nodeId: s.nodeId, body: text, author: RENDER_AUTHOR, worker: null, source: 'render_check', at });
          for (const [kind, id] of [['reference', refRow.attachmentId], ['built', stored[0].attachmentId], ['heatmap', stored[1].attachmentId]]) {
            const a = /** @type {any} */ (kind === 'reference' ? refRow : stored.find(x => x.attachmentId === id));
            await tx.insertAttachment({ ...a, attachmentId: undefined, ownerKind: 'note', ownerId: note.noteId, kind: a.kind, createdAt: at, createdBy: RENDER_AUTHOR, blobKey: a.blobKey, thumbKey: a.thumbKey });
          }
          await refreshNoteState(tx, fileKey, s.nodeId);
          await emit(fileKey, 'render_check.mismatch', { actor: by, data: { nodeId: s.nodeId, checkId, score: diff.score, noteId: note.noteId } });
        }
        pruned = await tx.deleteChecks(fileKey, s.nodeId, { keep: KEEP_CHECKS });
        return row;
      });
    } catch (err) {
      await deleteBlobs(blobs, stored, request.log);
      throw err;
    }
    await pruneImages(store, blobs, fileKey, pruned, request.log);
    return { fileKey, check: await checkOut(done, s) };
  });
}

/** Deletes the images of pruned checks, keeping blobs still referenced by another attachment row. */
async function pruneImages(store, blobs, fileKey, pruned, log) {
  if (!pruned.length) return;
  const rows = await store.listAttachments(fileKey, 'check', pruned.map(c => c.checkId));
  const removed = await store.deleteAttachments(fileKey, rows.map(a => a.attachmentId));
  const shared = await sharedBlobKeys(store, fileKey, removed);
  await deleteBlobs(blobs, removed.filter(a => !shared.has(a.blobKey)), log);
}

/** Blob keys of `attachments` that note attachments still reference (render-check notes share check images). */
async function sharedBlobKeys(store, fileKey, attachments) {
  const keys = new Set(attachments.map(a => a.blobKey));
  if (!keys.size) return new Set();
  const notes = await store.listNotes(fileKey, [...new Set((await store.listScreens(fileKey)).map(s => s.nodeId))], { status: 'all' });
  const rows = await store.listAttachments(fileKey, 'note', notes.map(n => n.noteId));
  return new Set(rows.filter(a => keys.has(a.blobKey)).map(a => a.blobKey));
}

/**
 * Plugin routes (registered in the plugin-token scope).
 * @param {any} app
 * @param {{ store: import('../store/types').Store, blobs: import('../blobs').BlobStore, now: () => Date, config?: any }} deps
 */
function registerScreenPluginRoutes(app, { store, blobs, now, config = {} }) {
  const { file, storedScreen, screensUnder } = common(store);

  app.get('/files/:fileKey/screens/references-needed', { schema: referencesNeeded }, async (/** @type {any} */ request) => {
    const fileKey = await file(request);
    const out = [];
    for (const s of await screensUnder(fileKey, request.query.under || null)) {
      const version = await designVersion(store, fileKey, s.nodeId);
      if (!s.referenceId || s.referenceVersion !== version) out.push({ nodeId: s.nodeId, designVersion: version });
    }
    return { screens: out };
  });

  const refBodyLimit = Math.ceil((config.imageMaxBytes || 5 * 1024 * 1024) * 1.4) + 64 * 1024;
  app.put('/files/:fileKey/screens/:nodeId/reference', { schema: putReference, bodyLimit: Math.max(refBodyLimit, config.bodyLimit || 0) }, async (/** @type {any} */ request) => {
    rejectUnknownKeys('body', request.body, putReference.body);
    const fileKey = await file(request);
    const { node, screen: s } = await storedScreen(store, fileKey, request.params.nodeId);
    await assertImagesEnabled(store, fileKey);
    const image = await prepareImage(request.body.image, { field: 'image', config, format: 'png', only: ['png'] });
    const version = await designVersion(store, fileKey, node.nodeId);
    const by = writeActor(request) || 'plugin';
    const at = now().toISOString();
    const stored = await putImage(blobs, { fileKey, ownerKind: 'screen', ownerId: node.nodeId, kind: 'reference', image, by, at });
    let removed = [];
    try {
      await store.transaction(async tx => {
        await tx.insertAttachment(stored);
        await tx.setScreenReference(fileKey, node.nodeId, { referenceId: stored.attachmentId, referenceVersion: request.body.designVersion, at });
        const old = (await tx.listAttachments(fileKey, 'screen', [node.nodeId])).filter(a => a.attachmentId !== stored.attachmentId);
        // Old references still shown by a kept check or note stay; the rest go.
        const checks = await tx.listChecks(fileKey, { nodeId: node.nodeId, limit: KEEP_CHECKS + 1 });
        const used = new Set(checks.map(c => c.referenceId));
        removed = await tx.deleteAttachments(fileKey, old.filter(a => !used.has(a.attachmentId)).map(a => a.attachmentId));
      });
    } catch (err) {
      await deleteBlobs(blobs, [stored], request.log);
      throw err;
    }
    const shared = await sharedBlobKeys(store, fileKey, removed);
    await deleteBlobs(blobs, removed.filter(a => !shared.has(a.blobKey)), request.log);
    void s;
    return { fileKey, nodeId: node.nodeId, designVersion: request.body.designVersion, current: request.body.designVersion === version };
  });
}

module.exports = { registerScreenRoutes, registerScreenPluginRoutes, withScreens, designVersion, screenState, KEEP_CHECKS, RENDER_AUTHOR };
