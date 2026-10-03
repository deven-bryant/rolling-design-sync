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

/** A raw property value as designers read it: `#F9FAFB`, `0 1 2 #0A0D120D`, `16`. */
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

/** A prompt an agent can start from: the file key, the node id and the CLI / MCP calls for it. */
export function nodePrompt({ fileKey, nodeId, name }: { fileKey: string; nodeId: string; name?: string | null }): string {
  const label = name ? `"${name}" (${nodeId})` : nodeId;
  return [
    `Implement the Figma node ${label} in file ${fileKey}, tracked by Rolling Design Sync.`,
    '',
    'Read what changed since it was last built:',
    `- CLI: node scripts/rds-agent.js nodes show ${nodeId} --file-key ${fileKey}`,
    `- MCP: get_node { "fileKey": "${fileKey}", "nodeId": "${nodeId}" }`,
    '',
    'Claim it before you start when other agents share the file:',
    `- CLI: node scripts/rds-agent.js claim --file-key ${fileKey} --node-ids ${nodeId}`,
    `- MCP: claim_nodes { "fileKey": "${fileKey}", "nodeIds": ["${nodeId}"] }`,
    '',
    'When the code matches the design, clear it with the contentHash you read:',
    `- CLI: node scripts/rds-agent.js clear ${nodeId}=<contentHash> --file-key ${fileKey}`,
    `- MCP: clear_nodes { "fileKey": "${fileKey}", "items": [{ "nodeId": "${nodeId}", "contentHash": "<contentHash>" }] }`,
  ].join('\n');
}
