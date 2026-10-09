import { createElement, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { cx } from '../primitives';

export interface MainLayoutProps extends HTMLAttributes<HTMLElement> {
  /** The root element; `main` for a page's main column. */
  as?: 'main' | 'div' | 'section';
  /** Figma `Slot`: the page content, stacked in a column. */
  children?: ReactNode;
  ref?: Ref<HTMLElement>;
}

/**
 * Figma `Main`: the page's main column. Fills the width beside the sidebar (no max width) and
 * hugs its content; the slot stacks children with spacing-4xl, inset spacing-3xl × spacing-6xl.
 */
export function MainLayout({ as = 'main', className, ref, ...rest }: MainLayoutProps) {
  return createElement(as, {
    ref,
    className: cx('flex min-w-0 flex-1 flex-col gap-4xl overflow-x-clip bg-primary px-6xl py-3xl', className),
    ...rest,
  });
}
