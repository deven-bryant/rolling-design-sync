'use strict';

/*
 * Response formats (docs/api-v3-phase2.md, "4. Response formats"): the node
 * listing, work items and the events JSON page take `format=json|ndjson|md`.
 * `ndjson` (one object per line) and `md` (a checklist, one line per row) are
 * streamed: every match from `cursor` on, read from the store a page at a
 * time, up to `limit` lines when given.
 * `outline` (the listing and work items only, docs/api-v3-agent-ergonomics.md,
 * "5. Outline format" and "10. Outline paging") is an indented text tree, one
 * line per node: the whole result (up to OUTLINE_LINES rows) is rendered once,
 * then paged by rendered lines — `limit` lines from the cursor's line, with
 * NEXT_CURSOR_HEADER naming the next page.
 */
const { Readable } = require('node:stream');
const core = require('@rolling-design-sync/core');
const { isDescendant } = require('../ltree');

const FORMATS = ['json', 'ndjson', 'md'];
const OUTLINE_FORMATS = [...FORMATS, 'outline'];
const CONTENT_TYPES = { ndjson: 'application/x-ndjson; charset=utf-8', md: 'text/markdown; charset=utf-8', outline: 'text/plain; charset=utf-8' };
/** Store page size while streaming. */
const STREAM_PAGE = 500;
/** Longest value (characters) a markdown line shows before truncating it with `…`. */
const MAX_VALUE = 40;
/** Most changed properties a markdown line lists before `+N more`. */
const MAX_PROPS = 10;
/** Most rows (listing) or lines (work items) one outline renders before `… N more`. */
const OUTLINE_LINES = 2000;
/** Response header carrying the cursor of an outline's next page of lines. */
const NEXT_CURSOR_HEADER = 'x-rds-next-cursor';
/** Changed property names an outline line lists before `…`. */
const OUTLINE_PROPS = 2;

const formatParam = {
  type: 'string',
  enum: FORMATS,
  description: 'json (default); ndjson — one JSON object per line, streamed; md — a markdown checklist, one line per row, streamed. '
    + 'ndjson and md return every match from `cursor` on (up to `limit` when given) instead of one page.',
};

const outlineParam = unit => ({
  type: 'string',
  enum: OUTLINE_FORMATS,
  description: `${formatParam.description} `
    + `outline — text/plain, an indented tree with one line per ${unit}: use this first to see a screen's structure (under=<the screen>, and expand=instances for the components inside). `
    + (unit === 'node'
      ? 'Line: `Name (TYPE) · added` — `clean`, `added`, `deleted`, or `modified (3: fills, paddingLeft, …)` (changed property count and the first names), `· blocked` when blocked; an instance shows `(INSTANCE → <mainComponentId> <main name>)`. '
        + 'Two spaces per level of the tree below `under` (the `under` node itself, when it matches, is at the left margin; with several `under` ids, the tree of each root follows that of the previous root, in the order given, each root at the left margin). A node whose ancestors the filters leave out is indented under its nearest shown ancestor (at the margin when none is shown) — no placeholder lines. '
        + 'With expand=instances, a component\'s subtree is nested, as `↳ Name (COMPONENT) · …`, under the first instance that reached it; other instances of it show `→ <mainComponentId> (shown above)` (or `(shown below)`). Always in document order (the design\'s layer order; `sort=path` for node-id path order); nodes positioned absolutely in an auto-layout parent are marked `(absolute)`. '
      : 'Each item is a line `Name (TYPE) · 3 nodes · changed (4: characters, fills, …) · 2 placements`, with its listed nodes as an indented tree below it (`Name (TYPE) · modified (…)`, indented under their nearest listed ancestor). ')
    + `Lines are the \`fields\`-independent summary. ${outlinePaging(unit)}`,
});

const outlinePaging = unit => `The whole result (up to ${OUTLINE_LINES} ${unit === 'node' ? 'rows' : 'lines of whole items'}, in order) is rendered once, then paged by rendered lines, so nesting and \`(shown above)\` read the same at any page size: \`limit\` is lines per page (default: every line), and when lines remain the response has an \`X-RDS-Next-Cursor\` header — pass it as \`cursor\`, with every other parameter unchanged, for the next lines. Past the ${OUTLINE_LINES}-${unit === 'node' ? 'row' : 'line'} cap the outline's last line (counted like any other) is \`… N more${unit === 'node' ? '' : ' items'} (use cursor/limit) — cursor=<c>\` (the same cursor is in the header), which continues after the rendered part.`;


/** `limit` / `cursor` descriptions saying what they mean with format=outline. */
function outlineWindow({ limit, cursor }) {
  return {
    ...(limit ? { limit: { ...limit, description: `${limit.description} With format=outline: rendered lines per page (default: every line).` } } : {}),
    ...(cursor ? { cursor: { ...cursor, description: `${cursor.description} With format=outline: the previous response's \`X-RDS-Next-Cursor\` header (a line position in the rendered outline).` } } : {}),
  };
}

/**
 * A copy of route `schema` taking `format`, with the ndjson / markdown media
 * types on its 200 response; `outline` ('node' | 'item') adds format=outline
 * (text/plain) for rows of that kind.
 * @param {any} schema
 * @param {{ outline?: 'node' | 'item' | null }} [options]
 */
function withFormat(schema, { outline = null } = {}) {
  const ok = schema.response[200];
  const param = outline ? outlineParam(outline) : formatParam;
  return {
    ...schema,
    querystring: { ...schema.querystring, properties: { ...schema.querystring.properties, format: param, ...(outline ? outlineWindow(schema.querystring.properties) : {}) } },
    response: {
      ...schema.response,
      200: {
        description: ok.description || 'OK',
        content: {
          'application/json': { schema: ok },
          'application/x-ndjson': { schema: { type: 'string', description: 'One JSON object per line.' } },
          'text/markdown': { schema: { type: 'string', description: 'A markdown checklist, one line per row.' } },
          ...(outline ? { 'text/plain': { schema: { type: 'string', description: `An indented tree, one line per ${outline} (format=outline).` } } } : {}),
        },
      },
    },
  };
}

/** The store page size for a request: its `limit` (or `fallback`) for json, bounded by STREAM_PAGE otherwise. */
const pageSize = (fmt, limit, fallback) => (fmt === 'json' ? limit ?? fallback : Math.min(limit ?? STREAM_PAGE, STREAM_PAGE));

/**
 * Sends rows as ndjson or markdown without buffering the response: `first` is
 * the page already read (`{ rows, next }`), `fetch(next)` reads the page after
 * it. At most `cap` rows are written (all when null).
 * @param {any} reply
 * @param {string} fmt
 * @param {{ first: any, fetch: (next: any) => Promise<any>, toObject: (row: any) => any, toLine: (row: any) => string, cap?: number | null, total?: number | null }} options
 */
function stream(reply, fmt, { first, fetch, toObject, toLine, cap = null, total = null }) {
  const render = fmt === 'ndjson' ? row => `${JSON.stringify(toObject(row))}\n` : row => `${toLine(row)}\n`;
  async function* chunks() {
    let page = first, sent = 0;
    for (;;) {
      const rows = cap === null ? page.rows : page.rows.slice(0, cap - sent);
      if (rows.length) yield rows.map(render).join('');
      sent += rows.length;
      if (page.next === null || page.next === undefined || (cap !== null && sent >= cap)) return;
      page = await fetch(page.next);
    }
  }
  reply.type(CONTENT_TYPES[fmt]);
  if (total !== null) reply.header('x-total-count', String(total));
  return reply.send(Readable.from(chunks(), { objectMode: false }));
}

// --- markdown ------------------------------------------------------------------
const escape = v => String(v).replace(/[\\`*_[\]<>#|]/g, '\\$&').replace(/\s*\r?\n\s*/g, ' ');
const truncate = s => (s.length > MAX_VALUE ? `${s.slice(0, MAX_VALUE - 1)}…` : s);
/** A design-token alias value (`{ alias: 'token:<key>', name }`). */
const isAlias = v => !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.alias === 'string' && typeof v.name === 'string';
const isToken = v => !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.token === 'string' && Object.keys(v).length === 2 && 'value' in v;

/** A change value for a markdown line: the token name when bound, else the raw value (truncated). */
function valueText(v) {
  if (isToken(v)) return escape(truncate(v.token));
  if (isAlias(v)) return `{${escape(truncate(v.name))}}`;
  if (v === null || v === undefined) return 'none';
  return escape(truncate(typeof v === 'string' ? v : JSON.stringify(v)));
}

const listed = (names, max = MAX_PROPS) => names.slice(0, max).join(', ') + (names.length > max ? ` +${names.length - max} more` : '');

function changeText(n) {
  if (!n.changeType) return n.state === 'clean' ? 'clean' : 'no design changes';
  if (n.changeType === 'added' || n.changeType === 'deleted') return n.changeType;
  if (!n.changesKnown || !n.changes) return 'modified (changes unknown)';
  const parts = Object.entries(n.changes).map(([prop, c]) => `${escape(prop)} ${valueText(c.built)} → ${valueText(c.now)}`);
  if (!parts.length) return 'modified';
  return parts.slice(0, MAX_PROPS).join('; ') + (parts.length > MAX_PROPS ? `; +${parts.length - MAX_PROPS} more` : '');
}

/** `- [ ] **Name** (TYPE) — paddingLeft 16 → 24; fills color/brand/500 → color/brand/600 · [Figma](url)` for a node (`nodeFields` shape). */
function nodeLine(n) {
  const blocked = n.blocked ? ` · blocked: ${escape(truncate(n.blocked.reason || 'no reason'))}` : '';
  return `- [${n.state === 'clean' ? 'x' : ' '}] **${escape(n.name ?? n.nodeId)}** (${escape(n.type ?? 'NODE')}) — ${changeText(n)}${blocked}${n.figmaUrl ? ` · [Figma](${n.figmaUrl})` : n.library ? ' · library' : ''}`;
}

/** One checklist line for a work item (route shape). */
function itemLine(fileKey, group, i) {
  const title = (i.kind === 'removed' ? 'Removed: ' : i.kind === 'library' ? 'Library: ' : i.kind === 'tokens' ? 'Tokens: ' : '') + (i.key === null ? `**(no ${group})**` : `**${escape(i.name ?? i.key)}** (${escape(i.type ?? 'NODE')})`);
  const props = i.changedProps.length ? `: ${listed(i.changedProps.map(escape))}` : '';
  const placements = i.placements === undefined || i.placements === null ? '' : ` · ${i.placements} placement${i.placements === 1 ? '' : 's'}`;
  const uses = i.uses && i.uses.length ? ` · uses ${i.uses.length} component${i.uses.length === 1 ? '' : 's'} (${i.uses.filter(u => u.livePlacements === 0).length} unused elsewhere)` : '';
  const url = i.key === null || i.kind === 'removed' || i.kind === 'tokens' || core.isTokenNodeId(i.key) ? null : i.library ? i.figmaUrl ?? null : core.link(fileKey, group === 'set' && i.set ? i.set.id : i.key);
  const link = i.key === null || i.kind === 'removed' || !url ? '' : ` · [Figma](${url})`;
  const nodes = i.kind === 'library' ? 'reference (not tracked)' : `${i.nodeCount} node${i.nodeCount === 1 ? '' : 's'}`;
  return `- [${i.kind === 'library' ? 'x' : ' '}] ${title} — ${nodes}${props}${placements}${uses}${link}`;
}

/** One list line for an event (route shape). */
function eventLine(e) {
  const data = Object.entries(e.data || {})
    .map(([k, v]) => `${escape(k)}: ${Array.isArray(v) ? `${listed(v.map(valueText), 5)}` : valueText(v)}`).join('; ');
  return `- ${e.createdAt} **${escape(e.type)}** #${e.id}${e.actor ? ` by ${escape(e.actor)}` : ''}${data ? ` — ${data}` : ''}`;
}

// --- outline -------------------------------------------------------------------
const plain = v => String(v).replace(/\s+/g, ' ').trim();
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const firstProps = props => `${props.length}: ${props.slice(0, OUTLINE_PROPS).map(plain).join(', ')}${props.length > OUTLINE_PROPS ? ', …' : ''}`;

function outlineStatus(n) {
  let text = n.changeType ?? 'clean';
  if (n.changeType === 'modified' && n.changedProps.length) text += ` (${firstProps(n.changedProps)})`;
  return n.state === 'blocked' ? `${text} · blocked` : text;
}

/**
 * One outline line for a node (`nodeFields` shape): `Name (TYPE) · status`,
 * with `→ <mainComponentId> <main name>` in the parens of an instance, or
 * `→ <mainComponentId> (shown above|below)` when `seen` says where its
 * component's expanded subtree is. `marker` prefixes `↳ ` (an expanded subtree's root);
 * `absolute` appends ` (absolute)` (positioned absolutely in an auto-layout parent).
 * @param {any} n
 * @param {{ depth?: number, marker?: boolean, mainName?: string | null, seen?: 'above' | 'below' | null, absolute?: boolean }} [options]
 */
function outlineLine(n, { depth = 0, marker = false, mainName = null, seen = null, absolute = false } = {}) {
  let link = '';
  if (n.mainComponentId) {
    const ref = n.component;
    const name = ref?.set ? `${ref.set.name} / ${ref.name ?? mainName ?? n.mainComponentId}` : ref?.name ?? mainName;
    const tail = seen ? ` (shown ${seen})` : name ? ` ${plain(name)}` : '';
    link = ` → ${n.mainComponentId}${tail}`;
  }
  return `${'  '.repeat(depth)}${marker ? '↳ ' : ''}${plain(n.name ?? n.nodeId)} (${plain(n.type ?? 'NODE')}${link})${absolute ? ' (absolute)' : ''} · ${outlineStatus(n)}`;
}

/**
 * The outline lines for `rows` (`{ node, path, key, absolute, region }` in
 * listing order: tree order — ascending `key`, default `path` — within each
 * expansion region, regions in order). Depth is one more than
 * the nearest ancestor among the rows, `base` when there is none. Region 0 is
 * the scope; region r > 0 (a main component's subtree, `attach.get(r)` =
 * `{ mainId, hostId, hostPath, hostKey, hostRegion }`) is nested under its host
 * instance — right below it when the host is a row, at the host's place in
 * its region when the filters hid it — else, when its host isn't in any
 * rendered region, at the margin after the scope. `mainNames` maps main
 * component ids to names.
 */
function outlineTree(rows, { base = 0, attach = new Map(), mainNames = new Map() } = {}) {
  const byRegion = new Map();
  for (const row of rows) {
    if (!byRegion.has(row.region)) byRegion.set(row.region, []);
    byRegion.get(row.region).push(row);
  }
  const rowRegion = new Map(rows.map(r => [r.node.nodeId, r.region]));
  const underRow = new Map();
  const underPath = new Map();
  const regionOfMain = new Map();
  for (const [r, a] of attach) {
    if (!byRegion.has(r)) continue;
    regionOfMain.set(a.mainId, r);
    if (rowRegion.get(a.hostId) === a.hostRegion) {
      if (!underRow.has(a.hostId)) underRow.set(a.hostId, []);
      underRow.get(a.hostId).push(r);
    } else if (a.hostPath && a.hostRegion !== null && a.hostRegion !== undefined && a.hostRegion < r) {
      if (!underPath.has(a.hostRegion)) underPath.set(a.hostRegion, []);
      underPath.get(a.hostRegion).push({ r, path: a.hostPath, key: a.hostKey ?? a.hostPath });
    }
  }
  const lines = [];
  const rendered = new Set();
  function render(region, start) {
    rendered.add(region);
    const stack = [];
    const place = path => {
      while (stack.length && !isDescendant(path, stack[stack.length - 1].path)) stack.pop();
      return stack.length ? stack[stack.length - 1].depth + 1 : start;
    };
    const pending = (underPath.get(region) || []).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.r - b.r));
    const flush = until => {
      while (pending.length && (until === null || pending[0].key < until)) {
        const h = pending.shift();
        if (!rendered.has(h.r)) render(h.r, place(h.path));
      }
    };
    for (const row of byRegion.get(region) || []) {
      flush(row.key ?? row.path);
      const depth = place(row.path);
      stack.push({ path: row.path, depth });
      const n = row.node;
      const own = underRow.get(n.nodeId) || [];
      const shown = n.mainComponentId ? regionOfMain.get(n.mainComponentId) : undefined;
      const seen = shown === undefined || own.includes(shown) ? null : rendered.has(shown) ? 'above' : 'below';
      lines.push(outlineLine(n, { depth, marker: region > 0 && depth === start, mainName: mainNames.get(n.mainComponentId) ?? null, seen, absolute: !!row.absolute }));
      for (const r of own) if (!rendered.has(r)) render(r, depth + 1);
    }
    flush(null);
  }
  render(0, base);
  for (const r of [...byRegion.keys()].sort((a, b) => a - b)) if (!rendered.has(r)) render(r, base);
  return lines;
}

/** `Name (TYPE) · 3 nodes · changed (4: characters, fills, …) · 2 placements` for a work item (route shape). */
function itemOutline(group, i) {
  const title = (i.kind === 'removed' ? 'removed: ' : i.kind === 'library' ? 'library: ' : i.kind === 'tokens' ? 'tokens: ' : '') + (i.key === null ? `(no ${group})` : `${plain(i.name ?? i.key)} (${plain(i.type ?? 'NODE')})`);
  const nodes = i.kind === 'library' ? 'reference (not tracked)' : plural(i.nodeCount, 'node') + (i.more ? ` (first ${i.nodeIds.length} below)` : '');
  const props = i.changedProps.length ? ` · changed (${firstProps(i.changedProps)})` : '';
  const placements = i.placements === undefined || i.placements === null ? '' : ` · ${plural(i.placements, 'placement')}`;
  const inScope = i.placementsInScope === undefined || i.placementsInScope === null ? '' : ` · ${i.placementsInScope} in scope`;
  const uses = i.uses && i.uses.length ? ` · uses ${plural(i.uses.length, 'component')} (${i.uses.filter(u => u.livePlacements === 0).length} unused elsewhere)` : '';
  return `${title} · ${nodes}${props}${placements}${inScope}${uses}`;
}

/**
 * Sends the page of the rendered outline `lines` starting at line `from`, at
 * most `limit` lines (all when null), as text/plain. When `more` (rows or items
 * the render left out) the outline's last line is
 * `… N more (use cursor/limit) — cursor=<moreCursor>`. NEXT_CURSOR_HEADER is
 * `cursorAt(<next line>)` while lines remain, then `moreCursor`.
 * @param {any} reply
 * @param {string[]} lines
 * @param {{ from?: number, limit?: number | null, cursorAt: (line: number) => string, more?: number, moreCursor?: string | null, unit?: string, total?: number | null }} options
 */
function sendOutline(reply, lines, { from = 0, limit = null, cursorAt, more = 0, moreCursor = null, unit = '', total = null }) {
  const all = more ? [...lines, `… ${more} more${unit ? ` ${unit}` : ''} (use cursor/limit)${moreCursor ? ` — cursor=${moreCursor}` : ''}`] : lines;
  const out = all.slice(from, limit === null ? undefined : from + limit);
  const end = from + out.length;
  const next = end < all.length ? cursorAt(end) : more ? moreCursor : null;
  reply.type(CONTENT_TYPES.outline);
  if (total !== null) reply.header('x-total-count', String(total));
  if (next) reply.header(NEXT_CURSOR_HEADER, next);
  return reply.send(out.length ? `${out.join('\n')}\n` : '');
}

module.exports = {
  FORMATS, OUTLINE_FORMATS, CONTENT_TYPES, STREAM_PAGE, MAX_VALUE, OUTLINE_LINES, NEXT_CURSOR_HEADER, formatParam, withFormat, pageSize, stream,
  nodeLine, itemLine, eventLine, valueText, outlineLine, outlineTree, itemOutline, sendOutline,
};
