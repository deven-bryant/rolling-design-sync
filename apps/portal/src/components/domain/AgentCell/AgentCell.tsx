import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { cx, Text } from '../../primitives';
import { AgentSprite, type AgentSpriteState } from '../AgentSprite';

export interface AgentCellProps extends HTMLAttributes<HTMLDivElement> {
  /** Figma `Agent`: the worker id. */
  worker: string;
  /** The token label shown beside the worker (`devin-7f3a · devin`). */
  tokenLabel?: string;
  /** Figma `When`, e.g. `claimed 2m ago`. */
  when?: ReactNode;
  /** Figma `Avatar`. */
  avatar?: boolean;
  /** The sprite's lifecycle state. */
  spriteState?: AgentSpriteState;
  onSpriteAnimationEnd?: (state: AgentSpriteState) => void;
  ref?: Ref<HTMLDivElement>;
}

/** Figma `Agent cell`: the agent's sprite, its worker id and when it acted. Place inside `Table.Cell`. */
export function AgentCell({
  worker,
  tokenLabel,
  when,
  avatar = true,
  spriteState,
  onSpriteAnimationEnd,
  className,
  ref,
  ...rest
}: AgentCellProps) {
  return (
    <div ref={ref} {...rest} className={cx('flex min-w-0 items-center gap-lg', className)}>
      {avatar && <AgentSprite worker={worker} state={spriteState} onAnimationEnd={onSpriteAnimationEnd} aria-hidden="true" />}
      <div className="flex min-w-0 flex-1 flex-col">
        <Text weight="medium" truncate>
          {worker}
          {tokenLabel != null && (
            <Text weight="regular" color="tertiary">
              {' · '}
              {tokenLabel}
            </Text>
          )}
        </Text>
        {when != null && (
          <Text color="tertiary" truncate>
            {when}
          </Text>
        )}
      </div>
    </div>
  );
}
