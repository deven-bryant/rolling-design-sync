import { useId, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { cx, Text } from '../../primitives';

export interface ClaimHolderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  /** `Property 1=Claimed`: Name · Claim Time · Lease Expiration (and any more rows). Unset → `Unclaimed`. */
  details?: readonly { label: string; value: ReactNode }[];
  /** The `Unclaimed` line. */
  unclaimed?: ReactNode;
  /** A line under the details (label, other nodes covered). */
  note?: ReactNode;
  /** The right-hand button (`Release claim`, `Add note`). */
  action?: ReactNode;
  /** Figma `Change History`: a wider `gap-6xl` between the text and the action. */
  wide?: boolean;
  /** Under the row: a confirmation, an error. */
  children?: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

/**
 * Figma `Node Details - Claim Holder` (`Claimed` · `Unclaimed`): `Claim Holder` (text-lg semibold) over a key / value
 * list (labels regular, values semibold, text-sm tertiary) or the unclaimed line, with its action on the right.
 */
export function ClaimHolder({
  title = 'Claim Holder',
  details,
  unclaimed = 'Unclaimed · the next agent pass you start picks this up',
  note,
  action,
  wide = false,
  children,
  className,
  ref,
  ...rest
}: ClaimHolderProps) {
  const titleId = useId();
  return (
    <div ref={ref} role="group" aria-labelledby={titleId} {...rest} className={cx('flex flex-col gap-lg', className)}>
      <div className={cx('flex items-start justify-between', wide ? 'gap-6xl' : 'gap-4xl')}>
        <div className="flex min-w-0 flex-col gap-xxs">
          <Text as="h3" id={titleId} size="lg" weight="semibold">
            {title}
          </Text>
          {details?.length ? (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-md text-sm text-tertiary">
              {details.map(({ label, value }) => (
                <div key={label} className="contents">
                  <dt className="whitespace-nowrap font-regular">{label}</dt>
                  <dd className="min-w-0 break-words font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <Text as="p" color="tertiary">
              {unclaimed}
            </Text>
          )}
          {note != null && (
            <Text as="p" color="tertiary">
              {note}
            </Text>
          )}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
