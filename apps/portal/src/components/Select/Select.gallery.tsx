import { inBothThemes, type GalleryEntry } from '../primitives';
import { Icon } from '../primitives';
import { Select } from './Select';
import { SelectSearch } from './SelectSearch';

const team = [
  { id: 'olivia', name: 'Olivia Rhye', handle: '@olivia' },
  { id: 'phoenix', name: 'Phoenix Baker', handle: '@phoenix' },
  { id: 'lana', name: 'Lana Steiner', handle: '@lana' },
];

export default {
  component: 'Select',
  examples: inBothThemes([
    {
      figma: 'Size=sm, Type=Default, State=Default',
      render: () => (
        <Select
          label="Team member"
          required
          tooltip="Who owns the claim."
          hint="This is a hint text to help user."
          items={team}
          defaultSelectedKey="olivia"
          className="max-w-xs"
        >
          {item => <Select.Item supportingText={item.handle}>{item.name}</Select.Item>}
        </Select>
      ),
    },
    {
      figma: 'Type=Default, State=Placeholder · Icon leading',
      render: () => (
        <Select label="Status" placeholder="Select status" iconLeading={<Icon name="placeholder" size="md" />} className="max-w-xs">
          <Select.Item id="open">Open</Select.Item>
          <Select.Item id="claimed">Claimed</Select.Item>
          <Select.Item id="cleared">Cleared</Select.Item>
        </Select>
      ),
    },
    {
      figma: 'Type=Default, State=Disabled',
      render: () => (
        <Select aria-label="Locked status" isDisabled defaultSelectedKey="open" className="max-w-xs">
          <Select.Item id="open">Open</Select.Item>
        </Select>
      ),
    },
    {
      figma: 'Size=sm, Type=Search, State=Placeholder',
      render: () => (
        <SelectSearch
          label="Search"
          required
          tooltip="Filter by name."
          hint="This is a hint text to help user."
          shortcut="⌘K"
          placeholder="Search"
          items={team}
          className="max-w-xs"
        >
          {item => <Select.Item supportingText={item.handle}>{item.name}</Select.Item>}
        </SelectSearch>
      ),
    },
  ]),
} satisfies GalleryEntry;
