import { inBothThemes, type GalleryEntry } from '../primitives';
import { Toggle } from './Toggle';
import { ToggleBase } from './ToggleBase';

export default {
  component: 'Toggle',
  examples: inBothThemes([
    {
      figma: 'Type=Default, Pressed=True, Size=sm, Text=True, State=Default',
      render: () => (
        <Toggle defaultSelected supportingText="Clear nodes once CI is green.">
          Auto-clear
        </Toggle>
      ),
    },
    { figma: 'Pressed=False · Text', render: () => <Toggle>Auto-clear</Toggle> },
    { figma: 'Pressed=True · no text', render: () => <Toggle defaultSelected aria-label="Live updates" /> },
    {
      figma: 'Type=Default, Pressed=False, Size=md, Text=False, State=Default',
      render: () => <Toggle size="md" aria-label="Dark mode" />,
    },
    {
      figma: 'Type=Default, Pressed=True, Size=md, Text=False, State=Default',
      render: () => <Toggle size="md" defaultSelected aria-label="Dark mode" />,
    },
    { figma: '_Toggle base: Type=Default, Pressed=True, Size=sm, State=Default', render: () => <ToggleBase pressed /> },
    { figma: '_Toggle base: Type=Default, Pressed=False, Size=md, State=Default', render: () => <ToggleBase size="md" /> },
    {
      figma: '_Toggle base: Type=Default, Pressed=True, Size=md, State=Default',
      render: () => <ToggleBase size="md" pressed />,
    },
  ]),
} satisfies GalleryEntry;
