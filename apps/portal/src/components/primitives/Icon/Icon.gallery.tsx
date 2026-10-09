import { inBothThemes, type GalleryEntry } from '../gallery';
import { Icon } from './Icon';
import { iconNames } from './figma';

export default {
  component: 'Icon',
  examples: inBothThemes([
    ...iconNames.map(name => ({ figma: name, render: () => <Icon name={name} className="text-fg-secondary" /> })),
    {
      figma: 'Sizes (xs · sm · md · lg)',
      render: () => (
        <span className="flex items-center gap-md text-fg-secondary">
          <Icon name="placeholder" size="xs" />
          <Icon name="placeholder" size="sm" />
          <Icon name="placeholder" size="md" />
          <Icon name="placeholder" size="lg" />
        </span>
      ),
    },
  ]),
} satisfies GalleryEntry;
