import { Badge, type BadgeProps } from '../../Badge';

export type ChangeType = 'added' | 'modified' | 'deleted' | 'requested';

export const changeBadgeColors = { added: 'blue', modified: 'brand', deleted: 'gray', requested: 'orange' } as const satisfies Record<
  ChangeType,
  BadgeProps['color']
>;

const labels: Record<ChangeType, string> = { added: 'Added', modified: 'Modified', deleted: 'Deleted', requested: 'Requested' };

export interface ChangeBadgeProps extends Omit<BadgeProps, 'color' | 'children'> {
  change: ChangeType;
  /** Defaults to the capitalized change type. */
  children?: BadgeProps['children'];
}

/** A node's `changeType` as a Badge: added → blue, modified → brand, deleted → gray, requested (open notes) → orange. */
export function ChangeBadge({ change, children, ...rest }: ChangeBadgeProps) {
  return (
    <Badge {...rest} color={changeBadgeColors[change]}>
      {children ?? labels[change]}
    </Badge>
  );
}
