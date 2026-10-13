'use strict';

/*
 * v3 file settings (docs/api-v3-design.md, "Library components"):
 * `PATCH /v3/files/{fileKey}` changes a tracked file's settings. Agent tokens
 * and agent portal sessions only; emits `file.settings_changed`.
 */
const { writeActor } = require('../auth');
const { withEvents } = require('../events/outbox');
const { fileSettings, DEFAULT_SETTINGS } = require('../nodeService');
const { problem } = require('./problem');
const { rejectUnknownKeys } = require('./actions');
const address = require('./address');
const schemas = require('./schemas');

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);
const problemResponse = schemas.getFile.response[404];

const updateFile = {
  summary: 'Change file settings',
  description: [
    'Changes a tracked file\'s settings; returns the file with every setting (defaults filled in). Agent tokens and agent portal sessions only (viewers get wrong_token_class).',
    '`trackLibraryComponents` (default true): false stops tracking library (remote) components — the plugin stops scanning library mains at its next sync, and stored library nodes drop out of listings, summaries, counts, work-item progress and trends (nothing is deleted; true restores them). Instances of library components stay tracked; with `expand=instances` their mains appear as `kind: "library"` reference items.',
    'Unknown settings are invalid_parameter. Emits `file.settings_changed` (`data.settings`) when a setting changes; its actor is the body\'s `worker` when given, `portal:<label>` on a session-authenticated call, else the token label.',
  ].join(' '),
  tags: schemas.listNodes.tags, security: schemas.listNodes.security,
  ...schemas.agentOp('update_file_settings', 'files settings'),
  params: schemas.getFile.params,
  querystring: { type: 'object', properties: { url: schemas.getFile.querystring.properties.url } },
  body: {
    type: 'object',
    required: ['settings'],
    properties: {
      settings: { ...schemas.fileSettings, description: `The settings to change (${SETTING_KEYS.join(', ')}); others keep their value.` },
      worker: { type: 'string', minLength: 1, maxLength: 200, description: 'Your worker id; recorded as the event actor (default: the token label).' },
    },
  },
  response: { 200: schemas.getFile.response[200], ...Object.fromEntries([400, 401, 403, 404].map(s => [s, { ...problemResponse }])) },
};

/**
 * @param {any} app
 * @param {{ store: import('../store/types').Store } & Record<string, any>} deps
 */
function registerFileRoutes(app, { store, bus = null }) {
  app.patch('/files/:fileKey', { schema: updateFile }, async (/** @type {import('./types').V3Request<'/v3/files/{fileKey}', 'patch'>} */ request) => {
    const { fileKey } = address.resolveFile(request.params.fileKey, request.query.url);
    rejectUnknownKeys('body', request.body, updateFile.body);
    const settings = request.body.settings || {};
    const unknown = Object.keys(settings).filter(k => !SETTING_KEYS.includes(k));
    if (unknown.length) {
      throw problem('invalid_parameter', `settings: unknown setting${unknown.length > 1 ? 's' : ''} ${unknown.map(k => `'${k}'`).join(', ')}.`, {
        hint: `Settings: ${SETTING_KEYS.join(', ')}.`, validParameters: SETTING_KEYS,
      });
    }
    const actor = (typeof request.body.worker === 'string' && request.body.worker.trim()) || writeActor(request);
    await withEvents(store, bus, async (tx, emit) => {
      const [file] = await tx.listFiles({ fileKey });
      if (!file) throw address.fileNotFound(fileKey);
      const before = fileSettings(file);
      const updated = await tx.updateFileSettings(fileKey, settings);
      const after = fileSettings(updated);
      if (SETTING_KEYS.some(k => before[k] !== after[k])) await emit(fileKey, 'file.settings_changed', { actor, data: { settings: after } });
    });
    const [file] = await store.listFiles({ fileKey });
    return {
      fileKey: file.fileKey, name: file.name ?? null, lastSyncAt: file.lastSyncAt ?? null, createdAt: file.createdAt ?? null,
      settings: fileSettings(file), counts: { ...file.counts, clean: file.counts.total - file.counts.dirty - file.counts.blocked },
    };
  });
}

module.exports = { registerFileRoutes, updateFile };
