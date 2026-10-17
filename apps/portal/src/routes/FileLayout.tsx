import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router';
import { useNow } from '../api/hooks/useNow';
import { Button, ButtonUtility } from '../components/Button';
import { Icon } from '../components/primitives';
import { PageHeader } from '../components/PageHeader';
import { FileSettingsDrawer, formatCount, timeAgo, useLastSyncClient } from '../features/files';
import { splitUnder, useFile, useScope } from '../features/nodes';
import { defaultScope, ScopePanel } from '../features/scopes';
import { useWorkItems } from '../features/work';
import { CopyButton } from './CopyButton';
import { rememberFile } from './lastFile';
import { filePath, query } from './urlState';

type Scope = NonNullable<ReturnType<typeof useScope>['scope']>;

export interface FileOutlet {
  fileKey: string;
  /** The scope in `?under=`, else the most recently synced one; unset when several are selected. */
  scope: Scope | undefined;
  /** The scopes in `?under=`, in its order. */
  scopes: Scope[];
  /** `?under=` (a scope or any node, e.g. a component; several comma-separated). */
  under: string | undefined;
  /** `?under=` is scopes picked in the scope panel. */
  scopeViewed: boolean;
}

export const useFileOutlet = () => useOutletContext<FileOutlet>();

export interface PromptScope {
  nodeId: string;
  name?: string | null;
}

/**
 * A prompt that starts an agent on the work queue of one or more scopes: MCP tools first, the CLI as the
 * fallback. Several scopes are named in order and passed as one comma-separated `under`.
 */
export function scopePrompt({ fileKey, scopes }: { fileKey: string; scopes: readonly PromptScope[] }): string {
  const nodeId = scopes.map(s => s.nodeId).join(',');
  const label = scopes.map(({ nodeId: id, name }) => (name ? `"${name}" (${id})` : id)).join(', ');
  const cli = 'node scripts/rds-agent.js';
  return [
    `Implement the Figma ${scopes.length === 1 ? 'scope' : 'scopes'} ${label} in file ${fileKey}, tracked by Rolling Design Sync.`,
    'Use the rds MCP tools if you have them; otherwise run the CLI from a checkout of rolling-design-sync (needs RDS_API_BASE_URL and RDS_AGENT_TOKEN).',
    '',
    `1. List the work items under the ${scopes.length === 1 ? 'scope' : 'scopes'}; build leaves first, then the composites that contain them:`,
    `   - MCP: list_work_items { "fileKey": "${fileKey}", "under": "${nodeId}", "expand": "instances" }`,
    `   - CLI: ${cli} work --file-key ${fileKey} --under ${nodeId} --expand instances`,
    '   An item with kind "removed" is design deleted in Figma: remove its code (keep the components in its uses with livePlacements > 0), then clear just its root with subtree: true.',
    '   An item with kind "tokens" is one collection of design tokens: update the code variables (each token\'s codeSyntax, WEB, else the token name) for every changed mode (value:<Mode>), then clear the tokens.',
    "2. Claim each item's nodeIds with a stable worker id; work only on the nodes the claim returns:",
    `   - MCP: claim_nodes { "fileKey": "${fileKey}", "nodeIds": ["<nodeId>"], "worker": "<worker>" }`,
    `   - CLI: ${cli} claim --file-key ${fileKey} --node-ids <nodeId>,… --worker <worker>`,
    "3. Read what changed and each node's contentHash:",
    `   - MCP: list_nodes { "fileKey": "${fileKey}", "under": "<nodeId>" } or get_node { "fileKey": "${fileKey}", "nodeId": "<nodeId>" }`,
    `   - CLI: ${cli} nodes ls --file-key ${fileKey} --under <nodeId>, or ${cli} nodes show <nodeId> --file-key ${fileKey}`,
    '4. Implement the changes and commit them.',
    '   An item with notes has nodes a person noted as not matching the design (changeType "requested" when the design is otherwise built): read the notes on the node (get_node), fix the code to match the design as they describe; clearing resolves them.',
    '   A frame with a screen (render check) whose status is "mismatch" has a render_check note listing the regions that differ from the design; a requested check waits for you: render its route and submit the screenshot with rds-agent check.',
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
  const tokens = scope.type === 'TOKENS';
  const components = useWorkItems({
    fileKey,
    under: scope.nodeId,
    group: 'component',
    page: 1,
  }).total;
  const synced = scope.lastSyncAt ? `synced ${timeAgo(scope.lastSyncAt, now)}${client.data ? ` by ${client.data}` : ''}` : 'never synced';
  const counts = [
    scope.counts?.total !== undefined ? `${formatCount(scope.counts.total)} nodes` : null,
    components !== undefined && !tokens ? `${formatCount(components)} components` : null,
  ].filter(Boolean);
  const kind = tokens ? 'Figma variables' : `${typeName(scope.type)} ${scope.nodeId ?? ''}`;
  return <>{[kind, synced, counts.join(', ')].filter(Boolean).join(' · ')}</>;
}

/** Several scopes: their summed node counts, the components they use and the latest sync. */
function ScopesMeta({ fileKey, scopes }: { fileKey: string; scopes: readonly Scope[] }) {
  const now = useNow();
  const components = useWorkItems({
    fileKey,
    under: scopes.map(s => s.nodeId).join(','),
    group: 'component',
    page: 1,
  }).total;
  const latest = scopes.reduce<string | undefined>((at, s) => (s.lastSyncAt && (!at || s.lastSyncAt > at) ? s.lastSyncAt : at), undefined);
  const nodes = scopes.reduce((sum, s) => sum + (s.counts?.total ?? 0), 0);
  const counts = [`${formatCount(nodes)} nodes`, components !== undefined ? `${formatCount(components)} components` : null].filter(Boolean);
  return <>{[`${scopes.length} scopes`, latest ? `last synced ${timeAgo(latest, now)}` : 'never synced', counts.join(', ')].join(' · ')}</>;
}

/** The Nodes and Work Items frame: the scope header and actions, then the scope panel bound to `?under=`. */
export function FileLayout() {
  const { fileKey = '' } = useParams();
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const file = useFile(fileKey);
  const scopes = useScope(fileKey, undefined);
  useEffect(() => rememberFile(fileKey), [fileKey]);

  const live = (scopes.data?.scopes ?? []).filter(s => !s.deleted);
  const under = params.get('under') || undefined;
  const fallback = defaultScope(live);
  if (!under && fallback?.nodeId) {
    const next = new URLSearchParams(params);
    next.set('under', fallback.nodeId);
    return <Navigate to={{ pathname, search: `?${next.toString()}` }} replace />;
  }
  const picked = splitUnder(under).flatMap(id => live.filter(s => s.nodeId === id));
  const several = picked.length > 1;
  const scope = several ? undefined : (picked[0] ?? fallback);
  const shown = several ? picked : scope ? [scope] : [];
  const title = several ? `${picked.length} scopes` : scope?.name ?? scope?.nodeId ?? undefined;
  const fileName = file.data?.name ?? fileKey;
  const figmaUrl = scope?.figmaUrl ?? `https://www.figma.com/design/${encodeURIComponent(fileKey)}`;
  const onWork = pathname.endsWith('/work');

  const select = (nodeIds: string[]) =>
    setParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('under', nodeIds.join(','));
      next.delete('node');
      next.delete('page');
      return next;
    });

  return (
    <>
      <PageHeader divider className="bg-primary">
        <PageHeader.Title>{title ?? fileName}</PageHeader.Title>
        <PageHeader.Description>
          {several ? (
            <ScopesMeta fileKey={fileKey} scopes={picked} />
          ) : scope ? (
            <ScopeMeta fileKey={fileKey} scope={scope} />
          ) : scopes.isPending ? (
            'Loading scopes…'
          ) : (
            'No scopes yet — run the plugin on a frame'
          )}
        </PageHeader.Description>
        <PageHeader.Actions>
          <ButtonUtility size="md" icon={<Icon name="settings-01" />} tooltip="File settings" onPress={() => setSettingsOpen(true)} />
          {shown.length > 0 && (
            <CopyButton
              hierarchy="secondary"
              size="md"
              text={scopePrompt({
                fileKey,
                scopes: shown.flatMap(s => (s.nodeId ? [{ nodeId: s.nodeId, name: s.name }] : [])),
              })}
            >
              Copy agent prompt
            </CopyButton>
          )}
          {!several && (
            <Button hierarchy="primary" size="md" href={figmaUrl} target="_blank" rel="noreferrer">
              Open in Figma
            </Button>
          )}
        </PageHeader.Actions>
      </PageHeader>
      <ScopePanel
        fileKey={fileKey}
        fileName={fileName}
        selected={picked.flatMap(s => (s.nodeId ? [s.nodeId] : []))}
        onSelectionChange={select}
        onViewNodes={onWork ? nodeIds => void navigate(`${filePath(fileKey, 'nodes')}${query({ under: nodeIds.join(',') })}`) : undefined}
      />
      <FileSettingsDrawer fileKey={fileKey} isOpen={settingsOpen} onOpenChange={setSettingsOpen} />
      <Outlet context={{ fileKey, scope, scopes: picked, under, scopeViewed: picked.length > 0 } satisfies FileOutlet} />
    </>
  );
}
