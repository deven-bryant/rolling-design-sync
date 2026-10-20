import { inBothThemes, type GalleryEntry } from '../primitives';
import { Checkbox, RadioGroup, Radio } from './Checkbox';
import { CheckboxBase } from './CheckboxBase';

export default {
  component: 'Checkbox',
  examples: inBothThemes([
    {
      figma: 'Checked=False, Indeterminate=False, Size=md, Type=Checkbox, Text=False, State=Default',
      render: () => <Checkbox size="md" aria-label="Select row" />,
    },
    {
      figma: 'Size=md, Type=Checkbox · checked · indeterminate',
      render: () => (
        <span className="flex gap-lg">
          <Checkbox size="md" aria-label="Selected row" defaultSelected />
          <Checkbox size="md" aria-label="Select all rows" isIndeterminate />
        </span>
      ),
    },
    {
      figma: 'Checked=False · Checked=True, Size=sm, Type=Radio, Text=False, State=Default',
      render: () => (
        <RadioGroup aria-label="Workspace" defaultValue="design" className="flex gap-lg">
          <Radio value="design" aria-label="Design" />
          <Radio value="engineering" aria-label="Engineering" />
        </RadioGroup>
      ),
    },
    {
      figma: 'Size=sm, Type=Checkbox · Text · Supporting text',
      render: () => <Checkbox supportingText="Clear nodes once CI is green.">Auto-clear</Checkbox>,
    },
    {
      figma: '_Checkbox base: Checked=False, Size=sm, Type=Radio', set: '_Checkbox base', variant: 'Checked=False, Size=sm, Type=Radio',
      render: () => <CheckboxBase size="sm" type="radio" />,
    },
    {
      figma: '_Checkbox base: Checked=True, Size=sm, Type=Radio', set: '_Checkbox base', variant: 'Checked=True, Size=sm, Type=Radio',
      render: () => <CheckboxBase size="sm" type="radio" checked />,
    },
    {
      figma: '_Checkbox base: Checked=False, Size=md, Type=Checkbox', set: '_Checkbox base', variant: 'Checked=False, Size=md, Type=Checkbox',
      render: () => <CheckboxBase size="md" type="checkbox" />,
    },
  ]),
} satisfies GalleryEntry;
