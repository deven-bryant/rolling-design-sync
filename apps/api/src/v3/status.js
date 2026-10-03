'use strict';

const schemas = require('./schemas');
const { version } = require('../../package.json');

const status = {
  summary: 'Server and plugin status',
  description: 'Connection diagnostics: server version, storage mode, live event bus mode and replay window. `plugin` describes the newest retained sync.completed across all files; its fields are null before the first sync.',
  tags: schemas.listNodes.tags, security: schemas.listNodes.security,
  response: {
    200: {
      type: 'object',
      properties: {
        version: { type: 'string' },
        store: { type: 'string', enum: ['postgres', 'local', 'memory'] },
        events: { type: 'string', enum: ['listening', 'polling'] },
        replayHours: { type: 'integer' },
        plugin: {
          type: 'object',
          properties: { lastSyncAt: { type: ['string', 'null'] }, client: { type: ['string', 'null'] } },
        },
      },
    },
    401: schemas.getFile.response[401], 403: schemas.getFile.response[403],
  },
};

/**
 * @param {any} app
 * @param {{ store: import('../store/types').Store } & Record<string, any>} deps
 */
function registerStatusRoutes(app, { store, config, bus }) {
  app.get('/status', { schema: status }, async () => {
    const sync = await store.latestEvent('sync.completed');
    return {
      version, store: config.store || 'postgres', events: bus.mode === 'polling' ? 'polling' : 'listening',
      replayHours: config.eventReplayHours ?? 24,
      plugin: { lastSyncAt: sync?.createdAt ?? null, client: sync?.data.client ?? null },
    };
  });
}

module.exports = { registerStatusRoutes };
