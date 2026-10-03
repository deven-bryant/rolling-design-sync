import type { GalleryEntry } from '../gallery';
import { Icon } from '../Icon';
import { Text } from '../Text';
import { VisuallyHidden } from './VisuallyHidden';

export default {
  component: 'VisuallyHidden',
  examples: [
    {
      figma: 'Icon with a hidden label',
      render: () => (
        <Text as="span" color="tertiary" className="inline-flex items-center gap-xs">
          <Icon name="x-close" size="md" />
          <VisuallyHidden>Close</VisuallyHidden>
          <span aria-hidden="true">(label “Close” is visually hidden)</span>
        </Text>
      ),
    },
  ],
} satisfies GalleryEntry;
