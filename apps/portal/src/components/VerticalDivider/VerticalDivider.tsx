import type { HTMLAttributes, Ref } from 'react';
import { cx } from '../primitives';

export interface VerticalDividerProps extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>;
}

/** Figma `Vertical Divider`: a 20px `border-primary` rule between inline items; decorative. */
export function VerticalDivider({ className, ...rest }: VerticalDividerProps) {
  return <div aria-hidden {...rest} className={cx('h-5 w-px shrink-0 border-l border-primary', className)} />;
}
