import type { Ref } from 'react';
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components';
import { Icon, variants, type VariantProps } from '../primitives';

export const closeButtonStyles = variants({
  base: [
    'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md p-md outline-focus-ring transition duration-100 ease-linear',
    'text-fg-quaternary data-hovered:bg-primary_hover data-hovered:text-fg-quaternary_hover',
    'data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-disabled:cursor-not-allowed data-disabled:text-fg-disabled_subtle',
  ].join(' '),
  variants: {
    size: { sm: 'size-9', md: 'size-10' },
  },
  defaults: { size: 'sm' },
});

export interface CloseButtonProps
  extends Omit<AriaButtonProps, 'children' | 'className' | 'style'>, VariantProps<typeof closeButtonStyles> {
  className?: string;
  ref?: Ref<HTMLButtonElement>;
}

/** Figma `Button close X`: an `x-close` icon button, named "Close" unless given an `aria-label`. */
export function CloseButton({ size, className, 'aria-label': ariaLabel = 'Close', ...rest }: CloseButtonProps) {
  return (
    <AriaButton aria-label={ariaLabel} {...rest} className={closeButtonStyles({ size, className })}>
      <Icon name="x-close" size="md" />
    </AriaButton>
  );
}
