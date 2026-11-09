#!/usr/bin/env node
'use strict';

const { main } = require('../src/server');

main({ argv: process.argv.slice(2) }).then(started => {
  if (!started || !('httpServer' in started)) return;
  const shutdown = () => started.close().then(() => process.exit(0), () => process.exit(1));
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}, err => {
  process.stderr.write(`${err && err.message ? err.message : err}\n`);
  process.exit(1);
});
