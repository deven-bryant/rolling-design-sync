import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { matchPath, Outlet, useLocation, useNavigate } from 'react-router';
import { useClaims } from '../api/hooks/useClaims';
import { useNow } from '../api/hooks/useNow';
import { getSession, signOut } from '../api/session';
import { AvatarLabelGroup } from '../components/Avatar';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { MainLayout } from '../components/MainLayout';
import { Menu } from '../components/Menu';
import { Text, VisuallyHidden } from '../components/primitives';
import { SidebarNav } from '../components/SidebarNav';
import { ThemeToggle } from '../components/ThemeToggle';
import { useServerStatus, type ServerHealth } from '../features/connect';
import { useTheme } from '../theme';
import { lastFile } from './lastFile';
import { DOCS_URL, RouteLinks } from './links';
import { filePath } from './urlState';

/** The page frame: a sidebar slot and the main content. */
export function Shell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-primary">
      <VisuallyHidden as="div" focusable className="fixed top-md left-md z-10">
        <a href="#main" className="rounded-md bg-primary p-md text-sm font-semibold text-brand-secondary shadow-md">
          Skip to content
        </a>
      </VisuallyHidden>
      <aside className="sticky top-0 h-screen shrink-0">{sidebar}</aside>
      <MainLayout id="main">{children}</MainLayout>
    </div>
  );
}

type NavId = 'files' | 'nodes' | 'work' | 'activity' | 'claims' | 'connect';

/** The sidebar item a path belongs to. */
export function navItemOf(pathname: string): NavId | null {
  const tab = matchPath('/files/:fileKey/:tab/*', pathname)?.params.tab;
  if (tab === 'nodes' || tab === 'work') return tab;
  if (pathname === '/files' || pathname.startsWith('/files/')) return 'files';
  const top = pathname.split('/')[1];
  return top === 'activity' || top === 'claims' || top === 'connect' ? top : null;
}

const cardTitle: Record<ServerHealth, string> = {
  live: 'API connected',
  connecting: 'Connecting to the API',
  degraded: 'API reconnecting',
  offline: 'API offline',
};

function StatusCard() {
  const { status, health } = useServerStatus();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  const version = status?.version ? `v${status.version}` : null;
  const events = status?.events === 'polling' ? 'events polling' : 'live events on';
  const text = {
    live: `${[window.location.host, version].filter(Boolean).join(' · ')} · ${events}. Agents read this server through rds-mcp.`,
    connecting: 'Reaching the server and opening the event stream.',
    degraded: `${version ? `${version} · ` : ''}the event stream dropped; retrying. Pages refresh when it is back.`,
    offline: 'The server is not answering. Check that the API is running, then reload.',
  }[health];
  return (
    <SidebarNav.FeatureCard
      title={cardTitle[health]}
      onDismiss={() => setDismissed(true)}
      actions={
        <>
          <Button hierarchy="link-gray" size="sm" onPress={() => setDismissed(true)}>
            Dismiss
          </Button>
          <Button hierarchy="link-color" size="sm" href="/connect">
            Connect an agent
          </Button>
        </>
      }
    >
      {text}
    </SidebarNav.FeatureCard>
  );
}

const roleName = { agent: 'Agent', viewer: 'Viewer' } as const;
const initials = (label: string) => label.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '?';

function AccountCard() {
  const session = useQuery({ queryKey: ['session'], queryFn: () => getSession(), retry: false });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  if (!session.data) return null;
  const { role, label = '' } = session.data;
  const out = async () => {
    await signOut();
    queryClient.clear();
    void navigate('/sign-in', { replace: true });
  };
  return (
    <SidebarNav.Account
      menu={
        <Menu.Item id="sign-out" onAction={() => void out()}>
          Sign out
        </Menu.Item>
      }
    >
      <AvatarLabelGroup initials={initials(label)} status="online" label={role ? roleName[role] : 'Signed in'} supportingText={label} />
    </SidebarNav.Account>
  );
}

const LEASE_TICK_MS = 30_000;

function Sidebar() {
  const { pathname } = useLocation();
  const current = navItemOf(pathname);
  const fileKey = matchPath('/files/:fileKey/*', pathname)?.params.fileKey ?? lastFile();
  const claims = useClaims();
  const now = useNow(LEASE_TICK_MS);
  const status = useServerStatus();
  const agents = new Set(
    (claims.data ?? []).filter(c => !c.expiresAt || Date.parse(c.expiresAt) > now).map(c => c.worker),
  ).size;
  const minor = status.status?.version?.split('.').slice(0, 2).join('.');
  const { theme, setTheme } = useTheme();
  return (
    <SidebarNav>
      <SidebarNav.Header actions={<ThemeToggle theme={theme} onChange={setTheme} />}>
        <Text as="p" size="xl" weight="semibold" className="px-md">
          Rolling Design Sync
        </Text>
      </SidebarNav.Header>
      <SidebarNav.Section>
        <SidebarNav.Item href="/files" icon="home-line" current={current === 'files'}>
          Files
        </SidebarNav.Item>
        <SidebarNav.Item href={fileKey ? filePath(fileKey, 'nodes') : '/files'} icon="bar-chart-square-02" current={current === 'nodes'}>
          Nodes
        </SidebarNav.Item>
        <SidebarNav.Item href={fileKey ? filePath(fileKey, 'work') : '/files'} icon="rows-01" current={current === 'work'}>
          Work Items
        </SidebarNav.Item>
        <SidebarNav.Item
          href="/activity"
          icon="check-done-01"
          current={current === 'activity'}
          badge={agents > 0 ? <Badge aria-label={`${agents} active agents`}>{agents}</Badge> : undefined}
        >
          Activity
        </SidebarNav.Item>
        <SidebarNav.Item href="/claims" icon="pie-chart-03" current={current === 'claims'}>
          Claims
        </SidebarNav.Item>
        <SidebarNav.Item href="/connect" icon="users-01" current={current === 'connect'}>
          Connect
        </SidebarNav.Item>
      </SidebarNav.Section>
      <SidebarNav.Footer>
        <SidebarNav.Section>
          <SidebarNav.Item
            href={DOCS_URL}
            icon="help-circle"
            badge={minor ? <Badge type="badge-modern" dot>{`v${minor}`}</Badge> : undefined}
          >
            Docs
          </SidebarNav.Item>
        </SidebarNav.Section>
        <StatusCard />
        <AccountCard />
      </SidebarNav.Footer>
    </SidebarNav>
  );
}

export function Layout() {
  return (
    <RouteLinks>
      <Shell sidebar={<Sidebar />}>
        <Outlet />
      </Shell>
    </RouteLinks>
  );
}
