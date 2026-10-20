import { useSearchParams } from 'react-router';
import type { GalleryEntry } from '../components/primitives';
import { Stack, Surface, Text } from '../components/primitives';
import { useTheme, type Theme } from '../theme';
import { findGalleryTarget } from './galleryTargets';

const modules = import.meta.glob<{ default: GalleryEntry }>('/src/**/*.gallery.tsx', { eager: true });

/** Every gallery entry in the app, by component, each example labelled with its Figma name. */
export const galleryEntries: GalleryEntry[] = Object.values(modules)
  .map(m => m.default)
  .sort((a, b) => a.component.localeCompare(b.component));

/** `/ui/gallery` (dev builds only; `/ui/_gallery` too): every example. */
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

/** Freezes motion so a screenshot of the example is deterministic. */
const NO_MOTION = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';

const asTheme = (value: string | null): Theme | null => (value === 'light' || value === 'dark' ? value : null);

/**
 * One example alone, as the URL convention addresses it (docs/ui-portal.md "Gallery URLs"):
 * no gallery chrome, at its natural size, inside a `data-rds-target` wrapper. The theme is the
 * variant's `Color Mode`, else `theme`, else the portal's own (saved choice, else the OS).
 */
export function GalleryExamplePage({
  figma,
  variant,
  theme: requested = null,
  entries = galleryEntries,
}: {
  figma: string;
  variant: string;
  theme?: Theme | null;
  entries?: GalleryEntry[];
}) {
  const { theme: portalTheme } = useTheme();
  const match = findGalleryTarget(entries, { figma, variant, theme: requested ?? portalTheme });
  if (!match) {
    return (
      <main className="p-xl">
        <Stack gap="sm">
          <Text as="h1" size="lg" weight="semibold">
            404 — no gallery example
          </Text>
          <Text as="p" color="tertiary">
            Nothing in the gallery matches figma &ldquo;{figma}&rdquo; and variant &ldquo;{variant}&rdquo;.
          </Text>
        </Stack>
      </main>
    );
  }
  const { example } = match.target;
  return (
    <main>
      <style>{NO_MOTION}</style>
      <div data-rds-target="" data-theme={match.theme} className="w-fit bg-primary text-primary">
        {(example.renderAlone ?? example.render)()}
      </div>
    </main>
  );
}

/** `/ui/gallery`: the whole gallery, or with `?figma=<set>&variant=<variant>` that one example. */
export function GalleryRoute() {
  const [params] = useSearchParams();
  const figma = params.get('figma');
  if (figma === null) return <GalleryPage />;
  return <GalleryExamplePage figma={figma} variant={params.get('variant') ?? ''} theme={asTheme(params.get('theme'))} />;
}
