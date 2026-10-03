// Checks the three npm packages before they are published: `npm pack
// --dry-run` lists exactly the files users need (no tests, no generator), the
// publish fields are set, every version matches the root, and the MCP server
// depends on the core it ships with.
//
//   node .github/scripts/check-pack.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_URL = 'git+https://github.com/deven-bryant/rolling-design-sync.git';

const PACKAGES = {
  'packages/core': ['LICENSE', 'README.md', 'index.js', 'package.json'],
  scripts: ['LICENSE', 'README.md', 'commands.generated.json', 'package.json', 'rds-agent.js'],
  'apps/mcp': [
    'LICENSE',
    'README.md',
    'bin/rds-mcp.js',
    'package.json',
    'src/client.js',
    'src/config.js',
    'src/server.js',
    'src/tools.js',
  ],
};

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const root = readJson('package.json');
const failures = [];
const fail = (msg) => failures.push(msg);
const manifests = {};

for (const [dir, expected] of Object.entries(PACKAGES)) {
  const pkg = readJson(join(dir, 'package.json'));
  manifests[dir] = pkg;
  const label = `${dir} (${pkg.name})`;

  if (pkg.private) fail(`${label}: must not be private`);
  if (pkg.version !== root.version) fail(`${label}: version ${pkg.version} != root ${root.version}`);
  if (!pkg.license) fail(`${label}: missing license`);
  if (pkg.repository?.url !== REPO_URL) fail(`${label}: repository.url must be ${REPO_URL}`);
  if (pkg.repository?.directory !== dir) fail(`${label}: repository.directory must be ${dir}`);
  if (pkg.publishConfig?.access !== 'public') fail(`${label}: publishConfig.access must be public`);
  if (pkg.publishConfig?.provenance !== true) fail(`${label}: publishConfig.provenance must be true`);
  for (const field of ['homepage', 'bugs', 'files', 'engines', 'keywords']) {
    if (!pkg[field]) fail(`${label}: missing ${field}`);
  }

  const [packed] = JSON.parse(
    execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: dir, encoding: 'utf8' }),
  );
  const actual = packed.files.map((f) => f.path).sort();
  const want = [...expected].sort();
  const extra = actual.filter((f) => !want.includes(f));
  const missing = want.filter((f) => !actual.includes(f));
  if (extra.length) fail(`${label}: unexpected files in the tarball: ${extra.join(', ')}`);
  if (missing.length) fail(`${label}: missing files in the tarball: ${missing.join(', ')}`);
  if (!extra.length && !missing.length) console.log(`ok ${pkg.name}@${pkg.version}: ${actual.join(' ')}`);
}

const core = manifests['packages/core'];
const coreRange = manifests['apps/mcp'].dependencies?.[core.name];
if (coreRange !== `^${core.version}`) {
  fail(`apps/mcp: dependency ${core.name} is "${coreRange}", expected "^${core.version}"`);
}

if (failures.length) {
  for (const msg of failures) console.error(`::error::${msg}`);
  process.exit(1);
}
