'use strict';

// `npm run screenshots`: regenerates docs/images/*.png from screenshots.spec.js
// against a throwaway local-mode API it starts itself (fresh data dir, named
// demo tokens). Needs a portal build: `npm run build -w @rolling-design-sync/portal`.
// Not part of the normal E2E run (playwright.config.js ignores the spec).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { defineConfig, devices } = require('@playwright/test');

const PORT = process.env.RDS_SCREENSHOTS_PORT || '8787';
const API_URL = `http://localhost:${PORT}`;
// The config is loaded again in each worker; generate the run's tokens and data dir once.
if (!process.env.RDS_SCREENSHOTS_DATA_DIR) {
  process.env.RDS_SCREENSHOTS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rds-screenshots-'));
  for (const cls of ['PLUGIN', 'AGENT', 'VIEWER']) process.env[`RDS_${cls}_TOKEN`] = randomBytes(32).toString('hex');
}
process.env.RDS_API_URL = API_URL;
const env = process.env;

module.exports = defineConfig({
  testDir: '.',
  testMatch: 'screenshots.spec.js',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  webServer: {
    command: 'node ../../apps/api/src/server.js',
    url: `${API_URL}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      RDS_STORE: 'local',
      RDS_DATA_DIR: env.RDS_SCREENSHOTS_DATA_DIR,
      HOST: '127.0.0.1',
      PORT,
      RDS_PLUGIN_TOKENS: `figma:${env.RDS_PLUGIN_TOKEN}`,
      RDS_AGENT_TOKENS: `team-agents:${env.RDS_AGENT_TOKEN}`,
      RDS_VIEWER_TOKENS: `design-review:${env.RDS_VIEWER_TOKEN}`,
    },
  },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: API_URL,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'UTC',
  },
});
