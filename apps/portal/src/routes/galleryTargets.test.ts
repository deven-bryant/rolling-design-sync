import { describe, expect, it } from 'vitest';
import type { GalleryEntry } from '../components/primitives';
import { galleryEntries } from './GalleryPage';
import { canonicalVariant, findGalleryTarget, galleryHref, galleryTargets, parseVariant } from './galleryTargets';

const example = (figma: string, extra: object = {}) => ({ figma, render: () => figma, ...extra });

const entries: GalleryEntry[] = [
  {
    component: 'Button',
    figma: 'Buttons/Button',
    examples: [
      example('Size=sm, Hierarchy=Primary, State=Default'),
      example('Size=md, Hierarchy=Primary, State=Default'),
      example('Size=sm, Hierarchy=Primary, State=Default · Dark'),
    ],
  },
  {
    component: 'Breadcrumbs',
    examples: [example('Divider=Chevron, Type=Button · Color Mode=Light'), example('Divider=Chevron, Type=Button · Color Mode=Dark')],
  },
  { component: 'VerticalDivider', figma: 'Vertical Divider', examples: [example('Vertical Divider')] },
  { component: 'Badge', examples: [example('_Dot · Size=md, Outline=False', { set: '_Dot', variant: 'Size=md, Outline=False' })] },
];

const find = (figma: string, variant: string, theme: 'light' | 'dark' = 'light') =>
  findGalleryTarget(entries, { figma, variant, theme });

describe('parseVariant / canonicalVariant', () => {
  it('reads a Figma variant string, and nothing else', () => {
    expect(parseVariant('Size=sm, State=Hover')).toEqual(new Map([['Size', 'sm'], ['State', 'Hover']]));
    expect(parseVariant('Vertical Divider')).toBeNull();
    expect(parseVariant('Size=sm, Size=md')).toBeNull();
  });

  it('ignores property order and spacing', () => {
    const { key } = canonicalVariant('Size=sm, State=Hover');
    expect(canonicalVariant('State=Hover,Size=sm').key).toBe(key);
    expect(canonicalVariant('  State =  Hover ,  Size= sm ').key).toBe(key);
    expect(canonicalVariant('Size=sm, State=Default').key).not.toBe(key);
  });

  it('treats Color Mode as the theme, not a property', () => {
    expect(canonicalVariant('Color Mode=Dark, Size=sm')).toEqual({ key: 'Size=sm', theme: 'dark' });
    expect(canonicalVariant('Size=sm')).toEqual({ key: 'Size=sm', theme: null });
  });
});

describe('findGalleryTarget', () => {
  it('matches the set exactly and the variant in any order', () => {
    expect(find('Buttons/Button', 'State=Default, Hierarchy=Primary, Size=md')?.target.example.figma).toBe(
      'Size=md, Hierarchy=Primary, State=Default',
    );
    expect(find(' Buttons/Button ', 'Size=sm,Hierarchy=Primary,State=Default')?.target.example.figma).toBe(
      'Size=sm, Hierarchy=Primary, State=Default',
    );
    expect(find('Button', 'Size=md, Hierarchy=Primary, State=Default')).toBeNull();
    expect(find('buttons/button', 'Size=md, Hierarchy=Primary, State=Default')).toBeNull();
    expect(find('Buttons/Button', 'Size=md, Hierarchy=Primary')).toBeNull();
    expect(find('Buttons/Button', 'Size=lg, Hierarchy=Primary, State=Default')).toBeNull();
  });

  it('picks the copy for the theme', () => {
    expect(find('Buttons/Button', 'Size=sm, Hierarchy=Primary, State=Default')?.target.example.figma).toBe(
      'Size=sm, Hierarchy=Primary, State=Default',
    );
    const dark = find('Buttons/Button', 'Size=sm, Hierarchy=Primary, State=Default', 'dark');
    expect(dark?.target.example.figma).toBe('Size=sm, Hierarchy=Primary, State=Default · Dark');
    expect(dark?.theme).toBe('dark');
    // Without a dark copy, the neutral example is shown under the dark theme.
    expect(find('Buttons/Button', 'Size=md, Hierarchy=Primary, State=Default', 'dark')).toMatchObject({ theme: 'dark' });
    // `Color Mode` in the variant wins over the theme asked for.
    const mode = find('Breadcrumbs', 'Type=Button, Color Mode=Dark, Divider=Chevron', 'light');
    expect(mode?.target.example.figma).toBe('Divider=Chevron, Type=Button · Color Mode=Dark');
    expect(mode?.theme).toBe('dark');
  });

  it('addresses a component without variants by its name alone', () => {
    expect(find('Vertical Divider', '')?.target.example.figma).toBe('Vertical Divider');
    expect(find('Vertical Divider', 'Vertical Divider')?.target.example.figma).toBe('Vertical Divider');
    expect(find('Buttons/Button', '')).toBeNull();
  });

  it('uses an example’s own set and variant', () => {
    expect(find('_Dot', 'Outline=False, Size=md')?.target.example.figma).toBe('_Dot · Size=md, Outline=False');
    expect(find('Badge', '_Dot · Size=md, Outline=False')).toBeNull();
  });

  it('builds the URL of an example', () => {
    expect(galleryHref({ set: 'Buttons/Button', variant: 'Size=sm, State=Hover' })).toBe(
      '/_gallery?figma=Buttons%2FButton&variant=Size%3Dsm%2C+State%3DHover',
    );
  });
});

describe('the gallery', () => {
  // Every example has its own URL: its set + variant (+ theme) lead back to it and nothing else.
  it('reaches every example at its own URL', () => {
    const unreachable = galleryTargets(galleryEntries)
      .filter(t => {
        const found = findGalleryTarget(galleryEntries, { figma: t.set, variant: t.variant, theme: t.theme ?? 'light' });
        return found?.target.example !== t.example;
      })
      .map(t => `${t.entry.component}: ${t.example.figma}`);
    expect(unreachable).toEqual([]);
  });
});
