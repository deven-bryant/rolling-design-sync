import type { GalleryEntry, GalleryExample } from '../../primitives';
import { StateBadge, stateBadgeColors, type NodeState } from '.';


const themes = [
  ['Light', undefined],
  ['Dark', 'dark'],
] as const;

/** Each example once per theme: `Color Mode` is the `data-theme` it renders under, never a prop. */
const bothThemes = (examples: { figma: string; render: (mode: string) => ReturnType<GalleryExample['render']> }[]) =>
  themes.flatMap(([mode, theme]) =>
    examples.map(({ figma, render }): GalleryExample => ({
      figma: `${figma} · Color Mode=${mode}`,
      render: () => (
        <div data-theme={theme} className="bg-primary">
          {render(mode)}
        </div>
      ),
    })),
  );

export default {
  component: 'StateBadge',
  examples: bothThemes((Object.keys(stateBadgeColors) as NodeState[]).map(state => ({
    figma: `Badge · Color=${stateBadgeColors[state]} (${state})`,
    render: () => <StateBadge state={state} />,
  }))),
} satisfies GalleryEntry;
