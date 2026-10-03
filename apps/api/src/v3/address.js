'use strict';

/*
 * v3 addressing (docs/api-v3-design.md, "Addressing rules"): `{fileKey}` is
 * the key only, `{nodeId}` accepts `1:2` or `1-2`, and `?url=<figma link>`
 * may replace the path parameters (`-` is the placeholder).
 */
const core = require('@rolling-design-sync/core');
const { problem } = require('./problem');

const PLACEHOLDER = '-';

const normalizeNodeId = id => core.normalizeNodeId(id);

const LOOSE_FIGMA_KEY = /figma\.com\/(?:design|file|proto|board|slides)\/([A-Za-z0-9]+)/i;

const looksLikeUrl = v => typeof v === 'string' && (/^[a-z][a-z0-9+.-]*:\/\//i.test(v.trim()) || /figma\.com\//i.test(v));

/** The file key inside anything that looks like a Figma link, or `null`. */
function keyFromUrlish(value) {
  const parsed = core.parseFigmaUrl(value);
  if (parsed) return parsed.fileKey;
  const m = LOOSE_FIGMA_KEY.exec(String(value || ''));
  return m ? m[1] : null;
}

function urlAsKeyHint(value) {
  const key = keyFromUrlish(value);
  return key
    ? `That looks like a Figma URL. Use the file key '${key}', or pass ?url=<figma link> with '${PLACEHOLDER}' as the file key.`
    : 'That looks like a URL, not a file key. Pass the Figma file key, or ?url=<figma link> with \'-\' as the file key.';
}

/** 404 for an untracked file key, with the URL-as-key hint when it applies. */
function fileNotFound(fileKey) {
  const hint = looksLikeUrl(fileKey) ? urlAsKeyHint(fileKey) : 'GET /v3/files lists the tracked files. A file is tracked once the plugin has synced it.';
  return problem('file_not_found', `No tracked file with key '${fileKey}'.`, { hint });
}

function parseUrl(url) {
  const parsed = core.parseFigmaUrl(url);
  if (!parsed) {
    throw problem('invalid_url', `'${url}' is not a Figma design link.`, {
      hint: 'Pass a link like https://www.figma.com/design/<fileKey>/<name>?node-id=1-2.',
    });
  }
  return parsed;
}

/**
 * `{ fileKey, nodeId }` for a file-scoped route from its `fileKey` path
 * parameter and optional `?url=`; `nodeId` is the link's node (or `null`).
 */
function resolveFile(fileKeyParam, url) {
  if (url !== undefined) {
    const parsed = parseUrl(url);
    if (fileKeyParam !== PLACEHOLDER && fileKeyParam !== parsed.fileKey) {
      throw problem('url_mismatch', `The link is for file '${parsed.fileKey}', but the path names '${fileKeyParam}'.`, {
        hint: `Use '${PLACEHOLDER}' as the file key when passing ?url=, or drop ?url=.`,
      });
    }
    return parsed;
  }
  if (fileKeyParam === PLACEHOLDER) {
    throw problem('invalid_parameter', `The file key '${PLACEHOLDER}' is a placeholder and needs ?url=.`, {
      hint: `Pass ?url=<figma link>, or use the file key itself instead of '${PLACEHOLDER}'.`,
    });
  }
  if (looksLikeUrl(fileKeyParam)) throw fileNotFound(fileKeyParam);
  return { fileKey: fileKeyParam, nodeId: null };
}

/** The node id a `{nodeId}` path parameter names, given the link's node (from `?url=`) if any. */
function resolveNodeParam(nodeIdParam, urlNodeId) {
  if (nodeIdParam === PLACEHOLDER) {
    if (!urlNodeId) {
      throw problem('invalid_parameter', `The node id '${PLACEHOLDER}' is a placeholder and needs ?url= with a node-id.`, {
        hint: 'Pass a link that selects a node (…?node-id=1-2), or use the node id itself.',
      });
    }
    return urlNodeId;
  }
  if (urlNodeId && normalizeNodeId(nodeIdParam) !== urlNodeId) {
    throw problem('url_mismatch', `The link selects node '${urlNodeId}', but the path names '${nodeIdParam}'.`, {
      hint: `Use '${PLACEHOLDER}' as the node id when passing ?url=.`,
    });
  }
  return nodeIdParam;
}

/** Ids to try for a caller-supplied node id: the normalized form first, then the raw one. */
function nodeIdCandidates(raw) {
  const normalized = normalizeNodeId(raw);
  return normalized === raw ? [raw] : [normalized, raw];
}

function nodeNotFound(fileKey, raw) {
  const candidates = nodeIdCandidates(raw);
  const hint = candidates.length > 1
    ? `Neither '${candidates[0]}' nor '${candidates[1]}' exists in file '${fileKey}'. Figma links write node ids as ${candidates[1]}; the API stores ${candidates[0]}. Check the node is in a synced scope of this file.`
    : `Check the node id and that the node is in a synced scope of file '${fileKey}'. GET /v3/files/${fileKey}/scopes lists the synced scopes.`;
  return problem('node_not_found', `No node '${raw}' in file '${fileKey}'.`, { hint });
}

module.exports = {
  PLACEHOLDER, normalizeNodeId, looksLikeUrl, keyFromUrlish, fileNotFound, parseUrl, resolveFile, resolveNodeParam,
  nodeIdCandidates, nodeNotFound,
};
