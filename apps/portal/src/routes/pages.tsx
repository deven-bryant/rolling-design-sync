import { useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { useClaims } from '../api/hooks/useClaims';
import { useNow } from '../api/hooks/useNow';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { Table, TextCell } from '../components/Table';
import { Text } from '../components/primitives';
import { ClaimsPanel, EventFeed } from '../features/activity';
import { AgentSetup, agentSetupSnippets, StatusMetrics, TokensTable, useServerStatus } from '../features/connect';
import { FilesMetrics, FilesTable, formatCount, plural, timeAgo, useFiles } from '../features/files';
import { NodeDrawer, NodeTable, useScope } from '../features/nodes';
import { WorkGroupSwitch, WorkTable } from '../features/work';
import { CopyButton } from './CopyButton';
import { useFileOutlet } from './FileLayout';
import { lastFile } from './lastFile';
import { REPO_URL } from './links';
import { filePath, query, readNodeFilters, readWorkState, writeNodeFilters, writeWorkState } from './urlState';

export function FilesPage() {
  const navigate = useNavigate();
  const files = useFiles();
  const list = files.data ?? [];
  const nodes = list.reduce((sum, f) => sum + (f.counts?.total ?? 0), 0);
  return (
    <>
      <PageHeader divider>
        <PageHeader.Title>Files</PageHeader.Title>
        <PageHeader.Description>
          {['Figma files synced to this server', ...(files.data ? [plural(list.length, 'file'), `${formatCount(nodes)} nodes tracked`] : [])].join(
            ' · ',
          )}
        </PageHeader.Description>
        <PageHeader.Actions>
          <Button hierarchy="secondary" size="md" href={`${REPO_URL}#2-connect-the-figma-plugin`} target="_blank" rel="noreferrer">
            Plugin setup
          </Button>
          <Button hierarchy="primary" size="md" href="/connect">
            Connect an agent
          </Button>
        </PageHeader.Actions>
      </PageHeader>
      <FilesMetrics />
      <FilesTable onOpenFile={fileKey => void navigate(filePath(fileKey))} onOpenConnect={() => void navigate('/connect')} />
    </>
  );
}

/** `/files/:fileKey` → its Nodes tab; the file layout then fills in the first scope. */
export function FileIndexPage() {
  const { fileKey = '' } = useParams();
  const [params] = useSearchParams();
  return <Navigate to={{ pathname: filePath(fileKey, 'nodes'), search: params.toString() ? `?${params}` : '' }} replace />;
}

export function NodesPage() {
  const { fileKey, under } = useFileOutlet();
  const [params, setParams] = useSearchParams();
  const nodeId = params.get('node');
  const setNode = (id: string | null) =>
    setParams(prev => {
      const next = new URLSearchParams(prev);
      if (id) next.set('node', id);
      else next.delete('node');
      return next;
    });
  return (
    <>
      <NodeTable
        fileKey={fileKey}
        scopeId={under}
        filters={readNodeFilters(params)}
        onFiltersChange={filters => setParams(prev => writeNodeFilters(prev, filters), { replace: true })}
        onOpenNode={setNode}
        selectedNodeId={nodeId}
        className="gap-4xl"
      />
      <NodeDrawer fileKey={fileKey} nodeId={nodeId} onClose={() => setNode(null)} />
    </>
  );
}

export function WorkPage() {
  const { fileKey, scope, under } = useFileOutlet();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const state = readWorkState(params);
  const toNodes = (nodeUnder: string | undefined) => void navigate(`${filePath(fileKey, 'nodes')}${query({ under: nodeUnder })}`);
  return (
    <>
      <WorkGroupSwitch
        group={state.group}
        onGroupChange={group => setParams(prev => writeWorkState(prev, { group, page: 1 }))}
        onShowFlatList={() => toNodes(under)}
      />
      <WorkTable
        fileKey={fileKey}
        under={under}
        scopeName={scope?.name ?? undefined}
        group={state.group}
        page={state.page}
        onPageChange={page => setParams(prev => writeWorkState(prev, { ...state, page }))}
        onOpenComponent={toNodes}
      />
    </>
  );
}

export function FileActivityPage() {
  const { fileKey, under } = useFileOutlet();
  const navigate = useNavigate();
  return (
    <EventFeed
      fileKey={fileKey}
      onOpenNode={(key, node) => void navigate(`${filePath(key, 'nodes')}${query({ under: key === fileKey ? under : undefined, node })}`)}
    />
  );
}

export function FileClaimsPage() {
  const { fileKey } = useFileOutlet();
  return <ClaimsPanel fileKey={fileKey} description="Who holds this file's nodes, and when each lease runs out" />;
}

export function FileScopesPage() {
  const { fileKey } = useFileOutlet();
  const scopes = useScope(fileKey, undefined);
  const now = useNow();
  const live = (scopes.data?.scopes ?? []).filter(s => !s.deleted);
  return (
    <Card>
      <Card.Header
        title="Scopes"
        badge={<Badge color="brand">{plural(live.length, 'scope')}</Badge>}
        description="The sections and frames the plugin syncs from this file"
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
        ) : live.length === 0 ? (
          <Text as="p" color="tertiary" className="px-3xl py-xl">
            No scopes yet — run the plugin on a frame.
          </Text>
        ) : (
          <Table aria-label="Scopes">
            <Table.Header>
              <Table.HeaderCell>Scope</Table.HeaderCell>
              <Table.HeaderCell>Node ID</Table.HeaderCell>
              <Table.HeaderCell>Last sync</Table.HeaderCell>
              <Table.HeaderCell>Nodes</Table.HeaderCell>
              <Table.HeaderCell>Open</Table.HeaderCell>
            </Table.Header>
            <Table.Body>
              {live.map(scope => (
                <Table.Row key={scope.nodeId}>
                  <TextCell supportingText={scope.type ?? undefined}>{scope.name ?? scope.nodeId ?? ''}</TextCell>
                  <TextCell>{scope.nodeId ?? ''}</TextCell>
                  <TextCell>{scope.lastSyncAt ? timeAgo(scope.lastSyncAt, now) : 'Never'}</TextCell>
                  <TextCell supportingText={`${formatCount(scope.counts?.dirty ?? 0)} dirty · ${formatCount(scope.counts?.blocked ?? 0)} blocked`}>
                    {plural(scope.counts?.total ?? 0, 'node')}
                  </TextCell>
                  <Table.Cell>
                    <Button
                      hierarchy="link-color"
                      size="sm"
                      href={`${filePath(fileKey, 'nodes')}${query({ under: scope.nodeId })}`}
                      aria-label={`Nodes in ${scope.name ?? scope.nodeId ?? 'scope'}`}
                    >
                      Nodes
                    </Button>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Card.Body>
    </Card>
  );
}

export function ActivityPage() {
  const [paused, setPaused] = useState(false);
  const navigate = useNavigate();
  const claims = useClaims();
  const { status } = useServerStatus();
  const now = useNow();
  const agents = new Set((claims.data ?? []).filter(c => !c.expiresAt || Date.parse(c.expiresAt) > now).map(c => c.worker)).size;
  const replay = status?.replayHours ? `reconnects replay the last ${plural(status.replayHours, 'hour')}` : null;
  return (
    <>
      <PageHeader divider>
        <PageHeader.Title>Activity</PageHeader.Title>
        <PageHeader.Description>
          {['Live from the event stream', replay, `${plural(agents, 'agent')} active`].filter(Boolean).join(' · ')}
        </PageHeader.Description>
        <PageHeader.Actions>
          <Button hierarchy="secondary" size="md" onPress={() => setPaused(p => !p)}>
            {paused ? 'Resume live' : 'Pause live'}
          </Button>
        </PageHeader.Actions>
      </PageHeader>
      <div className="flex items-start gap-2xl">
        <EventFeed
          paused={paused}
          onPausedChange={setPaused}
          pauseControl={false}
          onOpenNode={(fileKey, node) => void navigate(`${filePath(fileKey, 'nodes')}${query({ node })}`)}
          className="min-w-0 flex-[1.15]"
        />
        <ClaimsPanel className="min-w-0 flex-1" />
      </div>
    </>
  );
}

export function AgentsPage() {
  return (
    <>
      <PageHeader divider>
        <PageHeader.Title>Agents</PageHeader.Title>
        <PageHeader.Description>Who holds which nodes in every file, and when each lease runs out</PageHeader.Description>
      </PageHeader>
      <ClaimsPanel />
    </>
  );
}

export function ConnectPage() {
  const origin = window.location.origin;
  const fileKey = lastFile() ?? undefined;
  return (
    <>
      <PageHeader divider>
        <PageHeader.Title>Connect</PageHeader.Title>
        <PageHeader.Description>Point agents and the Figma plugin at this server</PageHeader.Description>
        <PageHeader.Actions>
          <Button hierarchy="secondary" size="md" href={`${REPO_URL}/blob/main/docs/agents.md`} target="_blank" rel="noreferrer">
            Agent docs
          </Button>
          <CopyButton hierarchy="primary" size="md" text={agentSetupSnippets(origin, fileKey).cursor}>
            Copy MCP config
          </CopyButton>
        </PageHeader.Actions>
      </PageHeader>
      <StatusMetrics />
      <AgentSetup origin={origin} fileKey={fileKey} />
      <TokensTable />
    </>
  );
}

export function NotFoundPage() {
  return (
    <PageHeader>
      <PageHeader.Title>Page not found</PageHeader.Title>
      <PageHeader.Description>There is no portal page at this address.</PageHeader.Description>
      <PageHeader.Actions>
        <Button hierarchy="secondary" size="md" href="/files">
          Go to Files
        </Button>
      </PageHeader.Actions>
    </PageHeader>
  );
}
