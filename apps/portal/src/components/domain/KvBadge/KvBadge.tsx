import { Fragment, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { cx } from '../../primitives';
import { VerticalDivider } from '../../VerticalDivider';

export interface KvBadgeProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  label: ReactNode;
  value: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

/** Figma `KV Badge`: a regular label then its semibold value, `text-sm text-tertiary`. */
export function KvBadge({ label, value, className, ...rest }: KvBadgeProps) {
  return (
    <div {...rest} className={cx('flex items-center gap-2.5 whitespace-nowrap text-sm text-tertiary', className)}>
      <dt className="font-regular">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

export interface KvBadgeListProps extends Omit<HTMLAttributes<HTMLDListElement>, 'children'> {
  items: readonly { label: string; value: ReactNode }[];
  ref?: Ref<HTMLDListElement>;
}

/** A row of `KV Badge`s separated by `Vertical Divider`s (Figma `Render Check Header`, Variant2), wrapping when narrow. */
export function KvBadgeList({ items, className, ...rest }: KvBadgeListProps) {
  return (
    <dl {...rest} className={cx('flex flex-wrap items-center gap-md', className)}>
      {items.map((item, i) => (
        <Fragment key={item.label}>
          {i > 0 && <VerticalDivider />}
          <KvBadge label={item.label} value={item.value} />
        </Fragment>
      ))}
    </dl>
  );
}
