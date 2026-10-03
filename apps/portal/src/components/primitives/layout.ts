import { variants } from './variants';

const gap = {
  none: 'gap-none',
  xxs: 'gap-xxs',
  xs: 'gap-xs',
  sm: 'gap-sm',
  md: 'gap-md',
  lg: 'gap-lg',
  xl: 'gap-xl',
  '2xl': 'gap-2xl',
  '3xl': 'gap-3xl',
  '4xl': 'gap-4xl',
} as const;

export type Gap = keyof typeof gap;

/** Flex layout shared by Stack (column) and Inline (row). */
export const flexStyles = variants({
  base: 'flex min-w-0',
  variants: {
    direction: { column: 'flex-col', row: 'flex-row' },
    gap,
    align: { start: 'items-start', center: 'items-center', end: 'items-end', stretch: 'items-stretch', baseline: 'items-baseline' },
    justify: { start: 'justify-start', center: 'justify-center', end: 'justify-end', between: 'justify-between' },
    wrap: { true: 'flex-wrap', false: '' },
  },
  defaults: { gap: 'none' },
});

export type FlexElement = 'div' | 'section' | 'header' | 'footer' | 'nav' | 'main' | 'aside' | 'ul' | 'ol' | 'li' | 'form' | 'span';
