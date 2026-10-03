import { useEffect } from 'react';
import { Navigate, Outlet, useLocation, useOutletContext, useParams, useSearchParams } from 'react-router';
import { useNow } from '../api/hooks/useNow';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { Button } from '../components/Button';
import { PageHeader } from '../components/PageHeader';
import { Tabs } from '../components/Tabs';
import { formatCount, timeAgo, useLastSyncClient } from '../features/files';
import { useFile, useScope } from '../features/nodes';
import { useWorkItems } from '../features/work';
import { CopyButton } from './CopyButton';
import { rememberFile } from './lastFile';
import { filePath, query } from './urlState';

type Scope = NonNullable<ReturnType<typeof useScope>['scope']>;

export const FILE_TABS = [
  { id: 'nodes', label: 'Nodes' },
  { id: 'work', label: 'Work items' },
  { id: 'activity', label: 'Activity' },
  { id: 'claims', label: 'Claims' },
  { id: 'scopes', label: 'Scopes' },
] as const;

export interface FileOutlet {
  fileKey: string;
  /** The scope in `?under=`, else the file's first. */
  scope: Scope | undefined;
  /** `?under=` (a scope or any node, e.g. a component). */
  under: string | undefined;
}

export const useFileOutlet = () => useOutletContext<FileOutlet>();

/** A prompt that starts an agent on a scope's work queue. */
export function scopePrompt({ fileKey, nodeId, name }: { fileKey: string; nodeId: string; name?: string | null }): string {
  const label = name ? `"${name}" (${nodeId})` : nodeId;
  return [
    `Implement the Figma scope ${label} in file ${fileKey}, tracked by Rolling Design Sync.`,
    '',
    'Start from its work items, leaves first:',
    `- CLI: node scripts/rds-agent.js work --file-key ${fileKey} --under ${nodeId} --expand instances`,
    `- MCP: list_work_items { "fileKey": "${fileKey}", "under": "${nodeId}", "expand": "instances" }`,
    '',
    'Then read the nodes that changed:',
    `- CLI: node scripts/rds-agent.js nodes ls --file-key ${fileKey} --under ${nodeId}`,
    `- MCP: list_nodes { "fileKey": "${fileKey}", "under": "${nodeId}" }`,
  ].join('\n');
}

const typeName = (type: string | null | undefined) => (type ? type.charAt(0) + type.slice(1).toLowerCase() : 'Scope');

function ScopeMeta({ fileKey, scope }: { fileKey: string; scope: Scope }) {
  const now = useNow();
  const client = useLastSyncClient(fileKey, scope.lastSyncAt);
  const components = useWorkItems({ fileKey, under: scope.nodeId, group: 'component', page: 1 }).total;
  const synced = scope.lastSyncAt ? `synced ${timeAgo(scope.lastSyncAt, now)}${client.data ? ` by ${client.data}` : ''}` : 'never synced';
  const counts = [
    scope.counts?.total !== undefined ? `${formatCount(scope.counts.total)} nodes` : null,
    components !== undefined ? `${formatCount(components)} components` : null,
  ].filter(Boolean);
  return <>{[`${typeName(scope.type)} ${scope.nodeId ?? ''}`, synced, counts.join(', ')].filter(Boolean).join(' · ')}</>;
}

/** The file screens' frame: breadcrumbs, scope header and actions, and the file tabs bound to the URL. */
export function FileLayout() {
  const { fileKey = '' } = useParams();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const file = useFile(fileKey);
  const scopes = useScope(fileKey, undefined);
  useEffect(() => rememberFile(fileKey), [fileKey]);

  const live = (scopes.data?.scopes ?? []).filter(s => !s.deleted);
  const under = params.get('under') ?? undefined;
  const first = live[0];
  if (!under && first?.nodeId) {
    const next = new URLSearchParams(params);
    next.set('under', first.nodeId);
    return <Navigate to={{ pathname, search: `?${next.toString()}` }} replace />;
  }
  const scope = live.find(s => s.nodeId === under) ?? first;
  const fileName = file.data?.name ?? fileKey;
  const tab = FILE_TABS.find(t => pathname.endsWith(`/${t.id}`))?.id ?? 'nodes';
  const tabSearch = query({ under: scope?.nodeId ?? under });
  const figmaUrl = scope?.figmaUrl ?? `https://www.figma.com/design/${encodeURIComponent(fileKey)}`;

  return (
    <>
      <PageHeader divider>
        <PageHeader.Breadcrumbs>
          <Breadcrumbs>
            <Breadcrumbs.Item home href="/files">
              Home
            </Breadcrumbs.Item>
            <Breadcrumbs.Item href="/files">Files</Breadcrumbs.Item>
            <Breadcrumbs.Item href={filePath(fileKey)}>{fileName}</Breadcrumbs.Item>
            {scope && <Breadcrumbs.Item>{scope.name ?? scope.nodeId ?? ''}</Breadcrumbs.Item>}
          </Breadcrumbs>
        </PageHeader.Breadcrumbs>
        <PageHeader.Title>{scope?.name ?? fileName}</PageHeader.Title>
        <PageHeader.Description>
          {scope ? <ScopeMeta fileKey={fileKey} scope={scope} /> : scopes.isPending ? 'Loading scopes…' : 'No scopes yet — run the plugin on a frame'}
        </PageHeader.Description>
        <PageHeader.Actions>
          {scope?.nodeId && (
            <CopyButton hierarchy="secondary" size="md" text={scopePrompt({ fileKey, nodeId: scope.nodeId, name: scope.name })}>
              Copy agent prompt
            </CopyButton>
          )}
          <Button hierarchy="primary" size="md" href={figmaUrl} target="_blank" rel="noreferrer">
            Open in Figma
          </Button>
        </PageHeader.Actions>
      </PageHeader>
      <Tabs selectedKey={tab} className="gap-4xl">
        <Tabs.List aria-label="File">
          {FILE_TABS.map(t => (
            <Tabs.Tab key={t.id} id={t.id} href={`${filePath(fileKey, t.id)}${tabSearch}`}>
              {t.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <Tabs.Panel id={tab} className="flex flex-col gap-4xl">
          <Outlet context={{ fileKey, scope, under } satisfies FileOutlet} />
        </Tabs.Panel>
      </Tabs>
    </>
  );
}
