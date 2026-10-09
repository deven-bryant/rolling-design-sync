import { useEffect } from 'react';
import { Navigate, Outlet, useLocation, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router';
import { useNow } from '../api/hooks/useNow';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { Button } from '../components/Button';
import { PageHeader } from '../components/PageHeader';
import { formatCount, timeAgo, useLastSyncClient } from '../features/files';
import { useFile, useScope } from '../features/nodes';
import { defaultScope, ScopePanel } from '../features/scopes';
import { useWorkItems } from '../features/work';
import { CopyButton } from './CopyButton';
import { rememberFile } from './lastFile';
import { filePath, query } from './urlState';

type Scope = NonNullable<ReturnType<typeof useScope>['scope']>;

export interface FileOutlet {
  fileKey: string;
  /** The scope in `?under=`, else the most recently synced one. */
  scope: Scope | undefined;
  /** `?under=` (a scope or any node, e.g. a component). */
  under: string | undefined;
  /** `?under=` is a scope picked in the scope panel. */
  scopeViewed: boolean;
}

export const useFileOutlet = () => useOutletContext<FileOutlet>();

/** A prompt that starts an agent on a scope's work queue: MCP tools first, the CLI as the fallback. */
export function scopePrompt({ fileKey, nodeId, name }: { fileKey: string; nodeId: string; name?: string | null }): string {
  const label = name ? `"${name}" (${nodeId})` : nodeId;
  const cli = 'node scripts/rds-agent.js';
  return [
    `Implement the Figma scope ${label} in file ${fileKey}, tracked by Rolling Design Sync.`,
    'Use the rds MCP tools if you have them; otherwise run the CLI from a checkout of rolling-design-sync (needs RDS_API_BASE_URL and RDS_AGENT_TOKEN).',
    '',
    '1. List the work items under the scope; build leaves first, then the composites that contain them:',
    `   - MCP: list_work_items { "fileKey": "${fileKey}", "under": "${nodeId}", "expand": "instances" }`,
    `   - CLI: ${cli} work --file-key ${fileKey} --under ${nodeId} --expand instances`,
    "2. Claim each item's nodeIds with a stable worker id; work only on the nodes the claim returns:",
    `   - MCP: claim_nodes { "fileKey": "${fileKey}", "nodeIds": ["<nodeId>"], "worker": "<worker>" }`,
    `   - CLI: ${cli} claim --file-key ${fileKey} --node-ids <nodeId>,… --worker <worker>`,
    "3. Read what changed and each node's contentHash:",
    `   - MCP: list_nodes { "fileKey": "${fileKey}", "under": "<nodeId>" } or get_node { "fileKey": "${fileKey}", "nodeId": "<nodeId>" }`,
    `   - CLI: ${cli} nodes ls --file-key ${fileKey} --under <nodeId>, or ${cli} nodes show <nodeId> --file-key ${fileKey}`,
    '4. Implement the changes and commit them.',
    '5. Clear every node you built with its contentHash and the commit SHA:',
    `   - MCP: clear_nodes { "fileKey": "${fileKey}", "items": [{ "nodeId": "<nodeId>", "contentHash": "<contentHash>" }], "commitRef": "<sha>" }`,
    `   - CLI: ${cli} clear <nodeId>=<contentHash> … --file-key ${fileKey} --commit-ref <sha>`,
    '   A stale result means the design changed after you read it: re-read the node with get_node, implement the new change and clear it with the new contentHash.',
    '6. Block a node you cannot build, with a reason a person can act on:',
    `   - MCP: block_node { "fileKey": "${fileKey}", "nodeId": "<nodeId>", "reason": "<why>" }`,
    `   - CLI: ${cli} block <nodeId> --file-key ${fileKey} --reason "<why>"`,
  ].join('\n');
}

const typeName = (type: string | null | undefined) => (type ? type.charAt(0) + type.slice(1).toLowerCase() : 'Scope');

function ScopeMeta({ fileKey, scope }: { fileKey: string; scope: Scope }) {
  const now = useNow();
  const client = useLastSyncClient(fileKey, scope.lastSyncAt);
  const components = useWorkItems({
    fileKey,
    under: scope.nodeId,
    group: 'component',
    page: 1,
  }).total;
  const synced = scope.lastSyncAt ? `synced ${timeAgo(scope.lastSyncAt, now)}${client.data ? ` by ${client.data}` : ''}` : 'never synced';
  const counts = [
    scope.counts?.total !== undefined ? `${formatCount(scope.counts.total)} nodes` : null,
    components !== undefined ? `${formatCount(components)} components` : null,
  ].filter(Boolean);
  return <>{[`${typeName(scope.type)} ${scope.nodeId ?? ''}`, synced, counts.join(', ')].filter(Boolean).join(' · ')}</>;
}

/** The Nodes and Work Items frame: the scope header and actions, then the scope panel bound to `?under=`. */
export function FileLayout() {
  const { fileKey = '' } = useParams();
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const file = useFile(fileKey);
  const scopes = useScope(fileKey, undefined);
  useEffect(() => rememberFile(fileKey), [fileKey]);

  const live = (scopes.data?.scopes ?? []).filter(s => !s.deleted);
  const under = params.get('under') ?? undefined;
  const fallback = defaultScope(live);
  if (!under && fallback?.nodeId) {
    const next = new URLSearchParams(params);
    next.set('under', fallback.nodeId);
    return <Navigate to={{ pathname, search: `?${next.toString()}` }} replace />;
  }
  const picked = live.find(s => s.nodeId === under);
  const scope = picked ?? fallback;
  const fileName = file.data?.name ?? fileKey;
  const figmaUrl = scope?.figmaUrl ?? `https://www.figma.com/design/${encodeURIComponent(fileKey)}`;
  const onWork = pathname.endsWith('/work');

  const select = (nodeId: string) =>
    setParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('under', nodeId);
      next.delete('node');
      next.delete('page');
      return next;
    });

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
          {scope ? (
            <ScopeMeta fileKey={fileKey} scope={scope} />
          ) : scopes.isPending ? (
            'Loading scopes…'
          ) : (
            'No scopes yet — run the plugin on a frame'
          )}
        </PageHeader.Description>
        <PageHeader.Actions>
          {scope?.nodeId && (
            <CopyButton
              hierarchy="secondary"
              size="md"
              text={scopePrompt({
                fileKey,
                nodeId: scope.nodeId,
                name: scope.name,
              })}
            >
              Copy agent prompt
            </CopyButton>
          )}
          <Button hierarchy="primary" size="md" href={figmaUrl} target="_blank" rel="noreferrer">
            Open in Figma
          </Button>
        </PageHeader.Actions>
      </PageHeader>
      <ScopePanel
        fileKey={fileKey}
        fileName={fileName}
        selected={picked?.nodeId}
        onSelect={select}
        onViewNodes={onWork ? nodeId => void navigate(`${filePath(fileKey, 'nodes')}${query({ under: nodeId })}`) : undefined}
      />
      <Outlet context={{ fileKey, scope, under, scopeViewed: !!picked } satisfies FileOutlet} />
    </>
  );
}
