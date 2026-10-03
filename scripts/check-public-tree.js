#!/usr/bin/env node
'use strict';

/*
 * Public-tree check: the whole repo (minus the paths the export strips) is
 * published, so nothing in it may name a real Figma file key, a real deployment
 * host, or hold a committed secret. Run from the repo root:
 *
 *   node scripts/check-public-tree.js
 *
 * Exits 1 and prints every offending file:line when it finds one.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Paths stripped from the public export (never scanned).
const EXCLUDED_DIRS = new Set([
  '.git',
  '.beads',
  '.claude',
  'dev-handoffs',
  'node_modules',
  'dist',
  'build',
]);
const EXCLUDED_FILES = new Set([
  'CLAUDE.md',
  '.coordinator-state.json',
]);

// Real Figma file keys that must never appear, stored only as SHA-256 hashes so
// this published file doesn't contain them. Every 22-character alphanumeric
// token is hashed and compared. Use the test dummies (AbCdEf123456GhIjKl7890,
// ZyXwVu987654TsRqPo3210, PORTAL_DESIGN_FILE) instead.
const REAL_FILE_KEY_HASHES = new Set([
  'ac2356c17ae86b3edc58e2ef34ec82461684b208218b4709befa38ba97e4d6f3',
  '23cf13106b5ef427cc4fb5c25f6537d0d922ee4f58c27c0f887417eaf7628638',
  '84ff67153310d1b2de3e9f22cdc15b6bd0fdf9dcd36d16da502cb39a6d442277',
]);
const FILE_KEY_TOKEN = /(?<![A-Za-z0-9])[A-Za-z0-9]{22}(?![A-Za-z0-9])/g;
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

const CHECKS = [
  { name: 'real deployment host', re: /[\w-]+\.up\.railway\.app/ },
  { name: 'internal session host', re: /\bapp\.devin\.ai\b/ },
];

// VAR=value assignments that look like a committed credential: an env-style
// name holding a long unbroken secret-looking value. Placeholders (<…>,
// your-…, …-here, empty) never match.
const SECRET_NAME = /(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|SERVICE_ROLE|API_KEY)/;
const SECRET_ASSIGN = /\b[A-Z][A-Z0-9_]{2,}\s*=\s*['"]?([A-Za-z0-9+/=_-]{20,})['"]?/;
const PLACEHOLDER = /example|dummy|placeholder|your[-_]|change[-_]?me|xxxx|PROJECT_REF/i;

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.icns',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.zip', '.gz', '.tar', '.jar', '.db', '.pack', '.pdf',
]);
const MAX_BYTES = 1024 * 1024;

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.relative(ROOT, path.join(dir, entry.name));
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) yield* walk(path.join(dir, entry.name));
    } else if (entry.isFile()) {
      if (EXCLUDED_FILES.has(entry.name) || EXCLUDED_FILES.has(rel)) continue;
      yield path.join(dir, entry.name);
    }
  }
}

const findings = [];

for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file);
  if (BINARY_EXT.has(path.extname(file).toLowerCase())) continue;

  // A committed dotenv file other than .env.example is itself a finding.
  const base = path.basename(file);
  if ((base === '.env' || base.startsWith('.env.')) && base !== '.env.example') {
    findings.push(`${rel}: committed env file`);
    continue;
  }

  let text;
  try {
    const stat = fs.statSync(file);
    if (stat.size > MAX_BYTES) continue;
    text = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (text.includes('\0')) continue; // binary

  text.split('\n').forEach((line, i) => {
    for (const [token] of line.matchAll(FILE_KEY_TOKEN)) {
      if (REAL_FILE_KEY_HASHES.has(sha256(token))) findings.push(`${rel}:${i + 1}: real Figma file key`);
    }
    for (const { name, re } of CHECKS) {
      const m = line.match(re);
      if (m) findings.push(`${rel}:${i + 1}: ${name}: ${m[0]}`);
    }
    const assign = line.match(SECRET_ASSIGN);
    if (assign && SECRET_NAME.test(assign[0]) && !PLACEHOLDER.test(assign[1])) {
      findings.push(`${rel}:${i + 1}: possible committed secret in ${assign[0].split('=')[0].trim()}`);
    }
  });
}

if (findings.length) {
  console.error(`check-public-tree: ${findings.length} finding(s):`);
  for (const f of findings) console.error(`  ${f}`);
  process.exit(1);
}
console.log('check-public-tree: clean');
