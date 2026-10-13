'use strict';

/*
 * Design tokens (docs/api-v3-design.md, "Design tokens"): the `tokens` scope
 * root, one `tokens:<collectionKey>` node per collection and one
 * `token:<variableKey>` node per variable. Work items group token nodes per
 * collection, shaped the same for both stores.
 */
const core = require('@rolling-design-sync/core');
const { label } = require('../ltree');

/** The ltree label of the tokens scope root. */
const TOKENS_LABEL = label(core.TOKENS_ROOT_ID);

/**
 * Sort-key prefix of token work items: after every removed item (REMOVED_K
 * `}` + an ltree label or space, all below `~`) and before the `key: null`
 * item (`~`).
 */
const TOKENS_K = '}~';

/** Whether an ltree path lies in the tokens scope. */
const inTokens = path => !!path && (path === TOKENS_LABEL || path.startsWith(`${TOKENS_LABEL}.`));

/** The work-item key path of a token node: its collection (the root for the root itself); null outside the tokens scope. */
const tokensKeyPath = path => (inTokens(path) ? path.split('.').slice(0, 2).join('.') : null);

/** Whether a work item's key path is a token item's (the tokens root or a collection). */
const isTokensItemPath = path => inTokens(path) && path.split('.').length <= 2;

module.exports = { TOKENS_LABEL, TOKENS_K, inTokens, tokensKeyPath, isTokensItemPath };
