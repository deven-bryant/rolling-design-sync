import { inBothThemes, type GalleryEntry } from '../primitives';
import { VerticalDivider } from '.';

export default {
  component: 'VerticalDivider',
  examples: inBothThemes([
    {
      figma: 'Vertical Divider',
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
