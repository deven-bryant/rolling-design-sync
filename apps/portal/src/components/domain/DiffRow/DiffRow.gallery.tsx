import type { GalleryEntry } from '../../primitives';
import { DiffRow, figmaDiffRow } from '.';

export default {
  component: 'DiffRow',
  examples: [
    { figma: 'Diff row (Show raw=True)', render: () => <DiffRow {...figmaDiffRow.defaults} className="w-108" /> },
    {
      figma: 'Diff row (Show raw=False)',
      render: () => <DiffRow property="paddingLeft" category="layout" built="spacing-xl" now="spacing-3xl" className="w-108" />,
    },
  ],
} satisfies GalleryEntry;
