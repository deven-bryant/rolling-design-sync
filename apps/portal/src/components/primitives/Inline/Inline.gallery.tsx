import type { GalleryEntry } from '../gallery';
import { Inline } from './Inline';

const Box = () => <span className="block size-xl rounded-xs bg-utility-indigo-200" />;

export default {
  component: 'Inline',
  examples: (['xs', 'md', 'xl', '3xl'] as const).map(gap => ({
    figma: `spacing-${gap}`,
    render: () => (
      <Inline gap={gap}>
        <Box />
        <Box />
        <Box />
      </Inline>
    ),
  })),
} satisfies GalleryEntry;
