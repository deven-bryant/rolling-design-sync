import type { GalleryEntry } from '../components/primitives';
import { Stack, Surface, Text } from '../components/primitives';

const modules = import.meta.glob<{ default: GalleryEntry }>('/src/**/*.gallery.tsx', { eager: true });

/** Every gallery entry in the app, by component, each example labelled with its Figma name. */
export const galleryEntries: GalleryEntry[] = Object.values(modules)
  .map(m => m.default)
  .sort((a, b) => a.component.localeCompare(b.component));

/** `/ui/_gallery` (dev builds only). */
export function GalleryPage({ entries = galleryEntries }: { entries?: GalleryEntry[] }) {
  return (
    <main className="min-h-screen bg-secondary px-4xl py-3xl">
      <Stack gap="3xl">
        <Text as="h1" size="display-xs" weight="semibold">
          Component gallery
        </Text>
        {entries.map(entry => (
          <Stack as="section" key={entry.component} gap="lg" aria-labelledby={`gallery-${entry.component}`}>
            <Text as="h2" size="lg" weight="semibold" id={`gallery-${entry.component}`}>
              {entry.component}
            </Text>
            <Surface border="secondary" radius="xl" className="overflow-hidden">
              <dl className="grid grid-cols-[minmax(160px,280px)_1fr]">
                {entry.examples.map(example => (
                  <div key={example.figma} className="col-span-2 grid grid-cols-subgrid border-b border-secondary last:border-b-0">
                    <dt className="px-xl py-lg">
                      <Text as="code" size="xs" color="tertiary" className="font-mono">
                        {example.figma}
                      </Text>
                    </dt>
                    <dd className="px-xl py-lg">{example.render()}</dd>
                  </div>
                ))}
              </dl>
            </Surface>
          </Stack>
        ))}
      </Stack>
    </main>
  );
}
