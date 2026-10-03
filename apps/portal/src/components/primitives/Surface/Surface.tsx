import { createElement, type HTMLAttributes, type Ref } from 'react';
import { variants, type VariantProps } from '../variants';

export const surfaceStyles = variants({
  variants: {
    background: {
      none: '',
      primary: 'bg-primary',
      primary_alt: 'bg-primary_alt',
      secondary: 'bg-secondary',
      secondary_alt: 'bg-secondary_alt',
      tertiary: 'bg-tertiary',
      'brand-primary': 'bg-brand-primary',
      'brand-solid': 'bg-brand-solid',
    },
    border: { none: '', primary: 'border border-primary', secondary: 'border border-secondary' },
    radius: { none: '', xs: 'rounded-xs', sm: 'rounded-sm', md: 'rounded-md', lg: 'rounded-lg', xl: 'rounded-xl', '2xl': 'rounded-2xl' },
    shadow: { none: '', xs: 'shadow-xs', sm: 'shadow-sm', md: 'shadow-md', lg: 'shadow-lg', xl: 'shadow-xl' },
    padding: {
      none: '',
      xs: 'p-xs',
      sm: 'p-sm',
      md: 'p-md',
      lg: 'p-lg',
      xl: 'p-xl',
      '2xl': 'p-2xl',
      '3xl': 'p-3xl',
      '4xl': 'p-4xl',
    },
  },
  defaults: { background: 'primary', border: 'none', radius: 'none', shadow: 'none', padding: 'none' },
});

export type SurfaceElement = 'div' | 'section' | 'article' | 'aside' | 'header' | 'footer' | 'main' | 'nav';

export interface SurfaceProps extends HTMLAttributes<HTMLElement>, VariantProps<typeof surfaceStyles> {
  as?: SurfaceElement;
  ref?: Ref<HTMLElement>;
}

/** A box with token background, border, radius, shadow and padding — the base of cards, panels and the sidebar. */
export function Surface({ as = 'div', background, border, radius, shadow, padding, className, ref, ...rest }: SurfaceProps) {
  return createElement(as, { ref, className: surfaceStyles({ background, border, radius, shadow, padding, className }), ...rest });
}
