import { CloseButton } from '../Button';
import { inBothThemes, Text, type GalleryEntry } from '../primitives';
import { ToastCard } from '.';

export default {
  component: 'Toast',
  examples: inBothThemes([
    {
      figma: 'Tone=Success',
      render: () => (
        <ToastCard tone="success" close={<CloseButton size="sm" aria-label="Dismiss" />}>
          <Text weight="semibold" className="min-w-0 flex-1">
            Component key copied
          </Text>
        </ToastCard>
      ),
    },
    {
      figma: 'Tone=Error',
      render: () => (
        <ToastCard tone="error" close={<CloseButton size="sm" aria-label="Dismiss" />}>
          <Text weight="semibold" className="min-w-0 flex-1">
            Couldn’t save the file settings
          </Text>
        </ToastCard>
      ),
    },
  ]),
} satisfies GalleryEntry;
