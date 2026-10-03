import type { ReactNode, Ref } from 'react';
import {
  Tooltip as AriaTooltip,
  TooltipTrigger as AriaTooltipTrigger,
  type TooltipProps as AriaTooltipProps,
  type TooltipTriggerComponentProps,
} from 'react-aria-components';
import { cx } from '../primitives';

export const tooltipClassName =
  'flex max-w-80 flex-col rounded-md bg-primary-solid px-lg py-md text-center text-xs font-semibold text-white shadow-lg';

export type TooltipTriggerProps = TooltipTriggerComponentProps;

/** Shows its `Tooltip` while the first child (a React Aria focusable, e.g. `Button`) is hovered or focused. */
export function TooltipTrigger({ delay = 300, closeDelay = 0, ...rest }: TooltipTriggerProps) {
  return <AriaTooltipTrigger delay={delay} closeDelay={closeDelay} {...rest} />;
}

export interface TooltipProps extends Omit<AriaTooltipProps, 'className' | 'children'> {
  /** The tooltip text (Figma `Text`). */
  children: ReactNode;
  className?: string;
  ref?: Ref<HTMLDivElement>;
}

/** The dark tooltip bubble (Figma `Tooltip`, `Supporting text=False, Arrow=None`). */
export function Tooltip({ children, className, offset = 6, placement = 'top', ref, ...rest }: TooltipProps) {
  return (
    <AriaTooltip ref={ref} offset={offset} placement={placement} {...rest} className={cx(tooltipClassName, className)}>
      {children}
    </AriaTooltip>
  );
}
