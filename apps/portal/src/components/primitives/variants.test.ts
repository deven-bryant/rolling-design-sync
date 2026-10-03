import { describe, expect, it } from 'vitest';
import { cx } from './cx';
import { variants, type VariantProps } from './variants';

describe('cx', () => {
  it('joins classes and drops falsy values', () => {
    expect(cx('a', false, null, undefined, 'b')).toBe('a b');
  });

  it('lets later token utilities win over conflicting earlier ones', () => {
    expect(cx('p-md', 'p-xl')).toBe('p-xl');
    expect(cx('gap-xxs', 'gap-4xl')).toBe('gap-4xl');
    expect(cx('rounded-md', 'rounded-xl')).toBe('rounded-xl');
    expect(cx('bg-primary', 'bg-secondary')).toBe('bg-secondary');
    expect(cx('font-regular', 'font-semibold')).toBe('font-semibold');
  });

  it('keeps size and color utilities that share a prefix', () => {
    expect(cx('text-sm', 'text-tertiary')).toBe('text-sm text-tertiary');
    expect(cx('text-md', 'text-display-xs')).toBe('text-display-xs');
  });
});

describe('variants', () => {
  const button = variants({
    base: 'inline-flex',
    variants: {
      size: { sm: 'px-md', md: 'px-lg' },
      hierarchy: { primary: 'bg-brand-solid', secondary: 'bg-primary' },
      iconOnly: { true: 'aspect-square', false: '' },
    },
    defaults: { size: 'md', hierarchy: 'primary', iconOnly: false },
    compound: [{ size: 'sm', hierarchy: 'secondary', className: 'shadow-xs' }],
  });

  it('applies base and default classes', () => {
    expect(button()).toBe('inline-flex px-lg bg-brand-solid');
  });

  it('applies the selected variants and boolean axes', () => {
    expect(button({ size: 'sm', iconOnly: true })).toBe('inline-flex px-md bg-brand-solid aspect-square');
  });

  it('applies compound classes only when every axis matches', () => {
    expect(button({ size: 'sm', hierarchy: 'secondary' })).toBe('inline-flex px-md bg-primary shadow-xs');
    expect(button({ size: 'md', hierarchy: 'secondary' })).toBe('inline-flex px-lg bg-primary');
  });

  it('merges className last', () => {
    expect(button({ className: 'px-xl w-full' })).toBe('inline-flex bg-brand-solid px-xl w-full');
  });

  it('exposes typed props', () => {
    const props: VariantProps<typeof button> = { size: 'sm', iconOnly: true };
    // @ts-expect-error not a size
    const wrong: VariantProps<typeof button> = { size: 'xl' };
    expect(button(props)).toContain('px-md');
    expect(wrong).toBeDefined();
    expect(Object.keys(button.variants)).toEqual(['size', 'hierarchy', 'iconOnly']);
  });
});
