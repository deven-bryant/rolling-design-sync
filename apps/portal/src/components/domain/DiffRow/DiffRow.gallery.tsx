import type { GalleryEntry, GalleryExample } from '../../primitives';
import { DiffRow, figmaDiffRow } from '.';


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
  component: 'DiffRow',
  figma: 'Diff row',
  examples: bothThemes([
    { figma: 'Diff row (Show raw=True)', render: () => <DiffRow {...figmaDiffRow.defaults} className="w-108" /> },
    {
      figma: 'Diff row (Show raw=False)',
      render: () => <DiffRow property="paddingLeft" category="layout" built="spacing-xl" now="spacing-3xl" className="w-108" />,
    },
  ]),
} satisfies GalleryEntry;
