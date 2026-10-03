import { Button } from '../Button';
import { Menu } from '../Menu';
import { Icon, type GalleryEntry } from '../primitives';
import { SectionHeader } from './SectionHeader';

export default {
  component: 'SectionHeader',
  examples: [
    {
      figma: 'Custom Section header · Actions (Tertiary icon only)',
      render: () => (
        <SectionHeader>
          <SectionHeader.Title>Table</SectionHeader.Title>
          <SectionHeader.Actions>
            <Button size="md" hierarchy="tertiary" iconOnly iconLeading={<Icon name="placeholder" />}>
              More
            </Button>
          </SectionHeader.Actions>
        </SectionHeader>
      ),
    },
    {
      figma: 'Custom Section header · Supporting Content, Actions, Dropdown, Divider',
      render: () => (
        <SectionHeader divider>
          <SectionHeader.Title>Nodes</SectionHeader.Title>
          <SectionHeader.SupportingContent>Every node in this tree, with its latest status.</SectionHeader.SupportingContent>
          <SectionHeader.Actions>
            <Button size="md" hierarchy="tertiary" iconOnly iconLeading={<Icon name="search-lg" />}>
              Search
            </Button>
            <Button size="md" hierarchy="secondary">
              Export
            </Button>
            <Button size="md" hierarchy="primary">
              Add node
            </Button>
          </SectionHeader.Actions>
          <SectionHeader.Dropdown>
            <Menu label="Section options">
              <Menu.Item id="refresh">Refresh</Menu.Item>
            </Menu>
          </SectionHeader.Dropdown>
        </SectionHeader>
      ),
    },
  ],
} satisfies GalleryEntry;
