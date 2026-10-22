import { inBothThemes, type GalleryEntry } from '../../primitives';
import { KvBadge, KvBadgeList } from '.';

export default {
  component: 'KvBadge',
  figma: 'KV Badge',
  examples: inBothThemes([
    { figma: 'KV Badge', variant: '', render: () => <dl><KvBadge label="Checked" value="2h ago" /></dl> },
    {
      figma: 'Four KV badges between vertical dividers',
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
