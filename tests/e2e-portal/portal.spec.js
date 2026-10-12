'use strict';

// Browser E2E for the portal (docs/ui-portal.md) against a RUNNING API that
// serves the built portal at /ui. Seeds through the API with the plugin token,
// then signs in as a viewer and an agent. See tests/README.md.

const { test, expect } = require('@playwright/test');
const { TOKENS, ROOT, FRAME, INSTANCE, MAIN_CHILD, SECOND, REMOVED, TOKEN_COLLECTION, TOKEN, seedFile, syncSecondScope, syncRemovedScreen, syncTokens, claim, clear } = require('./fixture');

async function signIn(page, token) {
  await page.goto('/ui/sign-in');
  await page.getByLabel('Token').fill(token);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/ui\/files$/);
}

async function signOut(page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/ui\/sign-in/);
}

const nodes = page => page.getByRole('table', { name: 'Nodes' });
const row = (page, nodeId) => nodes(page).locator(`[data-node-id="${nodeId}"]`);
const drawer = page => page.getByRole('dialog', { name: 'Node' });

async function openNodeTree(page, fileKey) {
  await page.goto(`/ui/files/${fileKey}/nodes`);
  await expect(nodes(page)).toBeVisible();
}

test('viewer browses files, expands a frame and an instance, and sees no actions', async ({ page }) => {
  const { fileKey, fileName } = await seedFile();
  await signIn(page, TOKENS.viewer);

  const files = page.getByRole('table', { name: 'Tracked files' });
  const fileRow = files.getByRole('row', { name: fileName });
  await expect(fileRow).toBeVisible();
  await fileRow.click();
  await expect(page).toHaveURL(new RegExp(`/ui/files/${fileKey}/nodes`));
  await expect(page.getByRole('heading', { level: 1, name: 'Page' })).toBeVisible();

  await page.getByText('Expand instances', { exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Expand instances' })).toBeChecked();
  await expect(page).toHaveURL(/expand=instances/);
  await page.getByRole('button', { name: 'Expand Card' }).click();
  await expect(row(page, INSTANCE)).toBeVisible();
  await row(page, INSTANCE).getByRole('button', { name: 'Expand Button' }).click();
  await expect(row(page, MAIN_CHILD)).toBeVisible();
  const expandInstances = page.getByRole('switch', { name: 'Expand instances' });
  await page.getByText('Expand instances', { exact: true }).click();
  await expect(expandInstances).not.toBeChecked();
  await expect(row(page, INSTANCE)).toBeVisible();
  await page.getByText('Expand instances', { exact: true }).click();
  await expect(expandInstances).toBeChecked();
  await expect(row(page, MAIN_CHILD)).toBeVisible();

  await row(page, FRAME).getByText('Card', { exact: true }).click();
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page).getByRole('heading', { name: 'Card' })).toBeVisible();
  for (const name of [/^Block/, 'Unblock', 'Release claim']) {
    await expect(drawer(page).getByRole('button', { name })).toHaveCount(0);
  }
  await page.keyboard.press('Escape');
  await expect(drawer(page)).toBeHidden();

  await signOut(page);
  await page.goto('/ui/files');
  await expect(page).toHaveURL(/\/ui\/sign-in/);
});

test('agent blocks and unblocks a node and releases a claim', async ({ page }) => {
  const { fileKey } = await seedFile();
  await claim(fileKey, [INSTANCE], 'portal-e2e-agent');
  await signIn(page, TOKENS.agent);
  await openNodeTree(page, fileKey);
  await page.getByRole('button', { name: 'Expand Card' }).click();

  await row(page, FRAME).getByText('Card', { exact: true }).click();
  const frame = drawer(page);
  await frame.getByRole('button', { name: 'Block…' }).click();
  await frame.getByLabel('Reason').fill('Waiting on final copy from design');
  await frame.getByRole('button', { name: 'Block node' }).click();
  await expect(frame.getByText('Blocked by', { exact: false })).toBeVisible();
  await expect(row(page, FRAME)).toContainText('Blocked');
  await frame.getByRole('button', { name: 'Unblock' }).click();
  await expect(frame.getByRole('button', { name: 'Block…' })).toBeVisible();
  await expect(row(page, FRAME)).not.toContainText('Blocked');
  await page.keyboard.press('Escape');

  await expect(row(page, INSTANCE)).toContainText('portal-e2e-agent');
  await row(page, INSTANCE).getByText('Button', { exact: true }).click();
  const instance = drawer(page);
  await instance.getByRole('button', { name: 'Release claim' }).click();
  await expect(instance.getByRole('button', { name: 'Release claim' })).toHaveCount(0);
  await expect(row(page, INSTANCE)).toContainText('unclaimed');
  await page.keyboard.press('Escape');
});

test('an API claim pops a sprite onto its row and a clear poofs it, without a reload', async ({ page }) => {
  const { fileKey } = await seedFile();
  await signIn(page, TOKENS.viewer);
  await openNodeTree(page, fileKey);
  const frame = row(page, FRAME);
  await expect(frame).toContainText('unclaimed');
  await expect(page.getByText('live events on')).toBeVisible();
  await page.evaluate(() => {
    window.__noReload = true;
  });

  const worker = 'portal-e2e-live';
  await claim(fileKey, [FRAME], worker);
  const sprite = frame.locator('[data-state]');
  await expect(sprite).toHaveCount(1);
  await expect(frame).toContainText(worker);
  await expect(frame).toContainText('claimed');

  await clear(fileKey, [FRAME]);
  await expect(sprite).toHaveCount(0);
  await expect(frame).toContainText('unclaimed');
  await expect(frame).toContainText('Clean');
  await expect(frame).not.toContainText('Dirty');
  expect(await page.evaluate(() => window.__noReload)).toBe(true);
});

test('sidebar navigation, old links redirecting, the scope panel and the theme', async ({ page }) => {
  const { fileKey } = await seedFile();
  await signIn(page, TOKENS.viewer);
  const sidebar = page.getByRole('navigation', { name: 'Main' });
  for (const name of ['Files', 'Nodes', 'Work Items', 'Activity', 'Claims', 'Connect']) await expect(sidebar.getByRole('link', { name: name === 'Activity' ? /^Activity/ : name, exact: true })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Agents', exact: true })).toHaveCount(0);

  await page.goto('/ui/agents');
  await expect(page).toHaveURL(/\/ui\/claims$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Claims' })).toBeVisible();
  await page.goto(`/ui/files/${fileKey}/activity?paused=1`);
  await expect(page).toHaveURL(/\/ui\/activity\?paused=1$/);

  await page.goto(`/ui/files/${fileKey}/scopes`);
  await expect(page).toHaveURL(new RegExp(`/ui/files/${fileKey}/nodes\\?under=`));
  await expect(page.getByRole('tablist')).toHaveCount(0);
  const scopes = page.getByRole('table', { name: 'Scopes' });
  await expect(scopes.getByRole('checkbox', { name: 'Select Page' })).toBeChecked();
  await expect(page.getByText('1 Scope Viewed')).toBeVisible();
  await expect(nodes(page)).toBeVisible();

  await sidebar.getByRole('link', { name: 'Work Items' }).click();
  await expect(page).toHaveURL(new RegExp(`/ui/files/${fileKey}/work`));
  await page.getByRole('button', { name: 'View Nodes' }).click();
  await expect(page).toHaveURL(new RegExp(`/ui/files/${fileKey}/nodes\\?under=`));

  await page.getByText('View Scopes', { exact: true }).click();
  await expect(scopes).toHaveCount(0);
  await page.reload();
  await expect(nodes(page)).toBeVisible();
  await expect(page.getByRole('table', { name: 'Scopes' })).toHaveCount(0);

  const theme = await page.locator('html').getAttribute('data-theme');
  await page.getByRole('switch', { name: 'Dark mode' }).click({ force: true });
  const next = theme === 'dark' ? 'light' : 'dark';
  await expect(page.locator('html')).toHaveAttribute('data-theme', next);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', next);
});

test('several scopes: the union of their nodes, an "N scopes" header and the Work Items controls', async ({ page }) => {
  const { fileKey } = await seedFile();
  await syncSecondScope(fileKey);
  await signIn(page, TOKENS.viewer);
  await page.goto(`/ui/files/${fileKey}/nodes?under=${ROOT}`);
  const scopes = page.getByRole('table', { name: 'Scopes' });
  await expect(row(page, FRAME)).toBeVisible();
  await scopes.getByRole('checkbox', { name: 'Select Settings' }).click({ force: true });
  await expect(page).toHaveURL(/under=(50%3A1%2C1%3A1|1%3A1%2C50%3A1|50:1,1:1|1:1,50:1)/);
  await expect(page.getByRole('heading', { level: 1, name: '2 scopes' })).toBeVisible();
  await expect(page.getByText('2 Scopes Viewed')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open in Figma' })).toHaveCount(0);
  await expect(row(page, '50:2')).toBeVisible();
  await expect(row(page, FRAME)).toBeVisible();

  await page.goto(`/ui/files/${fileKey}/work?under=${ROOT},${SECOND}&group=frame`);
  await expect(page.getByRole('heading', { level: 1, name: '2 scopes' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'By frame' })).toBeDisabled();
  await expect(page.getByRole('radio', { name: 'By component' })).toBeChecked();
  await expect(page.getByText('2 Scopes Viewed')).toBeVisible();
  await page.getByRole('switch', { name: 'Expand instances' }).click({ force: true });
  await expect(page).toHaveURL(/expand=none/);
  await page.getByRole('searchbox', { name: 'Search nodes' }).fill('Button');
  await expect(page).toHaveURL(/q=Button/);
  await expect(page.getByRole('table', { name: 'Work items' })).toBeVisible();

  await page.goto(`/ui/files/${fileKey}/work?under=${ROOT}`);
  await expect(page.getByRole('radio', { name: 'By frame' })).toBeEnabled();
  await expect(page.getByText('1 Scope Viewed')).toBeVisible();
});

test('file settings: an agent turns library tracking off and on; a viewer sees it read-only', async ({ page }) => {
  const { fileKey, fileName } = await seedFile();
  await signIn(page, TOKENS.agent);
  await page.goto(`/ui/files/${fileKey}/work?under=${ROOT}`);
  await page.getByRole('button', { name: 'File settings' }).click();
  const settings = page.getByRole('dialog', { name: 'File settings' });
  await expect(settings.getByText(fileName)).toBeVisible();
  const toggle = settings.getByRole('switch', { name: /Track library components/ });
  await expect(toggle).toBeChecked();
  await expect(toggle).toBeEnabled();
  await expect(settings.getByText(/^Links to library files: /)).toBeVisible();

  const patched = page.waitForResponse(res => res.request().method() === 'PATCH' && res.url().endsWith(`/v3/files/${fileKey}`));
  await settings.getByText('Track library components', { exact: true }).click();
  expect((await patched).status()).toBe(200);
  await expect(page.getByRole('region', { name: 'Notifications' }).getByText('Library components are no longer tracked')).toBeVisible();
  await expect(toggle).not.toBeChecked();
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();

  await page.reload();
  await page.getByRole('button', { name: 'File settings' }).click();
  const reopened = page.getByRole('dialog', { name: 'File settings' });
  const again = reopened.getByRole('switch', { name: /Track library components/ });
  await expect(again).not.toBeChecked();
  await expect(again).toBeEnabled();
  await reopened.getByText('Track library components', { exact: true }).click();
  await expect(again).toBeChecked();
  await page.keyboard.press('Escape');

  await signOut(page);
  await signIn(page, TOKENS.viewer);
  await page.goto(`/ui/files/${fileKey}/work?under=${ROOT}`);
  await page.getByRole('button', { name: 'File settings' }).click();
  const readOnly = page.getByRole('dialog', { name: 'File settings' });
  await expect(readOnly.getByText('Sign in with an agent token to change file settings.')).toBeVisible();
  await expect(readOnly.getByRole('switch', { name: /Track library components/ })).toBeDisabled();
});

test('a removed screen is one Removed work item; its row opens the Removal panel', async ({ page }) => {
  const { fileKey } = await seedFile();
  await syncRemovedScreen(fileKey);
  await signIn(page, TOKENS.viewer);
  await page.goto(`/ui/files/${fileKey}/work?under=${ROOT}`);
  const work = page.getByRole('table', { name: 'Work items' });
  const removed = work.getByRole('row', { name: 'Old screen' });
  await expect(removed.getByText('Removed', { exact: true })).toBeVisible();
  await expect(removed.getByText('3 layers removed')).toBeVisible();
  await removed.getByText('Old screen', { exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`node=${REMOVED.replace(':', '(%3A|:)')}`));
  const panel = drawer(page).getByRole('group', { name: 'Removed from the design' });
  await expect(panel.getByText('Remove the code that rendered “Old screen”. Keep components that are still used.')).toBeVisible();
  await expect(panel.getByRole('listitem').filter({ hasText: 'Button' })).toContainText('Keep');
  await expect(panel.getByRole('button', { name: 'Copy removal prompt' })).toBeVisible();
});

test('design tokens: browse a collection, read a changed mode, open the token and its work item', async ({ page }) => {
  const { fileKey } = await seedFile();
  await syncTokens(fileKey);
  await signIn(page, TOKENS.viewer);
  await page.goto(`/ui/files/${fileKey}/nodes?under=tokens`);
  await expect(page.getByRole('heading', { level: 1, name: 'Design tokens' })).toBeVisible();
  await row(page, TOKEN_COLLECTION).getByRole('button', { name: 'Expand Semantic' }).click();
  const token = row(page, TOKEN);
  await expect(token.getByText('VARIABLE · COLOR · --color-bg-active')).toBeVisible();
  await expect(token.getByText('Dark', { exact: true })).toBeVisible();
  await expect(token.getByText('#202527')).toBeVisible();
  await expect(token.getByText('#2b3033')).toBeVisible();

  await token.getByText('Colors/bg-active', { exact: true }).click();
  await expect(drawer(page).getByRole('heading', { name: /Colors\/bg-active/ })).toContainText('Token');
  await expect(drawer(page).getByText('Used by 1 layer')).toBeVisible();
  await expect(drawer(page).getByRole('link', { name: 'Open in Figma' })).toHaveCount(0);
  await drawer(page).getByRole('tab', { name: 'Change List' }).click();
  const change = drawer(page).getByRole('table', { name: 'Change list' }).getByRole('row').nth(1);
  await expect(change).toContainText('value:Dark');
  await expect(change).toContainText('#2b3033');
  await page.keyboard.press('Escape');

  await page.goto(`/ui/files/${fileKey}/work?under=tokens`);
  const item = page.getByRole('table', { name: 'Work items' }).getByRole('row', { name: 'Semantic' });
  await expect(item.getByText('Tokens', { exact: true })).toBeVisible();
  await expect(item.getByText('1 token changed')).toBeVisible();
  await item.getByText('Semantic', { exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/nodes\\?under=${encodeURIComponent(TOKEN_COLLECTION).replace('%3A', '(%3A|:)')}`));
  await expect(row(page, TOKEN)).toBeVisible();
});
