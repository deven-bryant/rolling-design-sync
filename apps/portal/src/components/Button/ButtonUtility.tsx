import type { ReactNode, Ref } from 'react';
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components';
import { variants, type VariantProps } from '../primitives';
import { Tooltip, TooltipTrigger } from '../Tooltip';
import { IconSlot } from './Button';

export const buttonUtilityStyles = variants({
  base: [
    'inline-flex shrink-0 cursor-pointer items-center justify-center outline-focus-ring transition duration-100 ease-linear',
    'data-focus-visible:outline-2 data-focus-visible:outline-offset-2',
    'text-fg-quaternary data-hovered:text-fg-quaternary_hover data-disabled:cursor-not-allowed data-disabled:text-fg-disabled_subtle',
  ].join(' '),
  variants: {
    size: { xs: 'rounded-sm p-sm *:data-[slot=icon]:size-4' },
    hierarchy: {
      secondary: 'bg-primary shadow-xs ring-1 ring-primary ring-inset data-hovered:bg-primary_hover data-disabled:ring-disabled_subtle',
      tertiary: 'data-hovered:bg-primary_hover data-disabled:bg-transparent',
    },
  },
  defaults: { size: 'xs', hierarchy: 'secondary' },
});

export interface ButtonUtilityProps
  extends Omit<AriaButtonProps, 'children' | 'className' | 'style'>, VariantProps<typeof buttonUtilityStyles> {
  /** Figma `🔀 Icon swap`. */
  icon: ReactNode;
  /** The tooltip text; also the button's accessible name. */
  tooltip: string;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
}

/** Figma `Buttons/Button utility`: a small icon-only button that names itself with a tooltip. */
export function ButtonUtility({ icon, tooltip, size, hierarchy, className, ...rest }: ButtonUtilityProps) {
  return (
    <TooltipTrigger>
      <AriaButton aria-label={tooltip} {...rest} className={buttonUtilityStyles({ size, hierarchy, className })}>
        <IconSlot>{icon}</IconSlot>
      </AriaButton>
      <Tooltip>{tooltip}</Tooltip>
    </TooltipTrigger>
  );
}
