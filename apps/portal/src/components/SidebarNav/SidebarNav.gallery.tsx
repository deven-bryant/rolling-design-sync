import { Menu } from '../Menu';
import type { GalleryEntry } from '../primitives';
import { Text } from '../primitives';
import { SidebarNav } from './SidebarNav';

const identity = (
  <span className="flex flex-col">
    <Text size="sm" weight="semibold" color="secondary">
      Olivia Rhye
    </Text>
    <Text size="sm" color="tertiary">
      olivia@untitledui.com
    </Text>
  </span>
);

export default {
  component: 'SidebarNav',
  examples: [
    {
      figma: 'Open=False, Style=Simple, Breakpoint=Desktop',
      render: () => (
        <div className="flex h-240">
          <SidebarNav>
            <SidebarNav.Header>
              <Text size="lg" weight="semibold">
                Logo slot
              </Text>
              <SidebarNav.Search>
                <Text size="md" color="placeholder">
                  Search slot
                </Text>
              </SidebarNav.Search>
            </SidebarNav.Header>
            <SidebarNav.Section>
              <SidebarNav.Item icon="home-line" items={<SidebarNav.Item href="#overview">Overview</SidebarNav.Item>}>
                Home
              </SidebarNav.Item>
              <SidebarNav.Item icon="bar-chart-square-02" items={<SidebarNav.Item href="#reports">Reports</SidebarNav.Item>}>
                Dashboard
              </SidebarNav.Item>
            </SidebarNav.Section>
            <SidebarNav.Footer>
              <SidebarNav.Section>
                <SidebarNav.Item href="#support" icon="help-circle">
                  Support
                </SidebarNav.Item>
              </SidebarNav.Section>
              <SidebarNav.FeatureCard title="Used space" onDismiss={() => undefined}>
                Your team has used 80% of your available space. Need more?
              </SidebarNav.FeatureCard>
              <SidebarNav.Account menu={<Menu.Item id="sign-out">Sign out</Menu.Item>}>{identity}</SidebarNav.Account>
            </SidebarNav.Footer>
          </SidebarNav>
        </div>
      ),
    },
    {
      figma: '_Nav item base · Current=False, State=Default (+ current page)',
      render: () => (
        <SidebarNav aria-label="Nav items" className="h-auto pt-none">
          <SidebarNav.Section>
            <SidebarNav.Item href="#dashboard" icon="bar-chart-square-02">
              Dashboard
            </SidebarNav.Item>
            <SidebarNav.Item href="#inbox" icon="mail-01" current badge={<Text size="xs">10</Text>}>
              Inbox
            </SidebarNav.Item>
          </SidebarNav.Section>
        </SidebarNav>
      ),
    },
    {
      figma: '_Nav item dropdown base · Open=False, Current=False',
      render: () => (
        <SidebarNav aria-label="Dropdown items" className="h-auto pt-none">
          <SidebarNav.Section>
            <SidebarNav.Item icon="home-line" items={<SidebarNav.Item href="#overview">Overview</SidebarNav.Item>}>
              Home
            </SidebarNav.Item>
          </SidebarNav.Section>
        </SidebarNav>
      ),
    },
    {
      figma: '_Nav featured card · Type=Progress bar',
      render: () => (
        <div className="w-68">
          <SidebarNav.FeatureCard
            title="Used space"
            onDismiss={() => undefined}
            progress={<Text size="xs" color="tertiary">Progress bar slot</Text>}
            actions={<Text size="sm" weight="semibold" color="tertiary">Dismiss</Text>}
          >
            Your team has used 80% of your available space. Need more?
          </SidebarNav.FeatureCard>
        </div>
      ),
    },
    {
      figma: '_Nav account card · Type=Card, Open=True, Breakpoint=Desktop',
      render: () => (
        <div className="w-70">
          <SidebarNav.Account menu={<Menu.Item id="profile" icon="placeholder">View profile</Menu.Item>}>{identity}</SidebarNav.Account>
        </div>
      ),
    },
  ],
} satisfies GalleryEntry;
