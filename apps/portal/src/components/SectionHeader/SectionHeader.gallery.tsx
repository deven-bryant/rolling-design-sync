import { Button } from '../Button';
import { Menu } from '../Menu';
import { Icon, type GalleryEntry, type GalleryExample } from '../primitives';
import { SectionHeader } from './SectionHeader';


const themes = [
  ['Light', undefined],
  ['Dark', 'dark'],
] as const;

/** Each example once per theme: `Color Mode` is the `data-theme` it renders under, never a prop. */
const bothThemes = (examples: { figma: string; render: (mode: string) => ReturnType<GalleryExample['render']> }[]) =>
  themes.flatMap(([mode, theme]) =>
    examples.map(({ figma, render }): GalleryExample => ({
      figma: `${figma} · Color Mode=${mode}`,
      render: () => (
        <div data-theme={theme} className="bg-primary">
          {render(mode)}
        </div>
      ),
    })),
  );

export default {
  component: 'SectionHeader',
  examples: bothThemes([
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
  ]),
} satisfies GalleryEntry;
