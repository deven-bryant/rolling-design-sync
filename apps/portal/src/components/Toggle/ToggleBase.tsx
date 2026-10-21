import type { HTMLAttributes, Ref } from 'react';
import { cx, variants } from '../primitives';

export type ToggleSize = 'sm' | 'md';

export const toggleBaseStyles = variants({
  base: 'flex shrink-0 items-center rounded-full p-xxs motion-safe:transition-colors',
  variants: {
    size: { sm: 'h-5 w-9', md: 'h-6 w-11' },
    pressed: { true: 'bg-brand-solid', false: 'bg-tertiary' },
    focusVisible: { true: 'outline-2 outline-offset-2 outline-focus-ring', false: '' },
    disabled: { true: '', false: '' },
  },
  compound: [
    { pressed: false, disabled: true, className: 'bg-disabled' },
    { pressed: true, disabled: true, className: 'opacity-50' },
  ],
  defaults: { size: 'sm', pressed: false, focusVisible: false, disabled: false },
});

const thumbStyles = variants({
  base: 'rounded-full bg-fg-white shadow-sm motion-safe:transition-transform',
  variants: {
    size: { sm: 'size-4', md: 'size-5' },
    pressed: { true: '', false: 'translate-x-0' },
    disabled: { true: '', false: '' },
  },
  compound: [
    { pressed: false, disabled: true, className: 'bg-toggle-button-fg_disabled shadow-none' },
    { size: 'sm', pressed: true, className: 'translate-x-4' },
    { size: 'md', pressed: true, className: 'translate-x-5' },
  ],
  defaults: { size: 'sm', pressed: false, disabled: false },
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

/** The `_Toggle base` track and thumb; a disabled toggle that is on keeps its on track, dimmed. Visual only: `Toggle` carries the switch semantics. */
export function ToggleBase({ pressed = false, size = 'sm', focusVisible, disabled, className, ref, ...rest }: ToggleBaseProps) {
  return (
    <span
      ref={ref}
      aria-hidden
      data-pressed={pressed || undefined}
      {...rest}
      className={toggleBaseStyles({ size, pressed, focusVisible, disabled, className })}
    >
      <span className={cx(thumbStyles({ size, pressed, disabled }))} />
    </span>
  );
}
