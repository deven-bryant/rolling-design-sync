import { useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams, useSearchParams, type Params } from 'react-router';
import { useClaims } from '../api/hooks/useClaims';
import { useNow } from '../api/hooks/useNow';
import { Button } from '../components/Button';
import { PageHeader } from '../components/PageHeader';
import { VisuallyHidden } from '../components/primitives';
import { ClaimsPanel, EventFeed } from '../features/activity';
import { AgentSetup, agentSetupSnippets, StatusMetrics, TokensTable, useServerStatus } from '../features/connect';
import { FilesMetrics, FilesTable, formatCount, plural, useFiles } from '../features/files';
import { NodeDrawer, NodeTable } from '../features/nodes';
import { ScopeViewedBadge } from '../features/scopes';
import { WorkFiltersBar, WorkGroupSwitch, WorkTable } from '../features/work';
import { CopyButton } from './CopyButton';
import { useFileOutlet } from './FileLayout';
import { lastFile } from './lastFile';
import { REPO_URL } from './links';
import { filePath, query, readNodeFilters, readWorkState, writeNodeFilters, writeWorkState } from './urlState';

/** Replaces the URL with `to` (a path, or one built from the route params), keeping the query string. */
export function Redirect({ to }: { to: string | ((params: Readonly<Params>) => string) }) {
  const params = useParams();
  const { search } = useLocation();
  return <Navigate to={{ pathname: typeof to === 'string' ? to : to(params), search }} replace />;
}

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
      <VisuallyHidden as="h2">Summary</VisuallyHidden>
      <FilesMetrics />
      <FilesTable onOpenFile={fileKey => void navigate(filePath(fileKey))} onOpenConnect={() => void navigate('/connect')} />
    </>
  );
}

export function NodesPage() {
  const { fileKey, scopes, under, scopeViewed } = useFileOutlet();
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
        filtersAddon={scopeViewed ? <ScopeViewedBadge count={scopes.length} /> : undefined}
        className="gap-4xl"
      />
      <NodeDrawer fileKey={fileKey} nodeId={nodeId} onClose={() => setNode(null)} />
    </>
  );
}

export function WorkPage() {
  const { fileKey, scope, scopes, under, scopeViewed } = useFileOutlet();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const state = readWorkState(params);
  const several = scopes.length > 1;
  const group = several ? 'component' : state.group;
  const toNodes = (nodeUnder: string | undefined) => void navigate(`${filePath(fileKey, 'nodes')}${query({ under: nodeUnder })}`);
  return (
    <>
      <WorkFiltersBar
        filters={{ q: state.q, expandInstances: state.expandInstances }}
        onFiltersChange={filters => setParams(prev => writeWorkState(prev, { ...state, ...filters, page: 1 }), { replace: true })}
        addon={scopeViewed ? <ScopeViewedBadge count={scopes.length} /> : undefined}
      />
      <WorkGroupSwitch
        group={group}
        onGroupChange={next => setParams(prev => writeWorkState(prev, { ...state, group: next, page: 1 }))}
        frameDisabledReason={several ? 'Select one scope to group by frame: frames need a single root.' : undefined}
      />
      <WorkTable
        fileKey={fileKey}
        under={under}
        scopeName={several ? `the ${scopes.length} selected scopes` : (scope?.name ?? undefined)}
        scopeCount={scopes.length}
        q={state.q}
        expandInstances={state.expandInstances}
        group={group}
        page={state.page}
        onPageChange={page => setParams(prev => writeWorkState(prev, { ...state, page }))}
        onOpenComponent={toNodes}
      />
    </>
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

export function ClaimsPage() {
  return (
    <>
      <PageHeader divider>
        <PageHeader.Title>Claims</PageHeader.Title>
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
