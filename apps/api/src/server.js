'use strict';

const { loadConfig, envVar, ensureLocalTokens, checkTokenStrength, EMBEDDED_STORES } = require('./config');
const { buildApp } = require('./app');
const { PostgresStore } = require('./store/postgres');
const { MemoryStore } = require('./store/memory');
const { openLocalStore } = require('./store/pglite');
const { MemoryBus, PostgresBus, startRetention } = require('./events');
const { runMaintenance } = require('./maintenance');
const { checkSchema } = require('./schemaCheck');

const STORE_HELP = 'Set DATABASE_URL (Postgres), RDS_STORE=local (persistent, no database server), or RDS_STORE=memory (non-persistent dev server).';

async function main() {
  let config = loadConfig();
  if (config.store && !EMBEDDED_STORES.includes(config.store)) throw new Error(`Unknown RDS_STORE=${config.store}. ${STORE_HELP}`);
  if (!config.store && !config.databaseUrl) throw new Error(`No store configured. ${STORE_HELP}`);

  if (config.store === 'local') {
    console.log(`Local store: ${config.dataDir}`);
    const local = ensureLocalTokens(config);
    config = local.config;
    if (local.generated.length) {
      console.log(`Generated ${local.generated.join(' and ')} token(s), stored in ${local.file} (shown only once):`);
      if (local.generated.includes('plugin')) console.log(`  RDS_PLUGIN_TOKENS=${config.pluginTokens[0]}`);
      if (local.generated.includes('agent')) console.log(`  RDS_AGENT_TOKENS=${config.agentTokens[0]}`);
      if (local.generated.includes('viewer')) console.log(`  RDS_VIEWER_TOKENS=${config.viewerTokens[0]}`);
    } else if (!['PLUGIN_TOKENS', 'AGENT_TOKENS', 'VIEWER_TOKENS'].every(name => envVar(process.env, name))) {
      console.log(`Using tokens stored in ${local.file}`);
    }
  }
  if (!config.pluginTokens.length && !config.agentTokens.length) {
    throw new Error('Set RDS_PLUGIN_TOKENS and/or RDS_AGENT_TOKENS; refusing to start with no accepted tokens.');
  }
  for (const warning of checkTokenStrength(config)) console.warn(warning);

  const ssl = process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false };
  let store;
  if (config.store === 'memory') store = new MemoryStore();
  else if (config.store === 'local') store = (await openLocalStore({ dataDir: config.dataDir })).store;
  else {
    store = PostgresStore.fromUrl(config.databaseUrl, { ssl });
    try {
      await checkSchema(store.pool, config);
    } catch (err) {
      await store.close().catch(() => {});
      throw err;
    }
  }

  const bus = config.store ? new MemoryBus() : new PostgresBus({ store, connectionString: config.listenUrl, ssl });
  const app = buildApp({ store, config, bus, logger: { level: config.logLevel } });
  bus.log = app.log;
  const stopRetention = startRetention(store, { retentionDays: config.eventRetentionDays, log: app.log });
  const closeAll = async () => {
    stopRetention();
    await app.close();
    await bus.close();
    await store.close();
  };
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await closeAll();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  try {
    await runMaintenance(store, { log: app.log });
    await bus.start();
    await app.listen({ port: config.port, host: config.host });
  } catch (err) {
    await closeAll().catch(() => {});
    throw err;
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
