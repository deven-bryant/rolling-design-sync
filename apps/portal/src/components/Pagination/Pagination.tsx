import type { HTMLAttributes, Ref } from 'react';
import { cx, Icon, variants, VisuallyHidden } from '../primitives';

export const paginationStyles = variants({
  base: 'flex items-center gap-lg',
  variants: {
    type: { 'card-default': 'border-t border-secondary px-3xl pt-lg pb-xl' },
  },
  defaults: { type: 'card-default' },
});

export const paginationNumberStyles = variants({
  base: 'flex size-10 cursor-pointer items-center justify-center rounded-md text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
  variants: {
    current: { true: 'bg-primary_hover text-secondary', false: 'text-quaternary hover:bg-primary_hover hover:text-secondary' },
  },
  defaults: { current: false },
});

const stepStyles =
  'group flex cursor-pointer items-center gap-xs rounded-md border border-primary bg-primary px-lg py-md text-sm font-semibold text-secondary shadow-xs outline-none hover:bg-primary_hover hover:text-secondary_hover focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:border-disabled_subtle disabled:text-disabled';

type Slot = number | 'ellipsis-start' | 'ellipsis-end';

/** The page buttons to show: every page up to 7, else the first and last three around one ellipsis, or the current page's neighbours between two. */
export function pageSlots(page: number, pageCount: number): Slot[] {
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  if (pageCount <= 7) return range(1, pageCount);
  if (page <= 3 || page >= pageCount - 2) return [...range(1, 3), 'ellipsis-start', ...range(pageCount - 2, pageCount)];
  return [1, 'ellipsis-start', page - 1, page, page + 1, 'ellipsis-end', pageCount];
}

interface PaginationBaseProps extends Omit<HTMLAttributes<HTMLElement>, 'onChange'> {
  /** The current page, 1-based. */
  page: number;
  onPageChange: (page: number) => void;
  /** Figma `Type`. */
  type?: 'card-default';
  /** Accessible name of the `nav` landmark. */
  label?: string;
  ref?: Ref<HTMLElement>;
}

export interface NumberedPaginationProps extends PaginationBaseProps {
  /** Total pages: renders numbered page buttons with ellipses. */
  pageCount: number;
  hasNext?: never;
}

export interface CursorPaginationProps extends PaginationBaseProps {
  pageCount?: never;
  /** Cursor mode (unknown total): only Previous / Next with "Page n"; Next is enabled while there is more. */
  hasNext: boolean;
}

export type PaginationProps = NumberedPaginationProps | CursorPaginationProps;

/** Figma `Pagination` (Type=Card default, Shape=Square): Previous / page numbers / Next, or cursor-only Previous / current page number / Next. */
export function Pagination({
  page,
  onPageChange,
  type,
  label = 'Pagination',
  pageCount,
  hasNext,
  className,
  ref,
  ...rest
}: PaginationProps) {
  const canNext = pageCount === undefined ? Boolean(hasNext) : page < pageCount;
  return (
    <nav ref={ref} aria-label={label} className={paginationStyles({ type, className })} {...rest}>
      <div className="flex flex-1">
        <button type="button" className={stepStyles} disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <Icon name="arrow-left" size="md" className="text-fg-quaternary group-disabled:text-fg-disabled_subtle" />
          Previous
        </button>
      </div>
      {pageCount === undefined ? (
        <span className={cx(paginationNumberStyles({ current: true }), 'cursor-default')} aria-live="polite">
          <VisuallyHidden>Page </VisuallyHidden>
          {page}
        </span>
      ) : (
        <ul className="flex gap-xxs">
          {pageSlots(page, pageCount).map(slot =>
            typeof slot === 'number' ? (
              <li key={slot}>
                <button
                  type="button"
                  aria-label={`Page ${slot}`}
                  aria-current={slot === page ? 'page' : undefined}
                  className={paginationNumberStyles({ current: slot === page })}
                  onClick={() => onPageChange(slot)}
                >
                  {slot}
                </button>
              </li>
            ) : (
              <li key={slot} aria-hidden className={cx(paginationNumberStyles(), 'cursor-default hover:bg-transparent hover:text-quaternary')}>
                …
              </li>
            ),
          )}
        </ul>
      )}
      <div className="flex flex-1 justify-end">
        <button type="button" className={stepStyles} disabled={!canNext} onClick={() => onPageChange(page + 1)}>
          Next
          <Icon name="arrow-right" size="md" className="text-fg-quaternary group-disabled:text-fg-disabled_subtle" />
        </button>
      </div>
    </nav>
  );
}
