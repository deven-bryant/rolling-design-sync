import type { HTMLAttributes, Ref } from 'react';
import { variants, type VariantProps } from '../primitives';

export const badgeDotStyles = variants({
  base: 'flex shrink-0 items-center justify-center text-fg-success-secondary',
  variants: {
    size: { sm: 'size-2 *:size-1.5', md: 'size-2.5 *:size-2' },
  },
  defaults: { size: 'sm' },
});

export interface BadgeDotProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeDotStyles> {
  ref?: Ref<HTMLSpanElement>;
}

/** Figma `_Dot` (`Outline=False`): a decorative status dot in `currentColor` (success by default). */
export function BadgeDot({ size, className, ref, ...rest }: BadgeDotProps) {
  return (
    <span ref={ref} aria-hidden="true" data-slot="dot" {...rest} className={badgeDotStyles({ size, className })}>
      <span className="rounded-full bg-current" />
    </span>
  );
}
