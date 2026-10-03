import { describe, expect, it } from 'vitest';
import { categoriesOf, categoryOf } from './categories';
import { formatValue, nodeMeta, nodePrompt, sideLabel, timeAgo, timeUntil, whatChanged } from './format';
import { blockReasonError, describeEvent } from './NodeDrawer';
import { searchParams } from './queries';
import { breadcrumbs, divider, node, pageHeader } from './test-fixtures';

describe('format', () => {
  it('formats raw values the way designers read them', () => {
    expect(formatValue([{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1 }])).toBe('#FFFFFF');
    expect(formatValue({ type: 'SOLID', color: { r: 0.976, g: 0.98, b: 0.984 }, opacity: 0.5 })).toBe('#F9FAFB80');
    expect(
      formatValue({ type: 'DROP_SHADOW', color: { r: 10 / 255, g: 13 / 255, b: 18 / 255, a: 0.05 }, offset: { x: 0, y: 1 }, radius: 2 }),
    ).toBe('0 1 2 #0A0D120D');
    expect(formatValue({ value: 150, unit: 'PERCENT' })).toBe('150%');
    expect(formatValue(12.3456)).toBe('12.35');
    expect(formatValue(null)).toBe('—');
    expect(formatValue([])).toBe('none');
    expect(formatValue({ token: 'Spacing/spacing-md', value: 12 })).toBe('12');
    expect(sideLabel({ token: 'Colors/Background/bg-primary', value: [] })).toBe('bg-primary');
  });

  it('summarizes what changed: the first token change, else the property count', () => {
    expect(whatChanged(breadcrumbs)).toEqual({ text: 'itemSpacing', supportingText: 'spacing-md → spacing-lg' });
    expect(whatChanged(pageHeader)).toEqual({ text: '3 properties', supportingText: 'new since last clear' });
    expect(whatChanged(divider)).toEqual({ text: '1 property', supportingText: 'changed since last clear' });
    expect(whatChanged(node('9:9'))).toBeNull();
  });

  it('describes a node, an instance and a main component reached through one', () => {
    expect(nodeMeta(breadcrumbs)).toBe('FRAME · 1:3');
    expect(nodeMeta(pageHeader)).toBe('INSTANCE · 1:2 → 1:50');
    expect(nodeMeta(node('1:50', { type: 'COMPONENT' }), '1:2')).toBe('COMPONENT · 1:50 · via 1:2');
  });

  it('categorizes properties like the API', () => {
    expect(categoryOf('paddingLeft')).toBe('layout');
    expect(categoryOf('strokesIncludedInLayout')).toBe('layout');
    expect(categoryOf('strokeWeight')).toBe('color');
    expect(categoryOf('topLeftRadius')).toBe('effects');
    expect(categoryOf('innerRadius')).toBe('content');
    expect(categoryOf('somethingNew')).toBe('other');
    expect(categoriesOf(['fills', 'width', 'effects', 'fills'])).toEqual(['layout', 'color', 'effects']);
  });

  it('writes relative times', () => {
    const now = Date.parse('2026-10-01T12:00:00Z');
    expect(timeAgo('2026-10-01T11:59:50Z', now)).toBe('just now');
    expect(timeAgo('2026-10-01T11:58:00Z', now, 'short')).toBe('2m ago');
    expect(timeAgo('2026-10-01T11:58:00Z', now)).toBe('2 min ago');
    expect(timeAgo('2026-10-01T09:00:00Z', now)).toBe('3 hours ago');
    expect(timeAgo('2026-09-29T12:00:00Z', now)).toBe('2 days ago');
    expect(timeUntil('2026-10-01T12:14:00Z', now)).toBe('in 14 min');
    expect(timeUntil('2026-10-01T11:00:00Z', now)).toBe('expired');
  });

  it('builds a node prompt with the file key, node id and the CLI and MCP calls', () => {
    const prompt = nodePrompt({ fileKey: 'KEY', nodeId: '1:3', name: 'Breadcrumbs' });
    expect(prompt).toContain('"Breadcrumbs" (1:3) in file KEY');
    expect(prompt).toContain('node scripts/rds-agent.js nodes show 1:3 --file-key KEY');
    expect(prompt).toContain('get_node { "fileKey": "KEY", "nodeId": "1:3" }');
    expect(prompt).toContain('claim_nodes');
    expect(prompt).toContain('clear_nodes');
  });

  it('maps the search box to listing parameters', () => {
    expect(searchParams('')).toEqual({});
    expect(searchParams('Button')).toEqual({ name: '*Button*' });
    expect(searchParams('1-23')).toEqual({ under: '1:23' });
    expect(searchParams('state:dirty changed:fills')).toEqual({ q: 'state:dirty changed:fills' });
  });

  it('validates block reasons (1–500 characters)', () => {
    expect(blockReasonError('   ')).toMatch(/Enter why/);
    expect(blockReasonError('x'.repeat(501))).toMatch(/500 characters/);
    expect(blockReasonError('Waiting on a token')).toBeNull();
  });

  it('describes history events', () => {
    const at = '2026-10-01T12:00:00Z';
    expect(describeEvent({ type: 'claim.created', createdAt: at, data: { nodeCount: 3, expiresAt: '2026-10-01T12:15:00Z' } })).toBe(
      'Claimed this node with 2 others (lease 15 min).',
    );
    expect(describeEvent({ type: 'nodes.cleared', data: { commitRef: '3f2a9c1e5d7b' } })).toBe('Cleared it as implemented at 3f2a9c1.');
    expect(describeEvent({ type: 'node.blocked', data: { reason: 'No token' } })).toBe('Blocked it: No token');
  });
});
