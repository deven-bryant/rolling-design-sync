import type { GalleryEntry, GalleryExample } from '../../primitives';
import { CategoryBadges } from '.';


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
  component: 'CategoryBadges',
  examples: bothThemes([
    { figma: 'Badge · Color=Gray blue', render: () => <CategoryBadges categories={['color', 'layout']} /> },
    { figma: 'Badge · Color=Gray blue + Gray +N', render: () => <CategoryBadges categories={['color', 'layout', 'typography', 'effects']} max={2} /> },
  ]),
} satisfies GalleryEntry;
