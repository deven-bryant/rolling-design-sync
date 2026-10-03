import type { HTMLAttributes, Ref } from 'react';
import { cx, variants } from '../primitives';

export type CheckboxSize = 'sm' | 'md';
export type CheckboxType = 'checkbox' | 'radio';

export const checkboxBaseStyles = variants({
  base: 'flex shrink-0 items-center justify-center border text-fg-white',
  variants: {
    size: { sm: 'size-4', md: 'size-5' },
    type: { checkbox: '', radio: 'rounded-full' },
    checked: { true: 'border-brand-solid bg-brand-solid', false: 'border-primary' },
    focusVisible: { true: 'outline-2 outline-offset-2 outline-focus-ring', false: '' },
    disabled: { true: 'border-disabled bg-disabled_subtle text-fg-disabled_subtle', false: '' },
  },
  compound: [
    { type: 'checkbox', size: 'sm', className: 'rounded-xs' },
    { type: 'checkbox', size: 'md', className: 'rounded-sm' },
  ],
  defaults: { size: 'sm', type: 'checkbox', checked: false, focusVisible: false, disabled: false },
});

const markSize = { sm: 'size-3', md: 'size-3.5' } as const;
const dotSize = { sm: 'size-1.5', md: 'size-2' } as const;

const marks = {
  sm: { viewBox: '0 0 12 12', check: 'M10 3 4.5 8.5 2 6', minus: 'M2.5 6h7', strokeWidth: 1.6667 },
  md: { viewBox: '0 0 14 14', check: 'M11.667 3.5 5.25 9.917 2.333 7', minus: 'M2.917 7h8.166', strokeWidth: 2 },
} as const;

export interface CheckboxBaseProps extends HTMLAttributes<HTMLSpanElement> {
  /** Figma `Checked`. */
  checked?: boolean;
  /** Figma `Indeterminate`: drawn as checked with a dash. */
  indeterminate?: boolean;
  /** Figma `Size`. */
  size?: CheckboxSize;
  /** Figma `Type`. */
  type?: CheckboxType;
  focusVisible?: boolean;
  disabled?: boolean;
  ref?: Ref<HTMLSpanElement>;
}

/** The `_Checkbox base` box or radio circle. Visual only: the surrounding control carries the semantics. */
export function CheckboxBase({
  checked = false,
  indeterminate = false,
  size = 'sm',
  type = 'checkbox',
  focusVisible,
  disabled,
  className,
  ref,
  ...rest
}: CheckboxBaseProps) {
  const on = checked || indeterminate;
  const mark = marks[size];
  return (
    <span
      ref={ref}
      aria-hidden
      data-checked={checked || undefined}
      data-indeterminate={indeterminate || undefined}
      {...rest}
      className={checkboxBaseStyles({ size, type, checked: on, focusVisible, disabled, className })}
    >
      {on && type === 'radio' && <span className={cx('rounded-full bg-current', dotSize[size])} />}
      {on && type === 'checkbox' && (
        <svg
          viewBox={mark.viewBox}
          fill="none"
          stroke="currentColor"
          strokeWidth={mark.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={markSize[size]}
        >
          <path d={indeterminate ? mark.minus : mark.check} />
        </svg>
      )}
    </span>
  );
}
