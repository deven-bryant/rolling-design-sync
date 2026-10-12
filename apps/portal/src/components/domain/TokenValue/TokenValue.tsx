import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from '../../primitives';

export interface TokenValueProps extends HTMLAttributes<HTMLSpanElement> {
  /** The value as designers read it: `#202527`, `16`, or an alias's token name (`gray-800`). */
  children: ReactNode;
  /** A CSS color for the swatch before the value (color tokens); no swatch when unset. */
  swatch?: string | null;
  ref?: Ref<HTMLSpanElement>;
}

/** A design token's value in one mode: a color swatch (colors only) and the value. */
export function TokenValue({ children, swatch, className, ref, ...rest }: TokenValueProps) {
  return (
    <span ref={ref} {...rest} className={cx('inline-flex min-w-0 items-center gap-xs whitespace-nowrap', className)}>
      {swatch && (
        <span
          aria-hidden="true"
          data-slot="swatch"
          className="size-3 shrink-0 rounded-xs border border-primary"
          style={{ backgroundColor: swatch }}
        />
      )}
      <span className="truncate">{children}</span>
    </span>
  );
}
