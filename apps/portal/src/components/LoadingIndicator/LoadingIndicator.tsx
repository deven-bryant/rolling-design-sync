import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { Spinner } from '../Button';
import { cx, Text, variants, VisuallyHidden } from '../primitives';

export type LoadingIndicatorSize = 'sm' | 'md';

const spinnerStyles = variants({
  base: 'text-fg-brand-primary',
  variants: { size: { sm: 'size-4', md: 'size-5' } },
  defaults: { size: 'sm' },
});

export interface LoadingIndicatorProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Figma `Size`: `sm` for table rows and inline text, `md` for sections. */
  size?: LoadingIndicatorSize;
  /** Figma `Supporting text`: what is loading. */
  label?: ReactNode;
  /** Keeps the label for assistive tech only. */
  hideLabel?: boolean;
  ref?: Ref<HTMLSpanElement>;
}

/** Figma `Loading indicator` (`Type=Line simple`): the turning arc and its label, announced as a status. A `<span>`, so it fits in text and table cells. */
export function LoadingIndicator({ size = 'sm', label = 'Loading…', hideLabel = false, className, ref, ...rest }: LoadingIndicatorProps) {
  return (
    <span ref={ref} role="status" {...rest} className={cx('inline-flex items-center gap-md align-middle', className)}>
      <Spinner className={spinnerStyles({ size })} />
      {hideLabel ? (
        <VisuallyHidden>{label}</VisuallyHidden>
      ) : (
        <Text size="sm" color="tertiary">
          {label}
        </Text>
      )}
    </span>
  );
}
