import type { GalleryEntry } from '../gallery';
import { Surface } from './Surface';
import { Text } from '../Text';

export default {
  component: 'Surface',
  examples: [
    {
      figma: 'bg-primary · border-secondary · radius-xl · shadow-xs',
      render: () => (
        <Surface border="secondary" radius="xl" shadow="xs" padding="xl">
          <Text>Card surface</Text>
        </Surface>
      ),
    },
    {
      figma: 'bg-secondary · radius-md',
      render: () => (
        <Surface background="secondary" radius="md" padding="lg">
          <Text color="tertiary">Secondary surface</Text>
        </Surface>
      ),
    },
    {
      figma: 'bg-brand-solid · radius-md',
      render: () => (
        <Surface background="brand-solid" radius="md" padding="lg">
          <Text className="text-white">Brand surface</Text>
        </Surface>
      ),
    },
  ],
} satisfies GalleryEntry;
