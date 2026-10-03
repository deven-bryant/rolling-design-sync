import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { Badge } from '../../Badge';
import { cx, Icon, Text, variants } from '../../primitives';

export const tokenChipStyles = variants({
  base: 'inline-flex shrink-0 items-center rounded-sm border px-md py-xs text-xs font-medium whitespace-nowrap',
  variants: {
    side: {
      built: 'border-secondary bg-secondary text-secondary',
      now: 'border-utility-brand-200 bg-utility-brand-50 text-utility-brand-700',
    },
  },
  defaults: { side: 'built' },
});

export interface DiffRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'property'> {
  /** Figma `Property`, e.g. `fills`. */
  property: ReactNode;
  /** The change category, shown as a gray-blue Badge. */
  category?: ReactNode;
  /** Figma `Built`: the value at the last clear (a token name, or the raw value). */
  built: ReactNode;
  /** Figma `Now`: the value in the design today. */
  now: ReactNode;
  /** Figma `Raw`, e.g. `#FFFFFF → #F9FAFB`. */
  raw?: ReactNode;
  /** Figma `Show raw`. */
  showRaw?: boolean;
  ref?: Ref<HTMLDivElement>;
}

/** Figma `Diff row`: one changed property with its built → now values. */
export function DiffRow({ property, category, built, now, raw, showRaw = false, className, ref, ...rest }: DiffRowProps) {
  return (
    <div ref={ref} {...rest} className={cx('flex flex-col gap-md border-b border-secondary py-lg', className)}>
      <div className="flex items-center gap-md">
        <Text weight="semibold">{property}</Text>
        {category != null && <Badge color="gray-blue">{category}</Badge>}
      </div>
      <div className="flex flex-wrap items-center gap-md">
        <span className={tokenChipStyles({ side: 'built' })}>{built}</span>
        <Icon name="arrow-right" size="sm" label="to" className="text-fg-quaternary" />
        <span className={tokenChipStyles({ side: 'now' })}>{now}</span>
      </div>
      {showRaw && raw != null && (
        <Text as="p" color="quaternary">
          {raw}
        </Text>
      )}
    </div>
  );
}
