import { Badge, type BadgeProps } from '../../Badge';

export type NodeState = 'dirty' | 'clean' | 'blocked';

export const stateBadgeColors = { dirty: 'warning', clean: 'success', blocked: 'error' } as const satisfies Record<
  NodeState,
  BadgeProps['color']
>;

const labels: Record<NodeState, string> = { dirty: 'Dirty', clean: 'Clean', blocked: 'Blocked' };

export interface StateBadgeProps extends Omit<BadgeProps, 'color' | 'children'> {
  state: NodeState;
  /** Defaults to the capitalized state. */
  children?: BadgeProps['children'];
}

/** A node's `state` as a Badge: dirty → warning, clean → success, blocked → error. */
export function StateBadge({ state, children, dot = true, ...rest }: StateBadgeProps) {
  return (
    <Badge {...rest} dot={dot} color={stateBadgeColors[state]}>
      {children ?? labels[state]}
    </Badge>
  );
}
