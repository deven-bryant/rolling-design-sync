import { useState } from 'react';
import { useNow } from '../../api/hooks/useNow';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Input } from '../../components/Input';
import { Pagination } from '../../components/Pagination';
import { LeadAction, Table, TextCell } from '../../components/Table';
import { Toggle } from '../../components/Toggle';
import { cx, Icon, Text } from '../../components/primitives';
import { formatCount, plural, timeAgo, useFileScopes, type FileScope } from '../files';

const VISIBLE_KEY = 'rds.portal.scopesVisible';
export const SCOPE_PAGE_SIZE = 10;

/** Whether the scope panel is shown: on unless this browser turned it off. */
export function readScopesVisible(): boolean {
  try {
    return window.localStorage.getItem(VISIBLE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function saveScopesVisible(visible: boolean): void {
  try {
    window.localStorage.setItem(VISIBLE_KEY, String(visible));
  } catch {
    // Storage can be unavailable (private mode, quota); the choice then lasts for this page only.
  }
}

/** The scope a file opens on: the most recently synced live one. */
export function defaultScope<T extends Pick<FileScope, 'lastSyncAt' | 'deleted'>>(scopes: readonly T[]): T | undefined {
  const time = (s: T) => (s.lastSyncAt ? Date.parse(s.lastSyncAt) : -Infinity);
  return scopes.filter(s => !s.deleted).reduce<T | undefined>((best, s) => (!best || time(s) > time(best) ? s : best), undefined);
}

/** Scopes whose name or node id contains `q` (case-insensitive; `1-2` matches `1:2`). */
export function filterScopes<T extends Pick<FileScope, 'name' | 'nodeId'>>(scopes: readonly T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [...scopes];
  const id = needle.replace(/-/g, ':');
  return scopes.filter(s => (s.name ?? '').toLowerCase().includes(needle) || (s.nodeId ?? '').includes(id));
}

const typeLabel = (type: string | null | undefined) => type ?? 'SCOPE';

/** "N Scopes Viewed": the node and work lists are narrowed to the selected scopes. */
export function ScopeViewedBadge({ count = 1 }: { count?: number }) {
  return <Badge>{`${formatCount(count)} ${count === 1 ? 'Scope' : 'Scopes'} Viewed`}</Badge>;
}

/** `ids` toggled `on` for `changed`, in the order of `order` (the panel's); ids not in `order` are dropped. */
export function toggleScopes(order: readonly string[], ids: readonly string[], changed: readonly string[], on: boolean): string[] {
  const next = new Set(ids);
  for (const id of changed) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return order.filter(id => next.has(id));
}

export interface ScopePanelProps {
  fileKey: string;
  /** Named in the card description. */
  fileName?: string;
  /** The selected scopes' node ids (`?under=a,b`). */
  selected: readonly string[];
  /** The new selection, in the panel's order; never empty (the last selected scope stays selected). */
  onSelectionChange: (nodeIds: string[]) => void;
  /** *View Nodes*: open the Nodes screen on the selected scopes; omitted (disabled) on Nodes itself. */
  onViewNodes?: (nodeIds: string[]) => void;
  className?: string;
}

/**
 * Figma *Selected File Frame*: the *View Scopes* toggle (remembered per browser), *Search Scope*,
 * and the Scopes card — row checkboxes and a select-all-on-this-page checkbox pick the scopes that narrow the screen below it.
 */
export function ScopePanel({ fileKey, fileName, selected, onSelectionChange, onViewNodes, className }: ScopePanelProps) {
  const [visible, setVisible] = useState(readScopesVisible);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const scopes = useFileScopes(fileKey);
  const now = useNow();

  const matches = filterScopes(scopes.data ?? [], q);
  const pageCount = Math.max(1, Math.ceil(matches.length / SCOPE_PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const rows = matches.slice((current - 1) * SCOPE_PAGE_SIZE, current * SCOPE_PAGE_SIZE);
  const order = (scopes.data ?? []).flatMap(s => (s.nodeId ? [s.nodeId] : []));
  const picked = new Set(selected);
  const pageIds = rows.flatMap(s => (s.nodeId ? [s.nodeId] : []));
  const pageOn = pageIds.filter(id => picked.has(id)).length;
  const change = (ids: readonly string[], on: boolean) => {
    const next = toggleScopes(order, selected, ids, on);
    if (next.length > 0) onSelectionChange(next);
  };
  const toggle = (on: boolean) => {
    setVisible(on);
    saveScopesVisible(on);
  };

  return (
    <section aria-label="Scopes" className={cx('flex flex-col gap-2xl', className)}>
      <div className="flex flex-wrap items-center justify-between gap-lg">
        <Toggle isSelected={visible} onChange={toggle}>
          View Scopes
        </Toggle>
        {visible && (
          <Input
            aria-label="Search Scope"
            className="w-80"
            type="search"
            placeholder="Search Scope"
            iconLeading={<Icon name="search-lg" size="md" />}
            value={q}
            onChange={value => {
              setQ(value);
              setPage(1);
            }}
          />
        )}
      </div>
      {visible && (
        <Card className="overflow-hidden">
          <Card.Header
            title="Scopes"
            badge={selected.length > 0 ? <Badge color="brand">{`${formatCount(selected.length)} selected`}</Badge> : undefined}
            description={`The sections and frames that are synced from ${fileName ?? 'this file'}.`}
            actions={
              <Button
                hierarchy="secondary"
                size="sm"
                isDisabled={!onViewNodes || selected.length === 0}
                onPress={() => onViewNodes?.([...selected])}
              >
                View Nodes
              </Button>
            }
          />
          <Card.Body>
            {scopes.isPending ? (
              <Text as="p" color="tertiary" className="px-3xl py-xl">
                Loading scopes…
              </Text>
            ) : scopes.error ? (
              <Text as="p" color="error-primary" className="px-3xl py-xl">
                Couldn’t load scopes: {scopes.error.message}
              </Text>
            ) : matches.length === 0 ? (
              <Text as="p" color="tertiary" className="px-3xl py-xl">
                {q.trim() ? 'No scopes match this search.' : 'No scopes yet — run the plugin on a frame.'}
              </Text>
            ) : (
              <Table aria-label="Scopes">
                <Table.Header>
                  <Table.HeaderCell
                    checkbox={
                      <LeadAction
                        aria-label="Select all scopes on this page"
                        isSelected={pageIds.length > 0 && pageOn === pageIds.length}
                        isIndeterminate={pageOn > 0 && pageOn < pageIds.length}
                        onChange={on => change(pageIds, on)}
                      />
                    }
                  >
                    Name
                  </Table.HeaderCell>
                  <Table.HeaderCell>Node ID</Table.HeaderCell>
                  <Table.HeaderCell>Last Sync</Table.HeaderCell>
                  <Table.HeaderCell>Status of Child Nodes</Table.HeaderCell>
                  <Table.HeaderCell>Figma</Table.HeaderCell>
                </Table.Header>
                <Table.Body>
                  {rows.map(scope => {
                    const nodeId = scope.nodeId ?? '';
                    const name = scope.name ?? nodeId;
                    const isSelected = !!nodeId && picked.has(nodeId);
                    return (
                      <Table.Row key={nodeId} selected={isSelected} onAction={() => nodeId && change([nodeId], !isSelected)}>
                        <TextCell
                          supportingText={typeLabel(scope.type)}
                          leadAction={
                            <LeadAction
                              aria-label={`Select ${name}`}
                              isSelected={isSelected}
                              onChange={on => nodeId && change([nodeId], on)}
                            />
                          }
                        >
                          {name}
                        </TextCell>
                        <TextCell>{nodeId}</TextCell>
                        <TextCell>{scope.lastSyncAt ? timeAgo(scope.lastSyncAt, now) : 'Never'}</TextCell>
                        <TextCell
                          supportingText={`${formatCount(scope.counts?.dirty ?? 0)} dirty · ${formatCount(scope.counts?.blocked ?? 0)} blocked`}
                        >
                          {plural(scope.counts?.total ?? 0, 'node')}
                        </TextCell>
                        <Table.Cell>
                          {scope.figmaUrl && (
                            <Button
                              hierarchy="link-color"
                              size="sm"
                              href={scope.figmaUrl}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`Open ${name} in Figma`}
                            >
                              Open
                            </Button>
                          )}
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table>
            )}
          </Card.Body>
          {pageCount > 1 && <Pagination page={current} pageCount={pageCount} onPageChange={setPage} label="Scope pages" />}
        </Card>
      )}
    </section>
  );
}
