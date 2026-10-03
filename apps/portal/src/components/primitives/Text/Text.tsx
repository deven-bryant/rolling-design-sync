import { createElement, type HTMLAttributes, type Ref } from 'react';
import { variants, type VariantProps } from '../variants';

export const textStyles = variants({
  variants: {
    size: {
      xs: 'text-xs',
      sm: 'text-sm',
      md: 'text-md',
      lg: 'text-lg',
      xl: 'text-xl',
      'display-xs': 'text-display-xs',
      'display-sm': 'text-display-sm',
      'display-md': 'text-display-md',
      'display-lg': 'text-display-lg',
      'display-xl': 'text-display-xl',
      'display-2xl': 'text-display-2xl',
    },
    weight: { regular: 'font-regular', medium: 'font-medium', semibold: 'font-semibold', bold: 'font-bold' },
    color: {
      primary: 'text-primary',
      secondary: 'text-secondary',
      tertiary: 'text-tertiary',
      quaternary: 'text-quaternary',
      placeholder: 'text-placeholder',
      disabled: 'text-disabled',
      'brand-primary': 'text-brand-primary',
      'brand-secondary': 'text-brand-secondary',
      'brand-tertiary': 'text-brand-tertiary',
      'error-primary': 'text-error-primary',
      'warning-primary': 'text-warning-primary',
      'success-primary': 'text-success-primary',
      inherit: '',
    },
    truncate: { true: 'truncate', false: '' },
  },
  defaults: { size: 'sm', weight: 'regular', color: 'primary' },
});

export type TextElement = 'span' | 'p' | 'div' | 'label' | 'strong' | 'em' | 'code' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

export interface TextProps extends Omit<HTMLAttributes<HTMLElement>, 'color'>, VariantProps<typeof textStyles> {
  as?: TextElement;
  /** For `as="label"`. */
  htmlFor?: string;
  ref?: Ref<HTMLElement>;
}

/** Text in one of the design's type styles (`Text sm/Regular` by default). */
export function Text({ as = 'span', size, weight, color, truncate, className, ref, ...rest }: TextProps) {
  return createElement(as, { ref, className: textStyles({ size, weight, color, truncate, className }), ...rest });
}
