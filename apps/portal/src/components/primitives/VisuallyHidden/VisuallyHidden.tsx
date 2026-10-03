import { createElement, type HTMLAttributes, type Ref } from 'react';
import { cx } from '../cx';

export interface VisuallyHiddenProps extends HTMLAttributes<HTMLElement> {
  as?: 'span' | 'div' | 'label' | 'h1' | 'h2' | 'h3';
  /** Show the content while it (or something inside it) has focus — for skip links. */
  focusable?: boolean;
  htmlFor?: string;
  ref?: Ref<HTMLElement>;
}

/** Content for assistive tech only: hidden visually, still in the accessibility tree. */
export function VisuallyHidden({ as = 'span', focusable = false, className, ref, ...rest }: VisuallyHiddenProps) {
  return createElement(as, {
    ref,
    className: cx('sr-only', focusable && 'focus-within:not-sr-only focus:not-sr-only', className),
    ...rest,
  });
}
