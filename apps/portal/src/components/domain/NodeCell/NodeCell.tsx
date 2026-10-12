import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { cx, Icon, Text } from '../../primitives';

export interface NodeCellProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onToggle'> {
  /** Figma `Name`. */
  name: ReactNode;
  /** Figma `Meta`, e.g. `COMPONENT · 1:95540`. */
  meta?: ReactNode;
  /** Badges after the name (e.g. `Removed`, `Library`); they never truncate. */
  badges?: ReactNode;
  /** Tree depth; each level indents by `spacing-2xl` (20 px). */
  depth?: number;
  /** Figma `Chevron`: the node has children. */
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: (expanded: boolean) => void;
  /** Accessible name of the chevron button; defaults to `Expand` / `Collapse`. */
  toggleLabel?: string;
  ref?: Ref<HTMLDivElement>;
}

/** Figma `Node cell`: an indented node-tree row with an expand chevron, name and meta. Place inside `Table.Cell`. */
export function NodeCell({
  name,
  meta,
  badges,
  depth = 0,
  expandable = false,
  expanded = false,
  onToggle,
  toggleLabel,
  className,
  ref,
  ...rest
}: NodeCellProps) {
  return (
    <div ref={ref} {...rest} className={cx('flex min-w-0 items-center', className)}>
      <span aria-hidden="true" data-slot="indent" className="shrink-0" style={{ width: `calc(var(--spacing-2xl) * ${depth})` }} />
      <div className="flex min-w-0 flex-1 items-center gap-md">
        {expandable && (
          <AriaButton
            aria-label={toggleLabel ?? (expanded ? 'Collapse' : 'Expand')}
            aria-expanded={expanded}
            onPress={() => onToggle?.(!expanded)}
            className="flex shrink-0 cursor-pointer items-center justify-center rounded-xs text-fg-quaternary outline-focus-ring data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-hovered:text-fg-quaternary_hover"
          >
            <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size="sm" />
          </AriaButton>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          {badges != null ? (
            <span className="flex min-w-0 items-center gap-md">
              <Text weight="medium" truncate>
                {name}
              </Text>
              {badges}
            </span>
          ) : (
            <Text weight="medium" truncate>
              {name}
            </Text>
          )}
          {meta != null && (
            <Text color="tertiary" truncate>
              {meta}
            </Text>
          )}
        </div>
      </div>
    </div>
  );
}
