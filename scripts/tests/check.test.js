'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { run, parseCheckArgs, loadPlaywright, checkUrl, usage } = require('../rds-agent');

const env = { RDS_API_BASE_URL: 'https://rds.example.com', RDS_AGENT_TOKEN: 'agent-secret' };
const PNG = Buffer.from('fake-png-bytes');

function sink() {
  const chunks = [];
  return { write: s => chunks.push(s), text: () => chunks.join('') };
}

const screenCheck = (checkId, nodeId, extra = {}) => ({
  checkId, nodeId, status: 'requested', route: '/settings', viewport: { width: 1440, height: 900 }, theme: null, query: null, masks: [], ...extra,
});

/** A fake API: `results` maps checkId → the check the submit returns (or a { problem } to fail with). */
function fakeApi({ requested = [], requestReply, results = {}, targets = [] }) {
  const calls = [];
  const reply = (status, body) => ({ ok: status < 300, status, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body) });
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, path: u.pathname, query: Object.fromEntries(u.searchParams), body, headers: init.headers });
    if (init.method === 'GET' && /\/checks$/.test(u.pathname)) return reply(200, { fileKey: 'fk', checks: requested });
    if (init.method === 'GET' && /\/targets$/.test(u.pathname)) return reply(200, { fileKey: 'fk', targets });
    if (init.method === 'POST' && /\/screens\/[^/]+\/checks$/.test(u.pathname)) return reply(200, { fileKey: 'fk', created: true, check: requestReply });
    const m = /\/checks\/([^/]+)\/result$/.exec(u.pathname);
    if (init.method === 'POST' && m) {
      const r = results[decodeURIComponent(m[1])];
      if (r && r.problem) return reply(409, { type: 'about:blank', title: 'Reference missing', status: 409, detail: r.problem });
      return reply(200, { fileKey: 'fk', check: { checkId: m[1], ...r } });
    }
    return reply(404, { title: 'Not found', detail: `${init.method} ${u.pathname}`, status: 404 });
  };
  return { calls, fetchImpl };
}

/** A fake Playwright module recording what each page was asked to do. */
function fakePlaywright({ failGoto = [] } = {}) {
  const log = { launches: [], contexts: [], pages: [], closed: 0 };
  const browserType = name => ({
    launch: async options => {
      log.launches.push({ name, options });
      return {
        newContext: async options => {
          const ctx = { options, closed: false };
          log.contexts.push(ctx);
          return {
            newPage: async () => {
              const page = { gotos: [], evaluated: [], shots: [], clock: null, timeout: null };
              log.pages.push(page);
              return {
                setDefaultTimeout: ms => { page.timeout = ms; },
                clock: { setFixedTime: async t => { page.clock = t; } },
                goto: async (url, options) => {
                  page.gotos.push({ url, options });
                  if (failGoto.some(f => url.includes(f))) throw new Error('net::ERR_CONNECTION_REFUSED');
                },
                evaluate: async fn => { page.evaluated.push(String(fn)); return true; },
                screenshot: async options => { page.shots.push(options); return PNG; },
              };
            },
            close: async () => { ctx.closed = true; },
          };
        },
        close: async () => { log.closed++; },
      };
    },
  });
  return { log, module: { chromium: browserType('chromium'), firefox: browserType('firefox'), webkit: browserType('webkit') } };
}

const base = ['--file-key', 'fk', '--base-url', 'http://localhost:3000/'];

test('check --requested: screenshots every requested check at its viewport and submits it; 0 when all pass', async () => {
  const api = fakeApi({
    requested: [screenCheck('c1', '2:1'), screenCheck('c2', '2:5', { route: '/files', query: 'theme=dark', theme: 'dark', viewport: { width: 390, height: 844 } })],
    results: { c1: { nodeId: '2:1', status: 'passed', score: 0.2, threshold: 1, regions: [] }, c2: { nodeId: '2:5', status: 'passed', score: 0, threshold: 1, regions: [] } },
  });
  const pw = fakePlaywright();
  const out = sink();
  const code = await run(['check', ...base, '--requested', '--commit-ref', 'abc123'], { env, fetchImpl: api.fetchImpl, stdout: out, stderr: sink(), playwright: pw.module });
  assert.equal(code, 0);

  assert.deepEqual(api.calls[0], { ...api.calls[0], method: 'GET', path: '/v3/files/fk/checks', query: { status: 'requested', limit: '500' } });
  assert.equal(api.calls[0].headers.authorization, 'Bearer agent-secret');
  assert.equal(api.calls[1].path, '/v3/files/fk/targets');
  const submits = api.calls.slice(2);
  assert.deepEqual(submits.map(c => `${c.method} ${c.path}`), ['POST /v3/files/fk/checks/c1/result', 'POST /v3/files/fk/checks/c2/result']);
  for (const s of submits) assert.deepEqual(s.body, { image: PNG.toString('base64'), commitRef: 'abc123', source: 'rds-agent check' });

  assert.equal(pw.log.launches.length, 1);
  assert.equal(pw.log.launches[0].name, 'chromium');
  assert.deepEqual(pw.log.contexts.map(c => c.options), [
    { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' },
    { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: 'dark' },
  ]);
  assert.ok(pw.log.contexts.every(c => c.closed));
  assert.equal(pw.log.closed, 1);
  assert.deepEqual(pw.log.pages.map(p => p.gotos[0].url), ['http://localhost:3000/settings', 'http://localhost:3000/files?theme=dark']);
  for (const p of pw.log.pages) {
    assert.equal(p.gotos[0].options.waitUntil, 'networkidle');
    assert.ok(p.clock instanceof Date);
    assert.match(p.evaluated[0], /document\.fonts\.ready/);
    assert.equal(p.shots[0].type, 'png');
    assert.equal(p.shots[0].fullPage, false);
  }
  assert.match(out.text(), /^2:1 {2}passed {2}score 0\.2% <= limit 1%/m);
  assert.match(out.text(), /^2 checks: 2 passed, 0 mismatch, 0 errors$/m);
});

test('check --screen: requests a check for the screen first, then runs it; a mismatch exits 1 and prints regions', async () => {
  const api = fakeApi({
    requestReply: screenCheck('c9', '2:1', { route: '/settings', query: '?tab=team' }),
    results: { c9: { nodeId: '2:1', status: 'mismatch', score: 4.5, threshold: 1, regions: [{ x: 10, y: 20, width: 300, height: 40, pixels: 1234 }] } },
  });
  const pw = fakePlaywright();
  const out = sink();
  const code = await run(['check', ...base, '--screen', '2-1', '--browser', 'firefox', '--timeout', '5000', '--source', 'ci'], {
    env, fetchImpl: api.fetchImpl, stdout: out, stderr: sink(), playwright: pw.module, cwd: os.tmpdir(),
  });
  assert.equal(code, 1);
  assert.deepEqual(api.calls.map(c => `${c.method} ${c.path}`), ['POST /v3/files/fk/screens/2%3A1/checks', 'GET /v3/files/fk/targets', 'POST /v3/files/fk/checks/c9/result']);
  assert.equal(api.calls[2].body.source, 'ci');
  assert.equal(pw.log.launches[0].name, 'firefox');
  assert.equal(pw.log.pages[0].timeout, 5000);
  assert.equal(pw.log.pages[0].gotos[0].url, 'http://localhost:3000/settings?tab=team');
  assert.match(out.text(), /^2:1 {2}mismatch {2}score 4\.5% > limit 1%/m);
  assert.match(out.text(), /^ {2}region 10,20 300x40 \(1234 px\)$/m);
});

test('check: a page that does not render is submitted as an error and exits 2; API errors exit 2 and the run continues', async () => {
  const api = fakeApi({
    requested: [screenCheck('c1', '2:1', { route: '/broken' }), screenCheck('c2', '2:5'), screenCheck('c3', '2:7')],
    results: {
      c1: { nodeId: '2:1', status: 'error', error: 'could not render' },
      c2: { problem: 'Screen 2:5 has no reference image for its current design.' },
      c3: { nodeId: '2:7', status: 'passed', score: 0, threshold: 1, regions: [] },
    },
  });
  const pw = fakePlaywright({ failGoto: ['/broken'] });
  const out = sink();
  const err = sink();
  const code = await run(['check', ...base, '--requested'], { env: { ...env, RDS_WORKER: 'agent-7' }, fetchImpl: api.fetchImpl, stdout: out, stderr: err, playwright: pw.module, cwd: os.tmpdir() });
  assert.equal(code, 2);
  const [c1, c2, c3] = api.calls.slice(2).map(c => c.body);
  assert.match(c1.error, /^could not render http:\/\/localhost:3000\/broken: net::ERR_CONNECTION_REFUSED/);
  assert.equal(c1.image, undefined);
  assert.equal(c1.source, 'agent-7');
  assert.ok(c2.image && c3.image);
  assert.match(err.text(), /^2:5 {2}error {2}error: Reference missing — Screen 2:5 has no reference/m);
  assert.match(out.text(), /^3 checks: 1 passed, 0 mismatch, 2 errors$/m);
});

test('check: no requested checks exits 0 without launching a browser', async () => {
  const api = fakeApi({ requested: [] });
  const pw = fakePlaywright();
  const out = sink();
  assert.equal(await run(['check', ...base, '--requested'], { env, fetchImpl: api.fetchImpl, stdout: out, stderr: sink(), playwright: pw.module }), 0);
  assert.equal(out.text(), 'no requested checks\n');
  assert.equal(pw.log.launches.length, 0);
});

test('check: commit ref defaults to git rev-parse HEAD in a git repo, and is omitted outside one', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rds-check-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: dir, encoding: 'utf8' });
  if (git('init', '-q').status !== 0) return t.skip('git unavailable');
  git('commit', '-q', '--allow-empty', '-m', 'init');
  const head = git('rev-parse', 'HEAD').stdout.trim();

  const ok = { nodeId: '2:1', status: 'passed', score: 0, threshold: 1, regions: [] };
  const inRepo = fakeApi({ requested: [screenCheck('c1', '2:1')], results: { c1: ok } });
  await run(['check', ...base, '--requested'], { env, fetchImpl: inRepo.fetchImpl, stdout: sink(), stderr: sink(), playwright: fakePlaywright().module, cwd: dir });
  assert.equal(inRepo.calls[2].body.commitRef, head);

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'rds-nogit-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const noRepo = fakeApi({ requested: [screenCheck('c1', '2:1')], results: { c1: ok } });
  await run(['check', ...base, '--requested'], { env: { ...env, GIT_CEILING_DIRECTORIES: os.tmpdir() }, fetchImpl: noRepo.fetchImpl, stdout: sink(), stderr: sink(), playwright: fakePlaywright().module, cwd: outside });
  if (spawnSync('git', ['rev-parse', 'HEAD'], { cwd: outside }).status === 0) return;
  assert.equal('commitRef' in noRepo.calls[2].body, false);
});

test('check: missing Playwright names the install command and exits 2', async () => {
  await assert.rejects(loadPlaywright({ name: 'playwright-not-installed-rds-test', cwd: os.tmpdir() }), err => (
    err.exitCode === 2 && err.message === 'rds-agent check needs Playwright — install it: npm i -D playwright && npx playwright install chromium'
  ));
  const fakeModule = path.join(os.tmpdir(), `rds-fake-pw-${process.pid}.cjs`);
  fs.writeFileSync(fakeModule, 'exports.chromium = { launch: async () => null };');
  try {
    const mod = await loadPlaywright({ name: fakeModule });
    assert.equal(typeof mod.chromium.launch, 'function');
  } finally {
    fs.rmSync(fakeModule, { force: true });
  }
});

test('check: usage errors exit 2; --help exits 0; listed in rds-agent --help', async () => {
  for (const argv of [
    ['--base-url', 'http://localhost:3000', '--requested'],
    ['--file-key', 'fk', '--requested'],
    [...base],
    [...base, '--requested', '--screen', '2:1'],
    [...base, '--requested', '--browser', 'edge'],
    [...base, '--requested', '--timeout', 'soon'],
    [...base, '--requested', '--nope', 'x'],
    ['--file-key', 'fk', '--base-url', 'localhost', '--requested'],
  ]) {
    const err = sink();
    assert.equal(await run(['check', ...argv], { env, stdout: sink(), stderr: err, playwright: fakePlaywright().module }), 2, argv.join(' '));
    assert.ok(err.text().length);
  }
  assert.equal(await run(['check', ...base, '--requested'], { env: {}, stdout: sink(), stderr: sink(), playwright: fakePlaywright().module }), 2);
  const help = sink();
  assert.equal(await run(['check', '--help'], { env: {}, stdout: help, stderr: sink() }), 0);
  assert.match(help.text(), /^Usage: rds-agent check /);
  assert.equal(await run(['help', 'check'], { env: {}, stdout: sink(), stderr: sink() }), 0);
  assert.match(usage(), /^ {2}check +Screenshot check targets/m);
  assert.equal(parseCheckArgs([...base, '--requested']).baseUrl, 'http://localhost:3000');
  assert.equal(checkUrl('http://localhost:3000/app', { route: '/files', query: 'a=1&b=2' }), 'http://localhost:3000/app/files?a=1&b=2');
});
