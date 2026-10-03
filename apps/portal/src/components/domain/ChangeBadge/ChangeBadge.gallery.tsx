import type { GalleryEntry } from '../../primitives';
import { ChangeBadge, changeBadgeColors, type ChangeType } from '.';

export default {
  component: 'ChangeBadge',
  examples: (Object.keys(changeBadgeColors) as ChangeType[]).map(change => ({
    figma: `Badge · Color=${changeBadgeColors[change]} (${change})`,
    render: () => <ChangeBadge change={change} />,
  })),
} satisfies GalleryEntry;
