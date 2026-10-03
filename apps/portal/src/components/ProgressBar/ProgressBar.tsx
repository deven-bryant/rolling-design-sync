import type { Ref } from 'react';
import { ProgressBar as AriaProgressBar, type ProgressBarProps as AriaProgressBarProps } from 'react-aria-components';
import { variants, type VariantProps } from '../primitives';

export const progressBarStyles = variants({
  base: 'flex w-full',
  variants: {
    label: { none: '', right: 'items-center gap-lg', bottom: 'flex-col items-end gap-md' },
  },
  defaults: { label: 'none' },
});

export interface ProgressBarProps
  extends Omit<AriaProgressBarProps, 'className' | 'style' | 'children' | 'isIndeterminate'>, VariantProps<typeof progressBarStyles> {
  /** 0–100 (Figma `Progress`). */
  value: number;
  className?: string;
  ref?: Ref<HTMLDivElement>;
}

/** Figma `Progress bar`: a brand fill on a rounded track, with the percentage to the right, below, or hidden. */
export function ProgressBar({ label, className, ref, ...rest }: ProgressBarProps) {
  return (
    <AriaProgressBar ref={ref} {...rest} className={progressBarStyles({ label, className })}>
      {({ percentage = 0, valueText }) => (
        <>
          <div data-slot="track" className="h-2 w-full min-w-0 flex-1 overflow-hidden rounded-full bg-quaternary">
            <div data-slot="fill" className="h-full rounded-full bg-fg-brand-primary" style={{ width: `${percentage}%` }} />
          </div>
          {label !== undefined && label !== 'none' && (
            <span data-slot="value" className="shrink-0 text-sm font-medium text-secondary">
              {valueText}
            </span>
          )}
        </>
      )}
    </AriaProgressBar>
  );
}
