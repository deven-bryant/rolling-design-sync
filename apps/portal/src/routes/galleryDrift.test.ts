import { describe, expect, it } from 'vitest';
import { galleryEntries } from './GalleryPage';
import { canonicalVariant, galleryTargets } from './galleryTargets';

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const nameOf = (value: unknown) => (typeof value === 'string' ? value : isObject(value) && typeof value.name === 'string' ? value.name : null);

/** Mapped sets that aren't render targets in the Portal file, so they need no gallery example. */
const NOT_TARGETS = new Set([
  // Slot components: placeholders other components fill.
  'Main',
  'Custom Section header',
  // A layer inside `Node Details - Note Section`, not a component.
  'Node Details - Note Section / Screenshots (Preview Target Note Reference)',
  // Untitled UI library parts outside the Portal file's synced scopes.
  '_Avatar online indicator',
  '_Breadcrumb button base',
  '_Button group base',
  '_Dropdown menu item',
  '_Feed item base',
  '_Nav account card',
  '_Nav featured card',
  '_Nav item base',
  '_Nav item dropdown base',
  '_Pagination number base',
  '_Slide out menu header',
  '_Tab button base',
  '_Table header label',
  'Activity feed',
  'File type icon',
  'Sidebar navigation',
  'Table cell',
  'Table cell lead action',
  'Table header cell',
]);

/** Library variants outside the synced scopes in sets the gallery otherwise covers. */
const NOT_TARGET_VARIANTS = new Set(['Buttons/Button|Size=md, Hierarchy=Link color, State=Default, Icon only=False']);

/** The variant strings a mapping lists: its `variants` (names or keys), else a one-axis set's `axes`, else '' (a standalone component). */
function variantsOf(mapping: Json): string[] {
  const { variants, axes } = mapping;
  if (Array.isArray(variants)) return variants.map(nameOf).filter((name): name is string => name !== null);
  if (isObject(variants)) return Object.keys(variants).map(key => (key.includes('=') ? key : `Property 1=${key}`));
  if (isObject(axes)) {
    const [axis, ...more] = Object.entries(axes);
    if (axis && !more.length && isObject(axis[1])) return Object.keys(axis[1]).map(value => `${axis[0]}=${value}`);
  }
  return [''];
}

const MAPPING_KEYS = ['componentSet', 'component', 'sets', 'axes', 'variants'];

/** Every (set, variant) a `figma.ts` export names, across the mapping shapes in use. */
function mappedTargets(mapping: Json): { set: string; variant: string }[] {
  const set = nameOf(mapping.componentSet) ?? (isObject(mapping.component) ? nameOf(mapping.component) : null);
  const own = set ? variantsOf(mapping).map(variant => ({ set, variant })) : [];
  const sets = Array.isArray(mapping.sets)
    ? mapping.sets.filter(isObject).flatMap(s => variantsOf(s).map(variant => ({ set: String(s.name), variant })))
    : [];
  const nested = Object.entries(mapping).flatMap(([key, value]) => {
    if (MAPPING_KEYS.includes(key) || !isObject(value)) return [];
    // `header` / `composition`: a standalone component the set's examples place.
    if ((key === 'header' || key === 'composition') && typeof value.name === 'string') return [{ set: value.name, variant: '' }];
    if (isObject(value.component)) return mappedTargets(value);
    // `{ 'Set name': { setId, variants } }`
    if (value.setId) return mappedTargets({ ...value, componentSet: key });
    return [];
  });
  return [...own, ...sets, ...nested];
}

const modules = import.meta.glob<Json>('/src/**/figma.ts', { eager: true });
const mapped = Object.entries(modules).flatMap(([file, exports]) =>
  Object.values(exports)
    .filter(isObject)
    .flatMap(mapping => mappedTargets(mapping).map(target => ({ file, ...target }))),
);

const claim = (set: string, variant: string) => `${set} | ${canonicalVariant(variant).key}`;

describe('gallery ↔ figma.ts drift', () => {
  const targets = galleryTargets(galleryEntries);

  it('reads the figma.ts mappings', () => {
    expect(mapped.length).toBeGreaterThan(50);
    expect(mapped).toContainEqual(expect.objectContaining({ set: 'Node Details - Claim Holder', variant: 'Property 1=Claimed' }));
    expect(mapped).toContainEqual(expect.objectContaining({ set: 'KV Badge', variant: '' }));
  });

  it('has a gallery example for every Figma variant a figma.ts mapping lists', () => {
    const claimed = new Set(targets.map(t => claim(t.set, t.variant)));
    const missing = mapped
      .filter(m => !NOT_TARGETS.has(m.set) && !NOT_TARGET_VARIANTS.has(`${m.set}|${m.variant}`))
      .filter(m => !claimed.has(claim(m.set, m.variant)))
      .map(m => `${m.file}: ${m.set} | ${m.variant}`);
    expect(missing).toEqual([]);
  });

  it('never has two examples claim the same set + variant (per theme)', () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const t of targets) {
      const key = `${claim(t.set, t.variant)} | ${t.theme ?? 'any'}`;
      const where = `${t.entry.component}: ${t.example.figma}`;
      const first = seen.get(key);
      if (first) duplicates.push(`${key} — ${first} · ${where}`);
      else seen.set(key, where);
    }
    expect(duplicates).toEqual([]);
  });

  it('leaves slot components out of the mapping', () => {
    expect(targets.filter(t => t.set === 'Main' || t.set === 'Custom Section header').map(t => t.variant)).toEqual([]);
  });
});
