import { inBothThemes, type GalleryEntry } from '../primitives';
import { VerticalDivider } from '.';

export default {
  component: 'VerticalDivider',
  figma: 'Vertical Divider',
  examples: inBothThemes([
    {
      figma: 'Vertical Divider',
      variant: '',
      render: () => (
        <div className="flex items-center gap-md text-sm text-tertiary">
          <span>Checked</span>
          <VerticalDivider />
          <span>Commit</span>
        </div>
      ),
    },
  ]),
} satisfies GalleryEntry;
