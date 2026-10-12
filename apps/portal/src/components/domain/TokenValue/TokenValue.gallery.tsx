import type { GalleryEntry, GalleryExample } from '../../primitives';
import { figmaTokenValue, TokenValue } from '.';

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
  component: 'TokenValue',
  examples: bothThemes([
    { figma: 'Token value (color)', render: () => <TokenValue {...figmaTokenValue.defaults} /> },
    { figma: 'Token value (white)', render: () => <TokenValue swatch="#FFFFFF">#FFFFFF</TokenValue> },
    { figma: 'Token value (number)', render: () => <TokenValue>16</TokenValue> },
    { figma: 'Token value (alias)', render: () => <TokenValue>gray-800</TokenValue> },
  ]),
} satisfies GalleryEntry;
