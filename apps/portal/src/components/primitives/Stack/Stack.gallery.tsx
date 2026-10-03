import type { GalleryEntry } from '../gallery';
import { Stack } from './Stack';

const Box = () => <span className="block h-xl w-4xl rounded-xs bg-utility-brand-200" />;

export default {
  component: 'Stack',
  examples: (['xs', 'md', 'xl', '3xl'] as const).map(gap => ({
    figma: `spacing-${gap}`,
    render: () => (
      <Stack gap={gap}>
        <Box />
        <Box />
        <Box />
      </Stack>
    ),
  })),
} satisfies GalleryEntry;
