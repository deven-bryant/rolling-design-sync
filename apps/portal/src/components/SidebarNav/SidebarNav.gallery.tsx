import type { ReactNode } from 'react';
import { Menu } from '../Menu';
import type { GalleryEntry, GalleryExample } from '../primitives';
import { Text } from '../primitives';
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
    ...bothThemes('Open=False, Style=Simple, Breakpoint=Desktop', mode => (
      <div className="flex h-240">
        <SidebarNav aria-label={`Main (${mode})`}>
          <SidebarNav.Header actions={<Text size="xs" color="tertiary">Theme toggle slot</Text>}>
            <Text as="p" size="xl" weight="semibold" className="px-md">
              Rolling Design Sync
            </Text>
          </SidebarNav.Header>
          <SidebarNav.Section>
            <SidebarNav.Item href="#files" icon="home-line">
              Files
            </SidebarNav.Item>
            <SidebarNav.Item href="#nodes" icon="bar-chart-square-02" current>
              Nodes
            </SidebarNav.Item>
            <SidebarNav.Item href="#activity" icon="placeholder" badge={<Text size="xs">3</Text>}>
              Activity
            </SidebarNav.Item>
          </SidebarNav.Section>
          <SidebarNav.Footer>
            <SidebarNav.Section>
              <SidebarNav.Item href="#docs" icon="help-circle">
                Docs
              </SidebarNav.Item>
            </SidebarNav.Section>
            <SidebarNav.FeatureCard
              title="API connected"
              onDismiss={() => undefined}
              actions={<Text size="sm" weight="semibold" color="tertiary">Actions slot</Text>}
            >
              Agents read this server through rds-mcp.
            </SidebarNav.FeatureCard>
            <SidebarNav.Account menu={<Menu.Item id="sign-out">Sign out</Menu.Item>}>{identity}</SidebarNav.Account>
          </SidebarNav.Footer>
        </SidebarNav>
      </div>
    )),
    ...bothThemes('_Nav item base · Current=False, State=Default (+ current page)', mode => (
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
    ...bothThemes('_Nav featured card · Type=Progress bar (no progress bar)', () => (
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
    ...bothThemes('_Nav account card · Type=Card, Open=True, Breakpoint=Desktop', () => (
      <div className="w-70 p-md">
        <SidebarNav.Account menu={<Menu.Item id="profile" icon="placeholder">View profile</Menu.Item>}>{identity}</SidebarNav.Account>
      </div>
    )),
  ],
} satisfies GalleryEntry;
