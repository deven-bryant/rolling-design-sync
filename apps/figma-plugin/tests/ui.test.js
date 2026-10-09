/* ui.html: runs the inline script against a minimal DOM stand-in and drives it with plugin messages. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const HTML = fs.readFileSync(path.join(__dirname, '../ui.html'), 'utf8');
const SCRIPT = /<script>([\s\S]*)<\/script>/.exec(HTML)[1];

class El {
  constructor(tag, attrs = '') {
    this.tagName = tag.toUpperCase(); this.children = []; this.attributes = new Map(); this.style = {};
    this.textContent = ''; this.value = ''; this.disabled = false; this.checked = false;
    this.className = (/\bclass="([^"]*)"/.exec(attrs) || [])[1] || '';
    this.hidden = /\shidden\b/.test(' ' + attrs);
    this.type = (/\btype="([^"]*)"/.exec(attrs) || [])[1] || '';
    for (const [, k, v] of attrs.matchAll(/\b((?:role|aria-[\w-]+))="([^"]*)"/g)) this.attributes.set(k, v);
  }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
  hasAttribute(k) { return this.attributes.has(k); }
  removeAttribute(k) { this.attributes.delete(k); }
  append(...c) { this.children.push(...c); }
  replaceChildren(...c) { this.children = c; }
}
function ui() {
  const els = new Map();
  for (const [, tag, attrs] of HTML.matchAll(/<(\w+)((?:\s[^>]*)?\sid="[^"]+"[^>]*)>/g)) els.set(/\sid="([^"]+)"/.exec(attrs)[1], new El(tag, attrs));
  const posted = [];
  const ctx = {
    setTimeout,
    parent: { postMessage: m => posted.push(m.pluginMessage) },
    document: {
      getElementById: id => els.get(id) || null,
      createElement: tag => new El(tag),
      querySelectorAll: sel => [...els.values()].filter(e => e.tagName === sel.toUpperCase()),
    },
  };
  vm.runInNewContext(SCRIPT, ctx);
  const $ = id => els.get(id);
  const receive = (...ms) => { for (const m of ms) ctx.onmessage({ data: { pluginMessage: m } }); };
  receive({ type: 'settings', settings: { baseUrl: 'https://api.example.test', token: 'secret' } },
    { type: 'scope', id: '1:1', name: 'Screens', nodeType: 'SECTION' });
  return { $, receive, posted };
}
const SYNCED = { type: 'synced', scopeId: '1:1', tracked: 3, batches: 1, changed: 1, added: 2, deleted: 0, unchanged: 0, mains: {}, result: { dirty: 3 } };
const NO_CHANGES = { ...SYNCED, changed: 0, added: 0, result: { dirty: 0 } };

test('header shows the product name and the version the plugin sends; the primary button is brand teal', () => {
  assert.match(HTML, /<h1>Rolling Design Sync <small id="version"/);
  assert.doesNotMatch(HTML, /Design change sync|0\.4\.0|#1769e0/);
  assert.match(HTML, /button\.primary\{background:#1f6e84;border-color:#1f6e84;/);
  assert.match(HTML, /button\.primary:hover:not\(:disabled\)\{background:#145d6e;/);
  const u = ui();
  u.receive({ type: 'version', version: '1.2.3' });
  assert.equal(u.$('version').textContent, '1.2.3');
});

test('progress with a total renders a determinate bar and "phase: count / total nodes"', () => {
  const u = ui();
  assert.equal(u.$('bar').hidden, true);
  assert.equal(u.$('bar').getAttribute('role'), 'progressbar');
  u.receive({ type: 'busy', value: true }, { type: 'progress', phase: 'Uploading', count: 1200, total: 3400 });
  const bar = u.$('bar');
  assert.equal(bar.hidden, false);
  assert.equal(bar.className, '');
  assert.equal(u.$('busy').textContent, `Uploading: ${(1200).toLocaleString()} / ${(3400).toLocaleString()} nodes`);
  assert.deepEqual([bar.getAttribute('aria-valuemin'), bar.getAttribute('aria-valuenow'), bar.getAttribute('aria-valuemax')], ['0', '1200', '3400']);
  assert.equal(u.$('bar-fill').style.width, (100 * 1200 / 3400) + '%');
  u.receive({ type: 'progress', phase: 'Checking main components', count: 4, total: 4 });
  assert.equal(u.$('busy').textContent, 'Checking main components: 4 / 4 nodes');
  assert.equal(u.$('bar-fill').style.width, '100%');
  u.receive({ type: 'busy', value: false });
  assert.equal(bar.hidden, true);
  assert.equal(u.$('busy').textContent, '');
});

test('progress without a total renders an indeterminate bar and the running count', () => {
  const u = ui();
  u.receive({ type: 'busy', value: true });
  assert.equal(u.$('bar').hidden, false);
  assert.equal(u.$('bar').className, 'indeterminate');
  u.receive({ type: 'progress', phase: 'Uploading', count: 10, total: 20 }, { type: 'progress', phase: 'Scanning', count: 500 });
  const bar = u.$('bar');
  assert.equal(bar.className, 'indeterminate');
  assert.equal(u.$('busy').textContent, 'Scanning: 500 nodes');
  for (const a of ['aria-valuenow', 'aria-valuemin', 'aria-valuemax']) assert.equal(bar.hasAttribute(a), false);
  assert.equal(u.$('bar-fill').style.width, '');
});

test('the indeterminate bar animates only without reduced motion and uses Figma theme variables', () => {
  assert.match(HTML, /#bar\.indeterminate #bar-fill\{[^}]*animation:bar-slide/);
  assert.match(HTML, /@media \(prefers-reduced-motion:reduce\)\{[^@]*#bar\.indeterminate #bar-fill\{animation:none/);
  assert.match(HTML, /#bar\{[^}]*var\(--figma-color-bg-tertiary,/);
  assert.match(HTML, /#bar-fill\{[^}]*var\(--figma-color-bg-brand,/);
});

test('Upload snapshot clears the previous message and result before the run starts', () => {
  const u = ui();
  u.receive(SYNCED, { type: 'error', message: 'Previous failure' });
  assert.equal(u.$('result-area').hidden, false);
  assert.equal(u.$('message').className, 'error');
  u.$('upload').onclick();
  assert.equal(u.$('message').textContent, '');
  assert.equal(u.$('message').className, '');
  assert.equal(u.$('result-area').hidden, true);
  assert.equal(u.$('stats').children.length, 0);
  assert.equal(u.$('raw').textContent, '');
  assert.equal(u.posted.at(-1).type, 'upload');
});

test('a successful sync shows a green success message that stays until the next upload', () => {
  assert.match(HTML, /#message\.success\{color:var\(--figma-color-text-success,[^)]*\);background:var\(--figma-color-bg-success-tertiary,/);
  const u = ui();
  u.$('upload').onclick();
  u.receive({ type: 'busy', value: true }, { type: 'progress', phase: 'Uploading', count: 3, total: 3 }, SYNCED, { type: 'busy', value: false });
  const msg = u.$('message');
  assert.equal(msg.className, 'success');
  assert.equal(msg.getAttribute('role'), 'status');
  assert.match(msg.textContent, /^Sync complete: 1 changed, 2 new, 0 deleted uploaded\./);
  u.receive({ type: 'scope', id: '1:1', name: 'Screens', nodeType: 'SECTION' }, { type: 'busy', value: true }, { type: 'busy', value: false });
  assert.equal(msg.className, 'success');
  assert.match(msg.textContent, /^Sync complete/);
  u.$('upload').onclick();
  assert.equal(msg.className, '');
  assert.equal(msg.textContent, '');
  u.receive(NO_CHANGES);
  assert.equal(msg.className, 'success');
  assert.equal(msg.textContent, 'Sync complete. No changes since the last sync.');
});

test('errors still show in the error style and replace a success message', () => {
  assert.match(HTML, /#message\.error\{color:var\(--figma-color-text-danger,/);
  const u = ui();
  u.receive(SYNCED, { type: 'error', message: 'Invalid bearer token' });
  assert.equal(u.$('message').className, 'error');
  assert.equal(u.$('message').textContent, 'Invalid bearer token');
  u.receive({ type: 'notice', message: 'Settings saved on this machine.' });
  assert.equal(u.$('message').className, '');
});
