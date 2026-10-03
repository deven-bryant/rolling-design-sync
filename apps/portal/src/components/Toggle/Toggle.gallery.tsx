import type { GalleryEntry } from '../primitives';
import { Toggle } from './Toggle';
import { ToggleBase } from './ToggleBase';

export default {
  component: 'Toggle',
  examples: [
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
    { figma: '_Toggle base: Type=Default, Pressed=True, Size=sm, State=Default', render: () => <ToggleBase pressed /> },
  ],
} satisfies GalleryEntry;
