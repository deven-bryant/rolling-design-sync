import type { GalleryEntry } from '../../primitives';
import { CategoryBadges } from '.';

export default {
  component: 'CategoryBadges',
  examples: [
    { figma: 'Badge · Color=Gray blue', render: () => <CategoryBadges categories={['color', 'layout']} /> },
    { figma: 'Badge · Color=Gray blue + Gray +N', render: () => <CategoryBadges categories={['color', 'layout', 'typography', 'effects']} max={2} /> },
  ],
} satisfies GalleryEntry;
