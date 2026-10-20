import { inBothThemes, type GalleryEntry } from '../primitives';
import { ButtonGroup } from '.';

export default {
  component: 'ButtonGroup',
  figma: 'Button group',
  examples: inBothThemes([
    {
      figma: 'Icon=False',
      render: () => (
        <ButtonGroup aria-label="Range" defaultSelectedKeys={['text-1']}>
          <ButtonGroup.Item id="text-1">Text</ButtonGroup.Item>
          <ButtonGroup.Item id="text-2">Text</ButtonGroup.Item>
          <ButtonGroup.Item id="text-3">Text</ButtonGroup.Item>
        </ButtonGroup>
      ),
    },
    {
      figma: '_Button group base · Current=False, State=Default (40px min height)', set: '_Button group base', variant: 'Current=False, State=Default (40px min height)',
      render: () => (
        <ButtonGroup aria-label="Single item">
          <ButtonGroup.Item id="text">Text</ButtonGroup.Item>
        </ButtonGroup>
      ),
    },
    {
      figma: '_Button group base · Current=True · State=Disabled', set: '_Button group base', variant: 'Current=True · State=Disabled',
      render: () => (
        <ButtonGroup aria-label="View" defaultSelectedKeys={['day']}>
          <ButtonGroup.Item id="day">Day</ButtonGroup.Item>
          <ButtonGroup.Item id="week">Week</ButtonGroup.Item>
          <ButtonGroup.Item id="month" isDisabled>
            Month
          </ButtonGroup.Item>
        </ButtonGroup>
      ),
    },
  ]),
} satisfies GalleryEntry;
