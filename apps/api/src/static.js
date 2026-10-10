'use strict';

/*
 * Serves the portal build at /ui (docs/ui-portal.md, "Same origin"): static
 * files from `RDS_PORTAL_DIR` (default `apps/portal/dist` relative to the
 * repo), immutable caching for the build's hashed `assets/`, `no-cache`
 * `index.html` as the SPA fallback, and `/` redirecting to `/ui/`.
 * Hand-rolled over `fs` — no static-plugin dependency.
 */
const fs = require('node:fs');
const path = require('node:path');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
};

const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const missingPage = root => `<!doctype html>
<html><head><meta charset="utf-8"><title>Portal build not found</title></head>
<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem">
<h1>Portal build not found</h1>
<p>The API serves the portal from <code>${escapeHtml(root)}</code>, but there is no build there yet.</p>
<p>Build it from the repository root, then reload:</p>
<pre>npm ci &amp;&amp; npm run build -w @rolling-design-sync/portal</pre>
</body></html>`;

const stat = file => { try { return fs.statSync(file); } catch { return null; } };

function registerPortalRoutes(app, { config }) {
  const root = path.resolve(config.portalDir);
  const index = path.join(root, 'index.html');

  const sendFile = (reply, file, { immutable = false } = {}) => reply
    .type(TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream')
    .header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
    .send(fs.createReadStream(file));

  const missing = reply => reply.code(404).type('text/html; charset=utf-8').send(missingPage(root));

  const sendIndex = reply => {
    const found = stat(index);
    return found && found.isFile() ? sendFile(reply, index) : missing(reply);
  };

  app.get('/', async (request, reply) => reply.redirect('/ui/'));
  app.get('/ui', async (request, reply) => sendIndex(reply));
  app.get('/ui/*', async (request, reply) => {
    const rel = String(request.params['*'] || '').replace(/^\/+/, '');
    if (!rel) return sendIndex(reply);
    const file = path.resolve(root, rel);
    // The '..' check treats '\' as a separator too, so a Windows deployment is as safe as POSIX.
    if ((file !== root && !file.startsWith(root + path.sep)) || rel.split(/[\\/]/).includes('..')) {
      return reply.code(404).type('text/plain; charset=utf-8').send('Not found.');
    }
    const st = stat(file);
    if (st && st.isFile()) return sendFile(reply, file, { immutable: rel.startsWith('assets/') });
    // Anything else is an SPA route: the shell loads and the router resolves it.
    return sendIndex(reply);
  });
}

module.exports = { registerPortalRoutes };
