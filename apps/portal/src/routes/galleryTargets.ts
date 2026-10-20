import type { GalleryEntry, GalleryExample } from '../components/primitives';
import type { Theme } from '../theme';

/** A gallery example as the URL convention addresses it: Figma set + variant, and the theme it shows. */
export interface GalleryTarget {
  entry: GalleryEntry;
  example: GalleryExample;
  /** The Figma set (or component) name. */
  set: string;
  /** The variant string as written in the gallery, without its theme marker. */
  variant: string;
  /** The canonical variant (see `canonicalVariant`). */
  key: string;
  /** The theme the example is labelled with (`· Dark`, `Color Mode=…`); `null` for a theme-neutral example. */
  theme: Theme | null;
}

const squash = (text: string) => text.trim().replace(/\s+/g, ' ');

const COLOR_MODE = 'Color Mode';

const asTheme = (value: string | undefined | null): Theme | null => {
  const lower = value?.trim().toLowerCase();
  return lower === 'light' || lower === 'dark' ? lower : null;
};

/** `Size=sm, State=Hover` → its properties in order, or `null` when it isn't a Figma variant string. */
export function parseVariant(variant: string): Map<string, string> | null {
  const props = new Map<string, string>();
  for (const part of variant.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) return null;
    const name = squash(part.slice(0, eq));
    if (!name || props.has(name)) return null;
    props.set(name, squash(part.slice(eq + 1)));
  }
  return props;
}

/**
 * A variant string's canonical form: properties sorted by name with normalized spacing, so
 * `State=Hover,Size=sm` and `Size=sm, State=Hover` compare equal. `Color Mode` is a theme, not a
 * property: it is returned as `theme` and left out of `key`. Anything that isn't a variant string
 * (a plain label) only has its spacing normalized.
 */
export function canonicalVariant(variant: string): { key: string; theme: Theme | null } {
  const props = parseVariant(variant);
  if (!props) return { key: squash(variant).replace(/\s*([=,])\s*/g, '$1'), theme: null };
  const theme = asTheme(props.get(COLOR_MODE));
  if (theme) props.delete(COLOR_MODE);
  const key = [...props]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join(', ');
  return { key, theme };
}

const MODE_SUFFIX = / · Color Mode=(Light|Dark)$/;
const DARK_SUFFIX = ' · Dark';

/** The gallery label without the theme marker the gallery's theme helpers add, and that theme. */
function splitThemeMarker(label: string): { label: string; theme: Theme | null } {
  const mode = MODE_SUFFIX.exec(label);
  if (mode) return { label: label.slice(0, mode.index), theme: asTheme(mode[1]) };
  if (label.endsWith(DARK_SUFFIX)) return { label: label.slice(0, -DARK_SUFFIX.length), theme: 'dark' };
  return { label, theme: null };
}

/** Every example of `entries` with the set and variant its gallery URL uses. */
export function galleryTargets(entries: GalleryEntry[]): GalleryTarget[] {
  return entries.flatMap(entry =>
    entry.examples.map(example => {
      const marked = splitThemeMarker(example.figma);
      const variant = example.variant ?? marked.label;
      const canonical = canonicalVariant(variant);
      return {
        entry,
        example,
        set: squash(example.set ?? entry.figma ?? entry.component),
        variant,
        key: canonical.key,
        theme: marked.theme ?? canonical.theme,
      };
    }),
  );
}

export interface GalleryRequest {
  /** The Figma set or component name (`?figma=`). */
  figma: string;
  /** The Figma variant string (`?variant=`); empty for a component without variants. */
  variant: string;
  /** The theme to show it in when the variant has no `Color Mode`. */
  theme: Theme;
}

/**
 * The example a gallery URL addresses: the set must match exactly (spacing aside) and the variant
 * property for property, in any order. An empty variant addresses a set with a single example. Of
 * the theme copies of an example, the one labelled with the wanted theme wins, then a neutral one.
 */
export function findGalleryTarget(
  entries: GalleryEntry[],
  request: GalleryRequest,
): { target: GalleryTarget; theme: Theme } | null {
  const set = squash(request.figma);
  const wanted = canonicalVariant(request.variant);
  const theme = wanted.theme ?? request.theme;
  const inSet = galleryTargets(entries).filter(t => t.set === set);
  let candidates = inSet.filter(t => t.key === wanted.key);
  if (candidates.length === 0 && wanted.key === '' && new Set(inSet.map(t => t.key)).size === 1) candidates = inSet;
  const target = candidates.find(t => t.theme === theme) ?? candidates.find(t => t.theme === null) ?? candidates[0];
  return target ? { target, theme } : null;
}

/** The URL path + query of an example, relative to the portal (`/gallery?figma=…&variant=…`). */
export function galleryHref(target: Pick<GalleryTarget, 'set' | 'variant'>): string {
  return `/gallery?${new URLSearchParams({ figma: target.set, variant: target.variant }).toString()}`;
}
