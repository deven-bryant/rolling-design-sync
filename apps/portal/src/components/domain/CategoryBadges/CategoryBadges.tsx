import type { HTMLAttributes, Ref } from 'react';
import { Badge } from '../../Badge';
import { cx } from '../../primitives';

export interface CategoryBadgesProps extends HTMLAttributes<HTMLDivElement> {
  /** Change categories, e.g. `['color', 'layout']`. */
  categories: readonly string[];
  /** How many to show before folding the rest into a `+N` badge. */
  max?: number;
  ref?: Ref<HTMLDivElement>;
}

/** A node's change categories as gray-blue Badges, the overflow folded into a gray `+N`. */
export function CategoryBadges({ categories, max = categories.length, className, ref, ...rest }: CategoryBadgesProps) {
  const shown = categories.slice(0, Math.max(0, max));
  const hidden = categories.slice(shown.length);
  return (
    <div ref={ref} {...rest} className={cx('flex items-center gap-xs', className)}>
      {shown.map(category => (
        <Badge key={category} color="gray-blue">
          {category}
        </Badge>
      ))}
      {hidden.length > 0 && (
        <Badge color="gray" title={hidden.join(', ')}>
          +{hidden.length}
        </Badge>
      )}
    </div>
  );
}
