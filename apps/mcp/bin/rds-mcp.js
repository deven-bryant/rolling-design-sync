#!/usr/bin/env node
'use strict';

const { main } = require('../src/server');

main().catch(err => {
  process.stderr.write(`${err && err.message ? err.message : err}\n`);
  process.exit(1);
});
