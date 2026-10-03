import type { GalleryEntry } from '../../primitives';
import { StateBadge, stateBadgeColors, type NodeState } from '.';

export default {
  component: 'StateBadge',
  examples: (Object.keys(stateBadgeColors) as NodeState[]).map(state => ({
    figma: `Badge · Color=${stateBadgeColors[state]} (${state})`,
    render: () => <StateBadge state={state} />,
  })),
} satisfies GalleryEntry;
