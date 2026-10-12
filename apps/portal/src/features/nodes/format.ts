import type { NodeLike } from './types';

/** A change side bound to a design token. */
export interface TokenValue {
  token: string;
  value: unknown;
}

/** One property's entry in a node's `changes`. */
export interface PropertyChange {
  built: unknown;
  now: unknown;
  category?: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const isTokenValue = (v: unknown): v is TokenValue => isObject(v) && typeof v.token === 'string' && 'value' in v;

const isChange = (v: unknown): v is PropertyChange => isObject(v) && 'built' in v && 'now' in v;

/** A node's `changes` as `[prop, change]` pairs, in `changedProps` order when given. */
export function changeEntries(node: Pick<NodeLike, 'changes' | 'changedProps'>): [string, PropertyChange][] {
  const changes = node.changes ?? {};
  const order = node.changedProps?.length ? node.changedProps : Object.keys(changes).sort();
  return order.flatMap(prop => {
    const change = changes[prop];
    return isChange(change) ? [[prop, change] as [string, PropertyChange]] : [];
  });
}

/** `Colors/Background/bg-primary` → `bg-primary`. */
export const tokenName = (token: string) => token.split('/').pop() || token;

const channel = (n: unknown) =>
  Math.round(Math.min(1, Math.max(0, typeof n === 'number' ? n : 0)) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();

function hex(color: Record<string, unknown>, opacity?: unknown): string {
  const alpha = (typeof color.a === 'number' ? color.a : 1) * (typeof opacity === 'number' ? opacity : 1);
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}${alpha < 1 ? channel(alpha) : ''}`;
}

const isColor = (v: unknown): boolean => isObject(v) && typeof v.r === 'number' && typeof v.g === 'number' && typeof v.b === 'number';

const num = (n: unknown) => (typeof n === 'number' ? String(Math.round(n * 100) / 100) : '0');

/** A raw property value as designers read it: `#F7FBFC`, `0 1 2 #0A0D0F0D`, `16`. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return num(value);
  if (typeof value === 'string' || typeof value === 'boolean') return String(value);
  if (isTokenValue(value)) return formatValue(value.value);
  if (Array.isArray(value)) return value.length ? value.map(formatValue).join(', ') : 'none';
  if (!isObject(value)) return String(value);
  if (value.truncated === true) return `(${typeof value.bytes === 'number' ? value.bytes : '?'} bytes)`;
  if (isColor(value)) return hex(value);
  if (isObject(value.color) && isColor(value.color)) {
    const color = hex(value.color, value.opacity);
    if (isObject(value.offset) || typeof value.radius === 'number') {
      const offset = isObject(value.offset) ? value.offset : {};
      const spread = typeof value.spread === 'number' && value.spread !== 0 ? ` ${num(value.spread)}` : '';
      const inner = value.type === 'INNER_SHADOW' ? 'inset ' : '';
      return `${inner}${num(offset.x)} ${num(offset.y)} ${num(value.radius)}${spread} ${color}`;
    }
    return color;
  }
  if (typeof value.value === 'number' && typeof value.unit === 'string') {
    return value.unit === 'PIXELS' ? num(value.value) : value.unit === 'PERCENT' ? `${num(value.value)}%` : String(value.unit).toLowerCase();
  }
  const json = JSON.stringify(value);
  return json.length > 120 ? `${json.slice(0, 119)}…` : json;
}

/** What a change side shows in a token chip: the token's short name, else the raw value. */
export const sideLabel = (side: unknown) => (isTokenValue(side) ? tokenName(side.token) : formatValue(side));

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The table's *What changed*: the first changed property with a token change, else the property count. */
export function whatChanged(node: NodeLike): { text: string; supportingText?: string } | null {
  const props = node.changedProps ?? [];
  if (node.state === 'clean' || (!props.length && !node.changeType)) return null;
  if (node.changeType !== 'added') {
    const tokenChange = changeEntries(node).find(([, c]) => isTokenValue(c.built) || isTokenValue(c.now));
    if (tokenChange) {
      const [prop, change] = tokenChange;
      return { text: prop, supportingText: `${sideLabel(change.built)} → ${sideLabel(change.now)}` };
    }
  }
  const since =
    node.changeType === 'added' ? 'new since last clear' : node.changeType === 'deleted' ? 'deleted since last clear' : 'changed since last clear';
  return { text: plural(props.length, 'property', 'properties'), supportingText: since };
}

/** A design-token node (decision: tokens are nodes): the `tokens` root, a `tokens:<collectionKey>` collection or a `token:<variableKey>` variable. */
export const isTokenNodeId = (id: string | null | undefined): boolean =>
  !!id && (id === 'tokens' || id.startsWith('tokens:') || id.startsWith('token:'));

/** A design token (`token:<variableKey>`, type `VARIABLE`). */
export const isToken = (node: Pick<NodeLike, 'type' | 'nodeId'>): boolean => node.type === 'VARIABLE' || !!node.nodeId?.startsWith('token:');

const attrsOf = (node: object): Record<string, unknown> => {
  const attrs = (node as { attrs?: unknown }).attrs;
  return isObject(attrs) ? attrs : {};
};

/** A token's code name: `codeSyntax.WEB` when the designer set one, else none. */
export function tokenCodeSyntax(node: object): string | undefined {
  const syntax = attrsOf(node).codeSyntax;
  return isObject(syntax) && typeof syntax.WEB === 'string' && syntax.WEB ? syntax.WEB : undefined;
}

/** `VARIABLE · COLOR · --color-bg-active` for a token, `VARIABLE_COLLECTION · 2 modes` for a collection. */
export function tokenMeta(node: Pick<NodeLike, 'type' | 'nodeId'>): string {
  const attrs = attrsOf(node);
  if (isToken(node)) {
    const resolved = typeof attrs.resolvedType === 'string' ? attrs.resolvedType : null;
    return [node.type ?? 'VARIABLE', resolved, tokenCodeSyntax(node)].filter(Boolean).join(' · ');
  }
  const modes = Array.isArray(attrs.modes) ? attrs.modes.length : 0;
  return [node.type ?? 'TOKENS', modes ? plural(modes, 'mode', 'modes') : null].filter(Boolean).join(' · ');
}

/** A token value that points at another token (`{ alias: "token:<key>", name }`). */
export interface TokenAlias {
  alias: string;
  name?: string | null;
}

export const isTokenAlias = (v: unknown): v is TokenAlias => isObject(v) && typeof v.alias === 'string';

/** One side of a token's mode value as shown: the text, a swatch color for colors, the alias target for aliases. */
export interface TokenValueView {
  text: string;
  swatch?: string;
  /** The aliased token's node id. */
  alias?: string;
  /** The aliased token's full name (`Colors/gray-800`). */
  aliasName?: string;
}

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** A `value:<Mode>` side: `#202527` (with a swatch), `16`, `true`, or an alias's short name (`gray-800`). */
export function tokenValueView(value: unknown): TokenValueView {
  if (isTokenAlias(value)) {
    const name = value.name || value.alias;
    return { text: tokenName(name), alias: value.alias, aliasName: name };
  }
  if (typeof value === 'string' && HEX.test(value)) return { text: value, swatch: value };
  const text = formatValue(value);
  if (isColor(value)) return { text, swatch: text };
  if (typeof value === 'number') return { text: String(Math.round(value * 10_000) / 10_000) };
  return { text };
}

/** One changed mode of a token. */
export interface TokenModeChange {
  /** `Dark`. */
  mode: string;
  /** `value:Dark`. */
  prop: string;
  built: unknown;
  now: unknown;
}

/** A token's changed `value:<Mode>` properties, in `changedProps` order. */
export function tokenModeChanges(node: Pick<NodeLike, 'changes' | 'changedProps'>): TokenModeChange[] {
  return changeEntries(node)
    .filter(([prop]) => prop.startsWith('value:'))
    .map(([prop, change]) => ({ mode: prop.slice('value:'.length), prop, built: change.built, now: change.now }));
}

/** `FRAME · 1:95540`, `INSTANCE · 1:95723 → 1:27892`, `COMPONENT · 1:27892 · via 1:95723`. */
export function nodeMeta(node: Pick<NodeLike, 'type' | 'nodeId' | 'isInstance' | 'mainComponentId'>, via?: string): string {
  const main = node.isInstance && node.mainComponentId ? ` → ${node.mainComponentId}` : '';
  return `${node.type ?? 'NODE'} · ${node.nodeId ?? ''}${main}${via ? ` · via ${via}` : ''}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** `2m ago` (short) or `2 min ago` / `3 hours ago` / `2 days ago`. */
export function timeAgo(iso: string | null | undefined, now: number, style: 'short' | 'long' = 'long'): string {
  const at = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(at)) return '';
  const ms = Math.max(0, now - at);
  if (ms < 45_000) return 'just now';
  if (ms < HOUR) {
    const m = Math.max(1, Math.round(ms / MINUTE));
    return style === 'short' ? `${m}m ago` : `${m} min ago`;
  }
  if (ms < DAY) {
    const h = Math.round(ms / HOUR);
    return style === 'short' ? `${h}h ago` : `${plural(h, 'hour', 'hours')} ago`;
  }
  const d = Math.round(ms / DAY);
  return style === 'short' ? `${d}d ago` : `${plural(d, 'day', 'days')} ago`;
}

/** `in 14 min`, `in 2 hours`, or `expired`. */
export function timeUntil(iso: string | null | undefined, now: number): string {
  const at = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(at)) return '';
  const ms = at - now;
  if (ms <= 0) return 'expired';
  if (ms < HOUR) return `in ${Math.max(1, Math.round(ms / MINUTE))} min`;
  if (ms < DAY) return `in ${plural(Math.round(ms / HOUR), 'hour', 'hours')}`;
  return `in ${plural(Math.round(ms / DAY), 'day', 'days')}`;
}

/** A prompt an agent can start from on one node: MCP tools first, the CLI as the fallback. */
export function nodePrompt({
  fileKey,
  nodeId,
  name,
  codeSyntax,
}: {
  fileKey: string;
  nodeId: string;
  name?: string | null;
  /** A design token's `codeSyntax.WEB`, when it has one. */
  codeSyntax?: string;
}): string {
  const label = name ? `"${name}" (${nodeId})` : nodeId;
  const token = isTokenNodeId(nodeId);
  const variable = codeSyntax ? `the code variable ${codeSyntax} (its codeSyntax)` : `the code variable named after the token${name ? ` (${name})` : ''}`;
  const cli = 'node scripts/rds-agent.js';
  return [
    token
      ? `Update the design token ${label} in file ${fileKey}, tracked by Rolling Design Sync.`
      : `Implement the Figma node ${label} in file ${fileKey}, tracked by Rolling Design Sync.`,
    'Use the rds MCP tools if you have them; otherwise run the CLI from a checkout of rolling-design-sync (needs RDS_API_BASE_URL and RDS_AGENT_TOKEN).',
    '',
    '1. Claim it with a stable worker id when other agents share the file:',
    `   - MCP: claim_nodes { "fileKey": "${fileKey}", "nodeIds": ["${nodeId}"], "worker": "<worker>" }`,
    `   - CLI: ${cli} claim --file-key ${fileKey} --node-ids ${nodeId} --worker <worker>`,
    "2. Read what changed since it was last built and its contentHash:",
    `   - MCP: get_node { "fileKey": "${fileKey}", "nodeId": "${nodeId}" }`,
    `   - CLI: ${cli} nodes show ${nodeId} --file-key ${fileKey}`,
    token
      ? `3. Update ${variable} for each changed mode (value:<Mode>) and commit.`
      : '3. Implement the changes and commit them.',
    '4. Clear it with the contentHash you read and the commit SHA:',
    `   - MCP: clear_nodes { "fileKey": "${fileKey}", "items": [{ "nodeId": "${nodeId}", "contentHash": "<contentHash>" }], "commitRef": "<sha>" }`,
    `   - CLI: ${cli} clear ${nodeId}=<contentHash> --file-key ${fileKey} --commit-ref <sha>`,
    '   A stale result means the design changed after you read it: re-read it with get_node, implement the new change and clear it with the new contentHash.',
    '5. If you cannot build it, block it with a reason a person can act on:',
    `   - MCP: block_node { "fileKey": "${fileKey}", "nodeId": "${nodeId}", "reason": "<why>" }`,
    `   - CLI: ${cli} block ${nodeId} --file-key ${fileKey} --reason "<why>"`,
  ].join('\n');
}

/** A component a removed design used, for `removalPrompt`. */
export interface RemovalPromptUse {
  componentId?: string;
  name?: string | null;
  livePlacements?: number;
}

/**
 * A prompt that has an agent remove the code of a removed design (a `kind: "removed"` work item): keep the
 * components still placed elsewhere, consider removing the unused ones, then clear the root with `subtree: true`.
 */
export function removalPrompt({
  fileKey,
  nodeId,
  name,
  uses = [],
  warnings = [],
}: {
  fileKey: string;
  nodeId: string;
  name?: string | null;
  uses?: readonly RemovalPromptUse[];
  warnings?: readonly { componentId?: string; livePlacements?: number }[];
}): string {
  const label = name ? `"${name}" (${nodeId})` : nodeId;
  const cli = 'node scripts/rds-agent.js';
  const useName = (u: RemovalPromptUse) => `"${u.name ?? u.componentId}"`;
  const kept = uses.filter(u => (u.livePlacements ?? 0) > 0);
  const unused = uses.filter(u => (u.livePlacements ?? 0) === 0);
  const warned = warnings.map(w => {
    const use = uses.find(u => u.componentId === w.componentId);
    return `   - ${use ? useName(use) : `"${w.componentId}"`}: its main component was removed with the design, but ${plural(w.livePlacements ?? 0, 'instance', 'instances')} still use it — keep its code.`;
  });
  return [
    `The Figma design ${label} in file ${fileKey} was deleted; remove the code that rendered it. Tracked by Rolling Design Sync.`,
    'Use the rds MCP tools if you have them; otherwise run the CLI from a checkout of rolling-design-sync (needs RDS_API_BASE_URL and RDS_AGENT_TOKEN).',
    '',
    `1. Remove the code that rendered ${label}.`,
    kept.length
      ? `2. Keep the components it used that are still placed elsewhere: ${kept.map(u => `${useName(u)} (${plural(u.livePlacements ?? 0, 'placement', 'placements')} left)`).join(', ')}.`
      : '2. None of the components it used are placed anywhere else.',
    unused.length
      ? `3. Consider removing the components nothing uses any more: ${unused.map(useName).join(', ')}.`
      : '3. Every component it used is still placed elsewhere: keep them all.',
    ...(warned.length ? ['   Warnings:', ...warned] : []),
    '4. Commit, then read the root\'s contentHash:',
    `   - MCP: get_node { "fileKey": "${fileKey}", "nodeId": "${nodeId}" }`,
    `   - CLI: ${cli} nodes show ${nodeId} --file-key ${fileKey}`,
    '5. Clear the root with subtree: true — that also clears every removed layer under it:',
    `   - MCP: clear_nodes { "fileKey": "${fileKey}", "items": [{ "nodeId": "${nodeId}", "contentHash": "<contentHash>", "subtree": true }], "commitRef": "<sha>" }`,
    `   - HTTP (the CLI's clear has no subtree flag): curl -X POST "$RDS_API_BASE_URL/v3/files/${fileKey}/clear" -H "Authorization: Bearer $RDS_AGENT_TOKEN" -H 'Content-Type: application/json' -d '{ "items": [{ "nodeId": "${nodeId}", "contentHash": "<contentHash>", "subtree": true }], "commitRef": "<sha>" }'`,
  ].join('\n');
}
