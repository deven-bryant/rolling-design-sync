import type { GalleryEntry, GalleryExample } from '../../primitives';
import { DiffRow, figmaDiffRow } from '.';


const themes = [
  ['Light', undefined],
  ['Dark', 'dark'],
] as const;

/** Each example once per theme: `Color Mode` is the `data-theme` it renders under, never a prop. */
const bothThemes = (examples: (Omit<GalleryExample, 'render'> & { render: (mode: string) => ReturnType<GalleryExample['render']> })[]) =>
  themes.flatMap(([mode, theme]) =>
    examples.map(({ figma, render, ...rest }): GalleryExample => ({
      ...rest,
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
    { figma: 'Diff row', variant: '', render: () => <DiffRow {...figmaDiffRow.defaults} raw="#FFFFFF → #F9FAFB" /> },
    {
      figma: 'Without the raw values',
      render: () => <DiffRow property="paddingLeft" category="layout" built="spacing-xl" now="spacing-3xl" className="w-108" />,
    },
  ]),
} satisfies GalleryEntry;
