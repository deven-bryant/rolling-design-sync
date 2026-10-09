import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { cx, Icon, Text, variants, type VariantProps } from '../primitives';

export const metricStyles = variants({
  base: 'relative flex flex-col gap-md rounded-xl border border-secondary bg-primary p-2xl shadow-xs',
  variants: { type: { simple: '' } },
  defaults: { type: 'simple' },
});

export interface MetricProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof metricStyles> {
  /** `Heading`: what is measured. */
  heading: ReactNode;
  /** `Number`: the value. */
  value: ReactNode;
  /** Change badge slot (`<MetricChange />`) beside the value. */
  change?: ReactNode;
  /** `Dropdown icon` slot (the menu trigger), top-right. */
  menu?: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

/** `Metric item` (`Type=Simple, Actions=False, Breakpoint=Desktop`). */
export function Metric({ type, heading, value, change, menu, className, ref, ...rest }: MetricProps) {
  return (
    <div ref={ref} className={metricStyles({ type, className })} {...rest}>
      <Text as="h3" weight="medium" color="tertiary">
        {heading}
      </Text>
      <div className="flex items-end gap-xl">
        <Text as="p" size="display-sm" weight="semibold" className="min-w-0 flex-1">
          {value}
        </Text>
        {change}
      </div>
      {menu != null && <div className="absolute top-2xl right-2xl">{menu}</div>}
    </div>
  );
}

export const metricChangeStyles = variants({
  base: 'inline-flex shrink-0 items-center gap-xs rounded-sm border border-primary bg-primary py-xxs pr-md pl-sm shadow-xs',
  variants: { type: { '03': '' }, trend: { positive: '', negative: '' } },
  defaults: { type: '03', trend: 'positive' },
});

export interface MetricChangeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof metricChangeStyles> {
  /** `Text`: the change, e.g. `100%`. */
  children: ReactNode;
  /** Accessible name of the trend arrow. */
  trendLabel?: string;
  ref?: Ref<HTMLSpanElement>;
}

/** `_Change` badge (`Type=03`): the trend arrow and the change. */
export function MetricChange({ type, trend, trendLabel, children, className, ref, ...rest }: MetricChangeProps) {
  const down = trend === 'negative';
  return (
    <span ref={ref} className={metricChangeStyles({ type, trend, className })} {...rest}>
      <Icon
        name="arrow-up-right"
        size="xs"
        label={trendLabel ?? (down ? 'Down' : 'Up')}
        className={cx(down ? 'rotate-90 text-fg-error-secondary' : 'text-fg-success-secondary')}
      />
      <Text weight="medium" color="secondary">
        {children}
      </Text>
    </span>
  );
}
