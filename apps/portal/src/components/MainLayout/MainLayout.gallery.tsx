import type { GalleryEntry, GalleryExample } from '../primitives';
import { MainLayout } from './MainLayout';

const Block = ({ label }: { label: string }) => (
  <span className="block rounded-xs bg-utility-brand-200 px-md py-xs text-xs text-secondary">{label}</span>
);


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
  component: 'MainLayout',
  examples: bothThemes([
    {
      figma: 'Main · Slot',
      render: () => (
        <MainLayout as="div" className="border border-dashed border-secondary">
          <Block label="Page header" />
          <Block label="Horizontal tabs" />
          <Block label="Filters" />
          <Block label="Table card" />
        </MainLayout>
      ),
    },
  ]),
} satisfies GalleryEntry;
