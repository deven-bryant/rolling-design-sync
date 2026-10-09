import { Button } from 'react-aria-components';
import { inBothThemes, type GalleryEntry } from '../primitives';
import { Tooltip, TooltipTrigger } from '.';

export default {
  component: 'Tooltip',
  examples: inBothThemes([
    {
      figma: 'Supporting text=False, Arrow=None',
      render: () => (
        <TooltipTrigger defaultOpen>
          <Button className="rounded-sm text-sm text-tertiary outline-focus-ring data-focus-visible:outline-2">Hover or focus me</Button>
          <Tooltip>This is a tooltip</Tooltip>
        </TooltipTrigger>
      ),
    },
  ]),
} satisfies GalleryEntry;
