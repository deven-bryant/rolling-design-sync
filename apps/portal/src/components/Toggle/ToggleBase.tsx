import type { HTMLAttributes, Ref } from 'react';
import { cx, variants } from '../primitives';

export type ToggleSize = 'sm';

export const toggleBaseStyles = variants({
  base: 'flex shrink-0 items-center rounded-full p-xxs motion-safe:transition-colors',
  variants: {
    size: { sm: 'h-5 w-9' },
    pressed: { true: 'bg-brand-solid', false: 'bg-tertiary' },
    focusVisible: { true: 'outline-2 outline-offset-2 outline-focus-ring', false: '' },
    disabled: { true: 'bg-disabled', false: '' },
  },
  defaults: { size: 'sm', pressed: false, focusVisible: false, disabled: false },
});

const thumbStyles = variants({
  base: 'size-4 rounded-full bg-fg-white shadow-sm motion-safe:transition-transform',
  variants: {
    pressed: { true: 'translate-x-4', false: 'translate-x-0' },
    disabled: { true: 'bg-toggle-button-fg_disabled shadow-none', false: '' },
  },
  defaults: { pressed: false, disabled: false },
});

export interface ToggleBaseProps extends HTMLAttributes<HTMLSpanElement> {
  /** Figma `Pressed`. */
  pressed?: boolean;
  /** Figma `Size`. */
  size?: ToggleSize;
  focusVisible?: boolean;
  disabled?: boolean;
  ref?: Ref<HTMLSpanElement>;
}

/** The `_Toggle base` track and thumb. Visual only: `Toggle` carries the switch semantics. */
export function ToggleBase({ pressed = false, size = 'sm', focusVisible, disabled, className, ref, ...rest }: ToggleBaseProps) {
  return (
    <span
      ref={ref}
      aria-hidden
      data-pressed={pressed || undefined}
      {...rest}
      className={toggleBaseStyles({ size, pressed, focusVisible, disabled, className })}
    >
      <span className={cx(thumbStyles({ pressed, disabled }))} />
    </span>
  );
}
