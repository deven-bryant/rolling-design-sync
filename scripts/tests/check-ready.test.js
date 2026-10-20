'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { run, fillTemplate, findStory, themed } = require('../rds-agent');

const env = { RDS_API_BASE_URL: 'https://rds.example.com', RDS_AGENT_TOKEN: 'agent-secret' };
const PNG = Buffer.from('fake-png-bytes');
const ELEMENT_PNG = Buffer.from('fake-element-png');
const base = ['--file-key', 'fk', '--base-url', 'http://localhost:3000'];
const SB = 'http://localhost:6006';

function sink() {
  const chunks = [];
  return { write: s => chunks.push(s), text: () => chunks.join('') };
}

const look = { theme: null, query: null, themeMode: 'color-scheme', themeKey: 'theme' };
const component = (nodeId, extra = {}, render = {}) => ({
  nodeId, name: `Button ${nodeId}`, level: 'component', status: 'ready', contains: [], waitingOn: null, gallery: null, ...extra,
  render: {
    gallery: { urlTemplate: '/gallery?figma={set}&variant={variant}', storybookUrl: null }, key: `key-${nodeId}`, nodeId, set: 'Button',
    variant: 'Size=sm, State=Hover', props: { Size: 'sm', State: 'Hover' }, ...look, viewport: { width: 120, height: 40 }, cache: null, ...render,
  },
});
const screen = (nodeId, extra = {}, render = {}) => ({
  nodeId, name: `Screen ${nodeId}`, level: 'screen', status: 'ready', contains: [], waitingOn: null, familyKey: `fam-${nodeId}`, route: '/files', ...extra,
  render: { route: '/files', ...look, viewport: { width: 1440, height: 900 }, ...render },
});

/**
 * A fake API + Storybook. `results` maps nodeId → the submitted check's outcome
 * ({ status, score } or { problem }); every target gets check `c-<nodeId>`.
 */
function fakeApi({ targets = [], results = {}, storybook = null }) {
  const calls = [];
  const reply = (status, body) => ({ ok: status < 300, status, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body) });
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, url: u.toString(), path: u.pathname, query: Object.fromEntries(u.searchParams), body });
    if (u.origin === SB) {
      if (u.pathname === '/index.json' && storybook) return reply(200, storybook);
      return reply(404, {});
    }
    const p = decodeURIComponent(u.pathname);
    if (init.method === 'GET' && p === '/v3/files/fk/targets') {
      return reply(200, { fileKey: 'fk', targets: targets.filter(t => (!u.searchParams.get('status') || t.status === u.searchParams.get('status')) && (!u.searchParams.get('level') || t.level === u.searchParams.get('level'))) });
    }
    let m = /^\/v3\/files\/fk\/targets\/(.+)$/.exec(p);
    if (init.method === 'PATCH' && m) {
      const t = targets.find(x => x.nodeId === m[1]);
      return reply(200, { fileKey: 'fk', target: { ...t, ...(body.route ? { route: body.route } : {}) } });
    }
    m = /^\/v3\/files\/fk\/screens\/(.+)\/checks$/.exec(p);
    if (init.method === 'POST' && m) return reply(200, { fileKey: 'fk', created: true, check: { checkId: `c-${m[1]}`, nodeId: m[1], status: 'requested' } });
    m = /^\/v3\/files\/fk\/checks\/c-(.+)\/result$/.exec(p);
    if (init.method === 'POST' && m) {
      const r = results[m[1]] || { status: 'passed', score: 0 };
      if (r.problem) return reply(409, { type: 'about:blank', title: 'Reference missing', status: 409, detail: r.problem });
      return reply(200, { fileKey: 'fk', check: { checkId: `c-${m[1]}`, nodeId: m[1], threshold: 1, regions: [], ...r } });
    }
    return reply(404, { title: 'Not found', detail: `${init.method} ${u.pathname}`, status: 404 });
  };
  const submitted = () => calls.filter(c => /\/result$/.test(c.path)).map(c => decodeURIComponent(c.path).replace(/^.*\/checks\/c-|\/result$/g, ''));
  return { calls, fetchImpl, submitted };
}

/** A fake Playwright; `elements` lists the selectors present on every page. */
function fakePlaywright({ elements = [] } = {}) {
  const log = { launches: 0, contexts: [], pages: [] };
  const browserType = {
    launch: async () => {
      log.launches++;
      return {
        newContext: async options => {
          log.contexts.push(options);
          return {
            newPage: async () => {
              const page = { url: null, initScripts: [], shot: null };
              log.pages.push(page);
              return {
                setDefaultTimeout: () => {},
                addInitScript: async script => { page.initScripts.push(script); },
                clock: { setFixedTime: async () => {} },
                goto: async url => { page.url = url; },
                evaluate: async () => true,
                locator: selector => ({
                  count: async () => (elements.includes(selector) ? 1 : 0),
                  first: () => ({ screenshot: async () => { page.shot = selector; return ELEMENT_PNG; } }),
                }),
                screenshot: async options => { page.shot = options.fullPage === false ? 'viewport' : '?'; return PNG; },
              };
            },
            close: async () => {},
          };
        },
        close: async () => {},
      };
    },
  };
  return { log, module: { chromium: browserType, firefox: browserType, webkit: browserType } };
}

const runCheck = (argv, api, pw, out = sink(), err = sink()) => run(['check', ...argv], { env, fetchImpl: api.fetchImpl, stdout: out, stderr: err, playwright: pw.module, cwd: '/' });

test('check --ready: lists ready targets and checks them in API order, components through the gallery then screens', async () => {
  const api = fakeApi({ targets: [component('1:1'), component('1:2', { contains: ['1:1'] }), screen('2:1'), screen('2:2', { status: 'passed' })] });
  const pw = fakePlaywright({ elements: ['[data-rds-target]'] });
  const out = sink();
  assert.equal(await runCheck([...base, '--ready'], api, pw, out), 0);
  assert.deepEqual(api.calls[0].query, { status: 'ready' });
  assert.deepEqual(api.submitted(), ['1:1', '1:2', '2:1']);
  assert.deepEqual(pw.log.pages.map(p => p.url), [
    'http://localhost:3000/gallery?figma=Button&variant=Size%3Dsm%2C%20State%3DHover',
    'http://localhost:3000/gallery?figma=Button&variant=Size%3Dsm%2C%20State%3DHover',
    'http://localhost:3000/files',
  ]);
  assert.deepEqual(pw.log.contexts.map(c => c.viewport), [{ width: 120, height: 40 }, { width: 120, height: 40 }, { width: 1440, height: 900 }]);
  assert.deepEqual(pw.log.pages.map(p => p.shot), ['[data-rds-target]', '[data-rds-target]', 'viewport'], 'screens: the viewport');
  const result = api.calls.find(c => /\/result$/.test(c.path));
  assert.equal(result.body.image, ELEMENT_PNG.toString('base64'));
  const stored = api.calls.filter(c => c.method === 'PATCH').map(c => c.body);
  assert.deepEqual(stored[0], { gallery: { mapped: true, storyId: null, url: 'http://localhost:3000/gallery?figma=Button&variant=Size%3Dsm%2C%20State%3DHover' } });
  assert.match(out.text(), /^TARGET +NAME +LEVEL +RESULT +DETAIL$/m);
  assert.match(out.text(), /^3 checks: 3 passed, 0 mismatch, 0 errors$/m);
});

test('check --ready: a component mismatch skips the targets containing it (Waiting on); exit 1', async () => {
  const out2 = sink();
  const api2 = fakeApi({
    targets: [component('1:1'), component('1:2', { contains: ['1:1'] }), screen('2:1', { contains: ['1:2'] }), screen('2:2', { contains: ['1:9'] })],
    results: { '1:1': { status: 'mismatch', score: 7 } },
  });
  assert.equal(await runCheck([...base, '--ready'], api2, fakePlaywright(), out2), 1);
  assert.deepEqual(api2.submitted(), ['1:1', '2:2']);
  assert.match(out2.text(), /^1:2 {2}waiting {2}Waiting on Button 1:1 \(1:1\)$/m);
  assert.match(out2.text(), /^2:1 {2}waiting {2}Waiting on Button 1:1 \(1:1\)$/m);
  assert.match(out2.text(), /^4 checks: 1 passed, 1 mismatch, 0 errors, 2 waiting$/m);
});

test('check --all: every target; a target the API lists as waiting runs once its component passes in this run', async () => {
  const api = fakeApi({
    targets: [
      component('1:1', { status: 'mismatch' }),
      screen('2:1', { status: 'waiting', waitingOn: { nodeId: '1:1', name: 'Button' } }),
      screen('2:2', { status: 'waiting', waitingOn: { nodeId: '1:7', name: 'Card' } }),
    ],
  });
  const out = sink();
  assert.equal(await runCheck([...base, '--all'], api, fakePlaywright(), out), 0);
  assert.deepEqual(api.calls[0].query, {});
  assert.deepEqual(api.submitted(), ['1:1', '2:1']);
  assert.match(out.text(), /^2:2 {2}waiting {2}Waiting on Card \(1:7\)$/m);
});

test('check: not-mapped components are reported, stored as mapped:false and never block; --list-unmapped prints them', async () => {
  const targets = [
    component('1:1', {}, { gallery: { urlTemplate: null, storybookUrl: null } }),
    component('1:2', {}, { gallery: { urlTemplate: '/g/{prop.Tone}', storybookUrl: null } }),
    screen('2:1', { contains: ['1:1', '1:2'] }),
  ];
  const api = fakeApi({ targets });
  const out = sink();
  const err = sink();
  assert.equal(await runCheck([...base, '--ready'], api, fakePlaywright(), out, err), 0, err.text());
  assert.deepEqual(api.submitted(), ['2:1']);
  assert.match(out.text(), /^1:1 {2}not mapped {2}no gallery/m);
  assert.match(out.text(), /^1:2 {2}not mapped {2}gallery\.urlTemplate needs a value/m);
  assert.deepEqual(api.calls.filter(c => c.method === 'PATCH').map(c => c.body), [
    { gallery: { mapped: false, storyId: null, url: null } }, { gallery: { mapped: false, storyId: null, url: null } },
  ]);
  assert.match(out.text(), /^3 checks: 1 passed, 0 mismatch, 0 errors, 2 not mapped$/m);

  const cached = fakeApi({ targets: [component('1:1', {}, { gallery: { urlTemplate: null, storybookUrl: null }, cache: { mapped: false, storyId: null, url: null } }), component('1:3')] });
  const listed = sink();
  const pw = fakePlaywright();
  assert.equal(await runCheck(['--file-key', 'fk', '--list-unmapped'], cached, pw, listed), 0);
  assert.deepEqual(cached.calls[0].query, { level: 'component' });
  assert.equal(cached.calls.filter(c => c.method === 'PATCH').length, 0, 'unchanged not-mapped and mapped resolutions are not stored');
  assert.match(listed.text(), /^COMPONENT +SET +VARIANT +KEY +REASON$/m);
  assert.match(listed.text(), /^1:1 +Button +Size=sm, State=Hover +key-1:1 +no gallery/m);
  assert.doesNotMatch(listed.text(), /^1:3/m);
  assert.equal(pw.log.launches, 0);
});

test('check: Storybook — resolves figma:<key> (or figma-node:<nodeId>) tags from index.json and shoots #storybook-root', async () => {
  const storybook = {
    v: 5,
    entries: {
      'button--docs': { id: 'button--docs', type: 'docs', tags: ['figma:key-1:1'] },
      'button--hover': { id: 'button--hover', type: 'story', tags: ['dev', 'figma:key-1:1'] },
      'card--default': { id: 'card--default', type: 'story', tags: ['figma-node:1:2'] },
    },
  };
  const sb = { gallery: { urlTemplate: null, storybookUrl: SB } };
  const api = fakeApi({ storybook, targets: [component('1:1', {}, sb), component('1:2', {}, { ...sb, key: null }), component('1:3', {}, sb)] });
  const pw = fakePlaywright({ elements: ['#storybook-root'] });
  const out = sink();
  assert.equal(await runCheck([...base, '--ready'], api, pw, out), 0);
  assert.equal(api.calls.filter(c => c.url === `${SB}/index.json`).length, 1, 'the index is read once');
  assert.deepEqual(pw.log.pages.map(p => p.url), [`${SB}/iframe.html?id=button--hover&viewMode=story`, `${SB}/iframe.html?id=card--default&viewMode=story`]);
  assert.deepEqual(pw.log.pages.map(p => p.shot), ['#storybook-root', '#storybook-root']);
  assert.deepEqual(api.calls.filter(c => c.method === 'PATCH').map(c => c.body.gallery.storyId), ['button--hover', 'card--default', null]);
  assert.match(out.text(), /^1:3 {2}not mapped {2}no story tagged figma:key-1:3 or figma-node:1:3$/m);

  const flag = fakeApi({ storybook, targets: [component('1:1')] });
  const pw2 = fakePlaywright({ elements: ['#storybook-root [data-rds-target]', '#storybook-root'] });
  assert.equal(await runCheck([...base, '--ready', '--storybook', SB], flag, pw2), 0);
  assert.equal(pw2.log.pages[0].shot, '#storybook-root [data-rds-target]');

  const broken = fakeApi({ targets: [component('1:1', {}, sb)] });
  const err = sink();
  assert.equal(await runCheck([...base, '--ready'], broken, fakePlaywright(), sink(), err), 2);
  assert.match(err.text(), /could not read the Storybook index/);
});

test('check: theme modes — color-scheme emulation, query parameter, storage init script', async () => {
  const targets = [
    screen('2:1', {}, { theme: 'dark' }),
    screen('2:2', {}, { theme: 'dark', themeMode: 'query', themeKey: 'mode', query: 'tab=team' }),
    screen('2:3', {}, { theme: 'dark', themeMode: 'storage', themeKey: 'app-theme' }),
    component('1:1', {}, { theme: 'light', themeMode: 'query' }),
  ];
  const api = fakeApi({ targets });
  const pw = fakePlaywright();
  assert.equal(await runCheck([...base, '--all'], api, pw), 0);
  assert.equal(pw.log.contexts[0].colorScheme, 'dark');
  assert.equal(pw.log.pages[0].url, 'http://localhost:3000/files');
  assert.equal(pw.log.contexts[1].colorScheme, undefined);
  assert.equal(pw.log.pages[1].url, 'http://localhost:3000/files?tab=team&mode=dark');
  assert.equal(pw.log.contexts[2].colorScheme, undefined);
  assert.equal(pw.log.pages[2].initScripts.length, 1);
  assert.match(pw.log.pages[2].initScripts[0], /localStorage\.setItem\(k, v\)/);
  assert.match(pw.log.pages[2].initScripts[0], /k = "app-theme", v = "dark"/);
  assert.match(pw.log.pages[2].initScripts[0], /classList\.add\(v\)/);
  assert.equal(pw.log.pages[3].url, 'http://localhost:3000/gallery?figma=Button&variant=Size%3Dsm%2C%20State%3DHover&theme=light');

  // The storage script sets the key and the class before the page's own scripts run.
  const storage = new Map();
  const classes = new Set();
  const sandbox = { localStorage: { setItem: (k, v) => storage.set(k, v) }, document: { documentElement: { classList: { add: c => classes.add(c) } } } };
  new Function('localStorage', 'document', pw.log.pages[2].initScripts[0])(sandbox.localStorage, sandbox.document);
  assert.equal(storage.get('app-theme'), 'dark');
  assert.ok(classes.has('dark'));
});

test('check: a screen without a route is No route; --url renders it and saves the route for its family', async () => {
  const targets = [
    screen('2:1', { route: null, familyKey: 'files' }, { route: null }),
    screen('2:2', { route: null, familyKey: 'files' }, { route: null, theme: 'dark', themeMode: 'query' }),
    screen('2:3', { route: null, familyKey: 'other' }, { route: null }),
  ];
  const none = fakeApi({ targets });
  const out = sink();
  assert.equal(await runCheck([...base, '--ready'], none, fakePlaywright(), out), 0);
  assert.deepEqual(none.submitted(), []);
  assert.match(out.text(), /^2:1 {2}no route {2}pass --url/m);
  assert.match(out.text(), /^3 checks: 0 passed, 0 mismatch, 0 errors, 3 no route$/m);

  const api = fakeApi({ targets });
  const pw = fakePlaywright();
  const out2 = sink();
  assert.equal(await runCheck([...base, '--ready', '--url', 'http://localhost:3000/files?tab=recent'], api, pw, out2), 0);
  const patches = api.calls.filter(c => c.method === 'PATCH');
  assert.deepEqual(patches.map(c => [decodeURIComponent(c.path), c.body]), [['/v3/files/fk/targets/2:1', { route: '/files?tab=recent' }]]);
  assert.deepEqual(api.submitted(), ['2:1', '2:2']);
  assert.deepEqual(pw.log.pages.map(p => p.url), ['http://localhost:3000/files?tab=recent', 'http://localhost:3000/files?tab=recent&theme=dark']);
  assert.match(out2.text(), /^2:1 {2}route {2}saved \/files\?tab=recent$/m);
  assert.match(out2.text(), /^2:3 {2}no route/m);
});

test('check --screen: a component target renders through the gallery', async () => {
  const api = fakeApi({ targets: [component('1:1')], results: { '1:1': { status: 'mismatch', score: 3 } } });
  const pw = fakePlaywright();
  assert.equal(await runCheck([...base, '--screen', '1-1'], api, pw), 1);
  assert.equal(pw.log.pages[0].url, 'http://localhost:3000/gallery?figma=Button&variant=Size%3Dsm%2C%20State%3DHover');
  assert.equal(pw.log.pages[0].shot, 'viewport');
});

test('check: exit codes — nothing ready 0 (no browser), errors 2, usage', async () => {
  const empty = fakeApi({ targets: [] });
  const out = sink();
  const pw = fakePlaywright();
  assert.equal(await runCheck([...base, '--ready'], empty, pw, out), 0);
  assert.equal(out.text(), 'no ready targets\n');
  assert.equal(pw.log.launches, 0);
  assert.equal(await runCheck([...base, '--all'], empty, pw, sink()), 0);

  const failing = fakeApi({ targets: [component('1:1'), screen('2:1')], results: { '1:1': { problem: 'no reference' }, '2:1': { status: 'mismatch', score: 9 } } });
  assert.equal(await runCheck([...base, '--ready'], failing, fakePlaywright()), 2);

  for (const argv of [
    [...base, '--ready', '--all'],
    ['--file-key', 'fk', '--ready'],
    [...base, '--ready', '--url', '/files'],
    ['--file-key', 'fk', '--list-unmapped', '--url', 'http://localhost:3000/x'],
  ]) assert.equal(await runCheck(argv, empty, fakePlaywright()), 2, argv.join(' '));
});

test('fillTemplate, findStory, themed', () => {
  const render = { key: 'k/1', nodeId: '1:2', set: 'Button Group', variant: 'Size=sm, State=Hover', props: { Size: 'sm', 'Has Icon': 'true' } };
  assert.equal(fillTemplate('/gallery/{set}?v={variant}&k={key}&n={nodeId}&s={prop.Size}&i={prop.Has Icon}', render),
    '/gallery/Button%20Group?v=Size%3Dsm%2C%20State%3DHover&k=k%2F1&n=1%3A2&s=sm&i=true');
  assert.equal(fillTemplate('/g?x={prop.Missing}', render), null);
  assert.equal(fillTemplate('/g?v={variant}', { ...render, variant: '' }), '/g?v=');
  assert.equal(fillTemplate('/g?v={unknown}', render), null);
  assert.equal(findStory({ stories: { a: { id: 'a', tags: ['figma-node:1-2'] } } }, { key: null, nodeId: '1:2' }).id, 'a');
  assert.equal(findStory({ entries: {} }, { key: 'x', nodeId: '1:2' }), null);
  assert.deepEqual(themed('http://x/a', { theme: 'sepia' }), { url: 'http://x/a', contextOptions: {}, initScript: null });
});
