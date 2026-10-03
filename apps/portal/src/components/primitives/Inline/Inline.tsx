import { createElement, type HTMLAttributes, type Ref } from 'react';
import { flexStyles, type FlexElement, type Gap } from '../layout';

export interface InlineProps extends HTMLAttributes<HTMLElement> {
  as?: FlexElement;
  /** Space between children, from the spacing tokens. */
  gap?: Gap;
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline';
  justify?: 'start' | 'center' | 'end' | 'between';
  /** Let children wrap onto more lines. */
  wrap?: boolean;
  ref?: Ref<HTMLElement>;
}

/** Lays children out in a row with a token gap; vertically centered by default. */
export function Inline({ as = 'div', gap, align = 'center', justify, wrap, className, ref, ...rest }: InlineProps) {
  return createElement(as, { ref, className: flexStyles({ direction: 'row', gap, align, justify, wrap, className }), ...rest });
}
