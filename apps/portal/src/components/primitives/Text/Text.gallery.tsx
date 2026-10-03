import type { GalleryEntry } from '../gallery';
import { Text } from './Text';

export default {
  component: 'Text',
  examples: [
    { figma: 'Text sm/Regular', render: () => <Text>The quick brown fox</Text> },
    { figma: 'Text sm/Regular · text-tertiary', render: () => <Text color="tertiary">The quick brown fox</Text> },
    { figma: 'Text sm/Semibold', render: () => <Text weight="semibold">The quick brown fox</Text> },
    { figma: 'Text md/Medium', render: () => <Text size="md" weight="medium">The quick brown fox</Text> },
    { figma: 'Text lg/Semibold', render: () => <Text size="lg" weight="semibold">The quick brown fox</Text> },
    { figma: 'Display xs/Semibold', render: () => <Text size="display-xs" weight="semibold">The quick brown fox</Text> },
    { figma: 'Display sm/Semibold', render: () => <Text size="display-sm" weight="semibold">The quick brown fox</Text> },
  ],
} satisfies GalleryEntry;
