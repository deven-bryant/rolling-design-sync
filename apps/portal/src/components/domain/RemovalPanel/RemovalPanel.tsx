import { useId, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { Badge } from '../../Badge';
import { cx, Icon, Text } from '../../primitives';

/** A component the removed design used (a removed work item's `uses` entry). */
export interface RemovalUse {
  componentId?: string;
  name?: string | null;
  /** Live instances of it anywhere in the file; 0 = nothing uses it any more. */
  livePlacements?: number;
}

/** A removed work item's `warnings` entry: a main component removed with the design that still has live instances. */
export interface RemovalWarning {
  code?: string;
  componentId?: string;
  livePlacements?: number;
}

export interface RemovalPanelProps extends HTMLAttributes<HTMLDivElement> {
  /** The removed root's name. */
  name: string;
  uses: readonly RemovalUse[];
  warnings?: readonly RemovalWarning[];
  /** The panel's action (`Copy removal prompt`). */
  action?: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

const placementsLeft = (n: number) => (n > 0 ? `${n.toLocaleString('en-US')} ${n === 1 ? 'placement' : 'placements'} left` : 'none left');

/** `uses` with the unused components (`livePlacements: 0`) first, otherwise in the given order. */
export function sortUses<U extends RemovalUse>(uses: readonly U[]): U[] {
  return [...uses].sort((a, b) => Number((a.livePlacements ?? 0) > 0) - Number((b.livePlacements ?? 0) > 0));
}

/** One warning line: `"Pricing card" was deleted from the design but 2 instances still use it.` */
export function warningText(warning: RemovalWarning, uses: readonly RemovalUse[]): string {
  const name = uses.find(u => u.componentId === warning.componentId)?.name ?? warning.componentId ?? 'A component';
  const n = warning.livePlacements ?? 0;
  return `“${name}” was deleted from the design but ${n.toLocaleString('en-US')} ${n === 1 ? 'instance still uses' : 'instances still use'} it.`;
}

/**
 * The node drawer's *Removal* panel for a removed work item: what to remove, the components the removed design
 * used with the placements they have left (*Keep* while any are left, *Likely unused* at none), its warnings and
 * an action.
 */
export function RemovalPanel({ name, uses, warnings = [], action, className, ref, ...rest }: RemovalPanelProps) {
  const titleId = useId();
  const usesId = useId();
  const sorted = sortUses(uses);
  return (
    <div ref={ref} role="group" aria-labelledby={titleId} {...rest} className={cx('flex flex-col gap-xl rounded-xl bg-secondary p-xl ring-1 ring-secondary ring-inset', className)}>
      <div className="flex flex-col gap-xs">
        <Text as="h3" id={titleId} size="lg" weight="semibold">
          Removed from the design
        </Text>
        <Text as="p" color="tertiary">
          Remove the code that rendered “{name}”. Keep components that are still used.
        </Text>
      </div>
      <div className="flex flex-col gap-md">
        <Text as="h4" id={usesId} weight="semibold" color="secondary">
          Components it used
        </Text>
        {sorted.length ? (
          <ul aria-labelledby={usesId} className="flex flex-col divide-y divide-secondary rounded-lg bg-primary ring-1 ring-secondary ring-inset">
            {sorted.map((use, i) => {
              const live = use.livePlacements ?? 0;
              return (
                <li key={use.componentId ?? i} className="flex items-center gap-lg px-xl py-md">
                  <Text weight="medium" truncate className="min-w-0 flex-1">
                    {use.name ?? use.componentId}
                  </Text>
                  <Text color="tertiary" className="shrink-0">
                    {placementsLeft(live)}
                  </Text>
                  {live > 0 ? <Badge color="success">Keep</Badge> : <Badge color="warning">Likely unused</Badge>}
                </li>
              );
            })}
          </ul>
        ) : (
          <Text as="p" color="tertiary">
            It used no components.
          </Text>
        )}
      </div>
      {warnings.length > 0 && (
        <ul aria-label="Warnings" className="flex flex-col gap-xs">
          {warnings.map((warning, i) => (
            <li key={`${warning.componentId ?? ''}-${i}`} className="flex items-start gap-md text-sm text-warning-primary">
              <Icon name="alert-circle" size="md" className="text-fg-warning-primary" />
              <span>{warningText(warning, uses)}</span>
            </li>
          ))}
        </ul>
      )}
      {action != null && <div className="flex">{action}</div>}
    </div>
  );
}
