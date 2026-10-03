import { createElement, type HTMLAttributes, type Ref } from 'react';
import { flexStyles, type FlexElement, type Gap } from '../layout';

export interface StackProps extends HTMLAttributes<HTMLElement> {
  as?: FlexElement;
  /** Space between children, from the spacing tokens. */
  gap?: Gap;
  align?: 'start' | 'center' | 'end' | 'stretch';
  justify?: 'start' | 'center' | 'end' | 'between';
  ref?: Ref<HTMLElement>;
}

/** Lays children out in a column with a token gap. */
export function Stack({ as = 'div', gap, align, justify, className, ref, ...rest }: StackProps) {
  return createElement(as, { ref, className: flexStyles({ direction: 'column', gap, align, justify, className }), ...rest });
}
