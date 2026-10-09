import { afterEach, describe, expect, it } from 'vitest';
import { defaultScope, filterScopes, readScopesVisible } from '.';

const scopes = [
  { nodeId: '1:2', name: 'Team View', lastSyncAt: '2026-10-01T10:00:00.000Z' },
  { nodeId: '3:4', name: 'Settings', lastSyncAt: '2026-10-01T11:00:00.000Z' },
  { nodeId: '9:9', name: 'Old', lastSyncAt: '2026-10-01T12:00:00.000Z', deleted: true },
  { nodeId: '5:6', name: null },
];

describe('features/scopes', () => {
  afterEach(() => window.localStorage.clear());

  it('defaults to the most recently synced live scope', () => {
    expect(defaultScope(scopes)?.nodeId).toBe('3:4');
    expect(defaultScope([{ nodeId: '5:6', lastSyncAt: undefined }])?.nodeId).toBe('5:6');
    expect(defaultScope([])).toBeUndefined();
  });

  it('searches by name or node id, either separator', () => {
    expect(filterScopes(scopes, 'SETT').map(s => s.nodeId)).toEqual(['3:4']);
    expect(filterScopes(scopes, '1-2').map(s => s.nodeId)).toEqual(['1:2']);
    expect(filterScopes(scopes, '5:6').map(s => s.nodeId)).toEqual(['5:6']);
    expect(filterScopes(scopes, '  ')).toHaveLength(4);
  });

  it('shows the panel unless it was hidden in this browser', () => {
    expect(readScopesVisible()).toBe(true);
    window.localStorage.setItem('rds.portal.scopesVisible', 'false');
    expect(readScopesVisible()).toBe(false);
  });
});
