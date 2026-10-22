import { useState, type ReactNode } from 'react';
import { Menu } from '../Menu';
import type { GalleryEntry, GalleryExample } from '../primitives';
import { Text } from '../primitives';
import { ThemeToggle, type ThemeToggleTheme } from '../ThemeToggle';
import { SidebarNav } from './SidebarNav';

const identity = (
  <span className="flex flex-col">
    <Text size="sm" weight="semibold" color="primary">
      Viewer
    </Text>
    <Text size="sm" color="tertiary">
      Read + block / release
    </Text>
  </span>
);

function HeaderToggle({ initial }: { initial: ThemeToggleTheme }) {
  const [theme, setTheme] = useState(initial);
  return <ThemeToggle theme={theme} onChange={setTheme} />;
}

const themes = [
  ['Light', undefined],
  ['Dark', 'dark'],
] as const;

/** One example per theme: `Color Mode` is the `data-theme` the example renders under, never a prop. */
const bothThemes = (figma: string, render: (mode: string) => ReactNode): GalleryExample[] =>
  themes.map(([mode, theme]) => ({
    figma: `${figma} · Color Mode=${mode}`,
    render: () => (
      <div data-theme={theme} className="bg-primary">
        {render(mode)}
      </div>
    ),
  }));

export default {
  component: 'SidebarNav',
  examples: [
    ...bothThemes('Portal Sidebar Navigation', mode => (
      <div className="flex h-240">
        <SidebarNav aria-label={`Main (${mode})`}>
          <SidebarNav.Header title="Untitled UI" actions={<HeaderToggle initial={mode === 'Dark' ? 'dark' : 'light'} />} />
          <SidebarNav.Section>
            <SidebarNav.Item href="#files" icon="home-line">
              Files
            </SidebarNav.Item>
            <SidebarNav.Item href="#nodes" icon="bar-chart-square-02" current>
              Nodes
            </SidebarNav.Item>
            <SidebarNav.Item href="#work-items" icon="rows-01">
              Work Items
            </SidebarNav.Item>
            <SidebarNav.Item href="#activity" icon="pie-chart-03" badge={<Text size="xs">3</Text>}>
              Activity
            </SidebarNav.Item>
            <SidebarNav.Item href="#claims" icon="check-done-01">
              Claims
            </SidebarNav.Item>
            <SidebarNav.Item href="#connect" icon="users-01">
              Connect
            </SidebarNav.Item>
          </SidebarNav.Section>
          <SidebarNav.Footer>
            <SidebarNav.Section>
              <SidebarNav.Item href="#settings" icon="settings-01">
                Settings
              </SidebarNav.Item>
              <SidebarNav.Item href="#docs" icon="file-04" badge={<Text size="xs">v0.10</Text>}>
                Docs
              </SidebarNav.Item>
              <SidebarNav.Item href="#open" icon="arrow-up-right">
                Open in browser
              </SidebarNav.Item>
            </SidebarNav.Section>
            <SidebarNav.FeatureCard
              title="API connected"
              onDismiss={() => undefined}
              actions={
                <>
                  <Text size="sm" weight="semibold" color="tertiary">
                    Dismiss
                  </Text>
                  <Text size="sm" weight="semibold" color="brand-secondary">
                    Connect an agent
                  </Text>
                </>
              }
            >
              localhost:8787 · live events on. Agents read this server through rds-mcp.
            </SidebarNav.FeatureCard>
            <SidebarNav.Account menu={<Menu.Item id="sign-out">Sign out</Menu.Item>}>{identity}</SidebarNav.Account>
          </SidebarNav.Footer>
        </SidebarNav>
      </div>
    )).map(example => ({ ...example, set: 'Portal Sidebar Navigation', variant: '' })),
    ...bothThemes('Nav items, one the current page', mode => (
      <SidebarNav aria-label={`Nav items (${mode})`} className="h-auto pt-none">
        <SidebarNav.Section>
          <SidebarNav.Item href="#dashboard" icon="bar-chart-square-02">
            Dashboard
          </SidebarNav.Item>
          <SidebarNav.Item href="#inbox" icon="mail-01" current badge={<Text size="xs">10</Text>}>
            Inbox
          </SidebarNav.Item>
        </SidebarNav.Section>
      </SidebarNav>
    )),
    ...bothThemes('Featured card without a progress bar', () => (
      <div className="w-68 p-md">
        <SidebarNav.FeatureCard
          title="API connected"
          onDismiss={() => undefined}
          actions={<Text size="sm" weight="semibold" color="tertiary">Dismiss</Text>}
        >
          Agents read this server through rds-mcp.
        </SidebarNav.FeatureCard>
      </div>
    )),
    ...bothThemes('Account card', () => (
      <div className="w-70 p-md">
        <SidebarNav.Account menu={<Menu.Item id="profile" icon="placeholder">View profile</Menu.Item>}>{identity}</SidebarNav.Account>
      </div>
    )),
  ],
} satisfies GalleryEntry;
