import { inBothThemes, type GalleryEntry } from '../primitives';
import { Menu } from './Menu';

export default {
  component: 'Menu',
  examples: inBothThemes([
    {
      figma: 'Dropdown · Type=Icon, Open=False',
      render: () => (
        <Menu label="Card actions">
          <Menu.Item id="view">View</Menu.Item>
          <Menu.Item id="edit">Edit</Menu.Item>
        </Menu>
      ),
    },
    {
      figma: '_Dropdown menu item · Type=Menu item / Type=Account, Current=False / Current=True',
      render: () => (
        <Menu label="Account" selectionMode="single" defaultSelectedKeys={['olivia']}>
          <Menu.Section aria-label="Actions">
            <Menu.Item id="profile" icon="placeholder" shortcut="⌘K->P">
              View profile
            </Menu.Item>
            <Menu.Item id="settings" icon="placeholder" shortcut="⌘S">
              Account settings
            </Menu.Item>
          </Menu.Section>
          <Menu.Separator />
          <Menu.Section title="Switch account">
            <Menu.Item id="olivia" type="account">
              Olivia Rhye
            </Menu.Item>
            <Menu.Item id="sienna" type="account">
              Sienna Hewitt
            </Menu.Item>
          </Menu.Section>
        </Menu>
      ),
    },
  ]),
} satisfies GalleryEntry;
