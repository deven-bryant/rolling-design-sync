import { inBothThemes, type GalleryEntry } from '../../primitives';
import { KvBadge, KvBadgeList } from '.';

export default {
  component: 'KvBadge',
  examples: inBothThemes([
    { figma: 'KV Badge', render: () => <dl><KvBadge label="Checked" value="2h ago" /></dl> },
    {
      figma: 'KV Badge × 4 · Vertical Divider',
      render: () => (
        <KvBadgeList
          items={[
            { label: 'Checked', value: '2h ago' },
            { label: 'Commit', value: '4b11b44' },
            { label: 'Source', value: 'ci-playwright' },
            { label: 'Limit', value: '1%' },
          ]}
        />
      ),
    },
  ]),
} satisfies GalleryEntry;
