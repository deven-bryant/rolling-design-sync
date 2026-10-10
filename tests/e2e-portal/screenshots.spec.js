'use strict';

// Generates the README / docs screenshots (docs/images/*.png, 1440×900) from a
// realistic demo workspace seeded through the API (screenshots.seed.js), in the
// light theme (`portal-files.png`) and the dark one (`portal-files-dark.png`).
// screenshots.config.js starts a fresh local-mode API for the run:
//
//   npm run build -w @rolling-design-sync/portal   # repo root, once
//   npm run screenshots                            # in tests/e2e-portal
//
// PNGs are optimized losslessly with `optipng` when it is on PATH.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test, expect } = require('@playwright/test');
const { TOKENS } = require('./fixture');
const { APP, seedDemo } = require('./screenshots.seed');

const API = (process.env.RDS_API_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const OUT = path.join(__dirname, '..', '..', 'docs', 'images');

async function api(method, route, token, body) {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const shots = [];

/** Hides the sidebar's dismissible "API connected" card (it returns on every page load). */
async function dismissStatus(page) {
  await page.getByRole('button', { name: 'Dismiss' }).first().click();
}

async function go(page, route) {
  await page.goto(route);
  await dismissStatus(page);
}

const THEMES = [
  { theme: 'light', suffix: '' },
  { theme: 'dark', suffix: '-dark' },
];

async function capture(page, name, suffix) {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 899);
  const file = path.join(OUT, `${name}${suffix}.png`);
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
  shots.push(file);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const { files } = await api('GET', '/v3/files', TOKENS.viewer);
  if (files.length) throw new Error(`The API already tracks ${files.length} file(s); run the screenshots against a fresh API (see tests/README.md).`);
  const clock = path.join(process.env.RDS_SCREENSHOTS_DATA_DIR, 'clock');
  await seedDemo(api, TOKENS, async days => fs.writeFileSync(clock, String(days * 86_400_000)));
  fs.mkdirSync(OUT, { recursive: true });
});

test.afterAll(() => {
  if (!shots.length) return;
  try {
    execFileSync('optipng', ['-quiet', '-o2', '-strip', 'all', ...shots], { stdio: 'inherit' });
  } catch (err) {
    if (err.code === 'ENOENT') console.warn('optipng not found: screenshots left unoptimized');
    else throw err;
  }
});

for (const { theme, suffix } of THEMES) {
test(`portal screenshots (${theme})`, async ({ page }) => {
  await page.addInitScript(value => window.localStorage.setItem('rds-theme', value), theme);
  await page.goto('/ui/sign-in');
  await page.getByLabel('Token').fill(TOKENS.viewer);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/ui\/files$/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await dismissStatus(page);

  const files = page.getByRole('table', { name: 'Tracked files' });
  await expect(files.getByRole('row', { name: APP.fileName })).toBeVisible();
  await expect(page.getByText(/^[+-]\d+%$/)).toBeVisible();
  await capture(page, 'portal-files', suffix);

  await go(page, `/ui/files/${APP.fileKey}/nodes`);
  const nodes = page.getByRole('table', { name: 'Nodes' });
  await expect(nodes).toBeVisible();
  for (const name of ['Dashboard', 'Balance card', 'Recent transactions']) await nodes.getByRole('button', { name: `Expand ${name}`, exact: true }).click();
  await expect(nodes.locator('[data-node-id="3:9"]')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, 'portal-node-tree', suffix);

  await nodes.locator('[data-node-id="3:3"]').getByText('Balance card', { exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Node' });
  await expect(drawer.getByRole('heading', { name: 'Balance card' })).toBeVisible();
  await expect(drawer.getByRole('tab', { name: 'Change History' })).toHaveAttribute('aria-selected', 'true');
  await capture(page, 'portal-node-history', suffix);
  await drawer.getByRole('tab', { name: 'Change List' }).click();
  await expect(drawer.getByRole('table', { name: 'Change list' })).toBeVisible();
  await capture(page, 'portal-node-changes', suffix);
  await page.keyboard.press('Escape');

  await go(page, `/ui/files/${APP.fileKey}/work`);
  await expect(page.getByRole('table').first()).toBeVisible();
  await capture(page, 'portal-work-items', suffix);

  await go(page, '/ui/activity');
  await expect(page.getByText('Transfer screen').first()).toBeVisible();
  await capture(page, 'portal-activity', suffix);

  await go(page, '/ui/connect');
  await expect(page.getByRole('heading', { level: 1, name: 'Connect' })).toBeVisible();
  await capture(page, 'portal-connect', suffix);
});
}
