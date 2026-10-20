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
  focus() { El.focused = this; }
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
  assert.equal(u.$('spinner').hidden, true);
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

test('progress without a total shows a spinner next to the running count instead of the bar', () => {
  const u = ui();
  assert.equal(u.$('spinner').hidden, true);
  assert.equal(u.$('spinner').getAttribute('aria-hidden'), 'true');
  u.receive({ type: 'busy', value: true });
  assert.equal(u.$('bar').hidden, true);
  assert.equal(u.$('spinner').hidden, false);
  u.receive({ type: 'progress', phase: 'Uploading', count: 10, total: 20 });
  assert.equal(u.$('spinner').hidden, true);
  assert.equal(u.$('bar').hidden, false);
  for (const phase of ['Fetching stored hashes', 'Scanning', 'Comparing', 'Scanning main components']) {
    u.receive({ type: 'progress', phase, count: 500 });
    assert.equal(u.$('spinner').hidden, false, phase);
    assert.equal(u.$('bar').hidden, true, phase);
    assert.equal(u.$('busy').textContent, phase + ': 500 nodes');
  }
  const bar = u.$('bar');
  for (const a of ['aria-valuenow', 'aria-valuemin', 'aria-valuemax']) assert.equal(bar.hasAttribute(a), false);
  assert.equal(u.$('bar-fill').style.width, '');
  assert.equal(u.$('busy').getAttribute('role'), 'status');
  u.receive({ type: 'confirm-new-layers', id: 1, added: 30, total: 40 });
  assert.equal(u.$('spinner').hidden, true, 'paused for the prompt');
  u.receive({ type: 'busy', value: false });
  assert.equal(u.$('spinner').hidden, true);
  assert.equal(u.$('bar').hidden, true);
});

test('the spinner spins only without reduced motion; spinner and bar use Figma theme variables', () => {
  assert.match(HTML, /<div class="status"><span id="spinner" aria-hidden="true" hidden><\/span><div id="busy" role="status"><\/div><\/div>/);
  assert.match(HTML, /#spinner\{[^}]*border:2px solid var\(--figma-color-bg-tertiary,[^}]*border-top-color:var\(--figma-color-bg-brand,[^}]*animation:spin/);
  assert.match(HTML, /@media \(prefers-reduced-motion:reduce\)\{[^@]*#spinner\{animation:none/);
  assert.doesNotMatch(HTML, /indeterminate|bar-slide/);
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

const ASK = { type: 'confirm-new-layers', id: 7, added: 1234, total: 1500 };
function asking() {
  const u = ui();
  u.$('upload').onclick(); u.receive({ type: 'busy', value: true }, ASK); u.posted.length = 0;
  return u;
}
test('"already built?" prompt: counts, rationale, three enabled choices, focus on the first; progress paused', () => {
  const u = ui();
  assert.equal(u.$('prompt').hidden, true);
  assert.equal(u.$('prompt').getAttribute('role'), 'alertdialog');
  assert.equal(u.$('prompt').getAttribute('aria-labelledby'), 'prompt-title');
  assert.equal(u.$('prompt').getAttribute('aria-describedby'), 'prompt-text');
  u.$('upload').onclick(); u.receive({ type: 'busy', value: true }, ASK);
  assert.equal(u.$('prompt').hidden, false);
  assert.equal(u.$('prompt-title').textContent, '1,234 of 1,500 layers are new to Rolling Design Sync.');
  assert.match(HTML, /<p id="prompt-text">If the code already matches them[^<]*mark them as implemented/);
  assert.match(HTML, />Mark as implemented<\/button><button id="prompt-new">Track as new work<\/button><button id="prompt-cancel">Cancel<\/button>/);
  for (const id of ['prompt-implemented', 'prompt-new', 'prompt-cancel']) assert.equal(u.$(id).disabled, false, id);
  assert.equal(El.focused, u.$('prompt-implemented'));
  assert.equal(u.$('bar').hidden, true);
  assert.match(u.$('busy').textContent, /Paused/);
});
for (const [button, choice] of [['prompt-implemented', 'implemented'], ['prompt-new', 'new'], ['prompt-cancel', 'cancel']])
  test(`prompt button "${button}" answers "${choice}" with the request id and closes the prompt`, () => {
    const u = asking();
    u.$(button).onclick();
    assert.deepEqual(JSON.parse(JSON.stringify(u.posted)), [{ type: 'new-layers-choice', id: 7, choice }]);
    assert.equal(u.$('prompt').hidden, true);
    u.$(button).onclick(); assert.equal(u.posted.length, 1, 'a closed prompt does not answer twice');
  });
test('Escape and the main Cancel button answer the prompt with "cancel"', () => {
  let u = asking(); let prevented = false;
  u.$('prompt').onkeydown({ key: 'Enter', preventDefault() {} }); assert.equal(u.posted.length, 0);
  u.$('prompt').onkeydown({ key: 'Escape', preventDefault() { prevented = true; } });
  assert.ok(prevented);
  assert.deepEqual(JSON.parse(JSON.stringify(u.posted)), [{ type: 'new-layers-choice', id: 7, choice: 'cancel' }]);
  u = asking(); u.$('cancel').onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(u.posted)), [{ type: 'new-layers-choice', id: 7, choice: 'cancel' }]);
});
test('the prompt is cleared by the next upload, by the run ending and by an error', () => {
  let u = asking(); u.$('upload').onclick(); assert.equal(u.$('prompt').hidden, true);
  u = asking(); u.receive({ type: 'busy', value: false }); assert.equal(u.$('prompt').hidden, true);
  assert.equal(u.$('prompt-new').disabled, true);
  u = asking(); u.receive({ type: 'error', message: 'boom' }); assert.equal(u.$('prompt').hidden, true);
});
test('the prompt uses Figma theme variables and a visible keyboard focus ring', () => {
  assert.match(HTML, /#prompt\{[^}]*border:1px solid var\(--figma-color-border-brand[^}]*background:var\(--figma-color-bg-brand-tertiary[^}]*color:var\(--figma-color-text/);
  assert.match(HTML, /#prompt button:focus-visible\{outline:2px solid var\(--figma-color-border-selected/);
});
test('the result says how many library components were not tracked because of the file setting', () => {
  const u = ui();
  u.receive({ ...SYNCED, mains: { librarySkipped: 12 } });
  assert.match(u.$('result-note').textContent, / 12 library components not tracked \(file setting\)\.$/);
  u.receive({ ...SYNCED, mains: { librarySkipped: 1 } });
  assert.match(u.$('result-note').textContent, / 1 library component not tracked \(file setting\)\.$/);
  u.receive(SYNCED);
  assert.doesNotMatch(u.$('result-note').textContent, /library/);
});
test('the result reports the design tokens pass with a tokens stat', () => {
  const u = ui();
  u.receive({ ...SYNCED, tokens: { tracked: 48, changed: 1, added: 2, unchanged: 45, deleted: 0 } });
  assert.match(u.$('result-note').textContent, / Tokens: 48 tracked, 1 changed, 2 new\.$/);
  const tile = u.$('stats').children.find(s => s.children[1].textContent === 'tokens');
  assert.equal(tile.children[0].textContent, '48');
  u.receive({ ...SYNCED, tokens: { tracked: 3, changed: 0, added: 0, deleted: 1 } });
  assert.match(u.$('result-note').textContent, / Tokens: 3 tracked, 0 changed, 0 new, 1 deleted\.$/);
  u.receive(SYNCED);
  assert.doesNotMatch(u.$('result-note').textContent, /Tokens/);
});
test('the result reports check-target references and the export phase counts targets', () => {
  const u = ui();
  u.receive({ type: 'busy', value: true }, { type: 'progress', phase: 'Exporting check targets', count: 1, total: 2 });
  assert.equal(u.$('busy').textContent, 'Exporting check targets: 1 / 2 targets');
  u.receive({ type: 'busy', value: false }, { ...NO_CHANGES, references: { needed: 2, updated: 2, skipped: 0, warnings: [] } });
  assert.match(u.$('result-note').textContent, / Check targets: 2 references updated\.$/);
  assert.match(u.$('message').textContent, /; 2 check-target references updated\./);
  u.receive({ ...SYNCED, references: { needed: 3, updated: 1, skipped: 2, warnings: [] } });
  assert.match(u.$('result-note').textContent, / Check targets: 1 reference updated, 2 skipped\.$/);
  for (const references of [null, { needed: 0, updated: 0, skipped: 0, warnings: [] }]) {
    u.receive({ ...NO_CHANGES, references });
    assert.doesNotMatch(u.$('result-note').textContent, /Check targets/);
    assert.equal(u.$('message').textContent, 'Sync complete. No changes since the last sync.');
  }
});

test('the check switch is on by default, shows the value saved on the section, and saves a change at once', () => {
  const u = ui();
  assert.equal(u.$('scope-checks').checked, true);
  assert.ok(HTML.includes('Saved on the section and sent with each sync. Its top-level frames and main components become check targets, rendered from the app\'s gallery or their page. Uncheck to skip this section; exclude a single frame in the portal.'));
  u.receive({ type: 'scope', id: '1:1', name: 'Screens', nodeType: 'SECTION', checks: false });
  assert.equal(u.$('scope-checks').checked, false);
  u.receive({ type: 'scope', id: '1:2', name: 'Other', nodeType: 'SECTION', checks: true });
  assert.equal(u.$('scope-checks').checked, true);
  u.posted.length = 0;
  u.$('scope-checks').checked = false; u.$('scope-checks').onchange();
  assert.deepEqual(JSON.parse(JSON.stringify(u.posted)), [{ type: 'set-scope-checks', checks: false }]);
  u.receive({ type: 'busy', value: true });
  assert.equal(u.$('scope-checks').disabled, true);
});
