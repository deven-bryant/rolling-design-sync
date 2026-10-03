import type {
  HTMLAttributes,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  Ref,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from 'react';
import { cx, Text, VisuallyHidden } from '../primitives';
import { Badge } from '../Badge';
import { Checkbox, type CheckboxProps } from '../Checkbox';
import { ProgressBar } from '../ProgressBar';

export interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  ref?: Ref<HTMLTableElement>;
}

function TableRoot({ className, ref, ...rest }: TableProps) {
  return <table ref={ref} className={cx('w-full border-collapse text-left', className)} {...rest} />;
}

export interface TableHeaderProps extends HTMLAttributes<HTMLTableSectionElement> {
  ref?: Ref<HTMLTableSectionElement>;
}

/** The header row: a `<thead>` holding one row of `Table.HeaderCell`s. */
function TableHeader({ children, ref, ...rest }: TableHeaderProps) {
  return (
    <thead ref={ref} {...rest}>
      <tr>{children}</tr>
    </thead>
  );
}

export type SortDirection = 'ascending' | 'descending' | 'none';

export interface TableHeaderCellProps extends ThHTMLAttributes<HTMLTableCellElement> {
  /** `Checkbox` slot before the label (select-all). */
  checkbox?: ReactNode;
  /** The column's sort state; sets `aria-sort`. */
  sortDirection?: SortDirection;
  /** Makes the label a button that requests a sort. */
  onSort?: () => void;
  /** Sort arrow slot after the label. */
  arrow?: ReactNode;
  /** Figma `Text`: `false` is the empty header (e.g. over an actions column); `children` then names it for assistive tech only. */
  text?: boolean;
  ref?: Ref<HTMLTableCellElement>;
}

const headerLabel = 'flex items-center gap-xs text-xs font-semibold whitespace-nowrap text-quaternary';

/** Table header cell (`Size=md`) with its `_Table header label`; `text={false}` is `Text=False`. */
function TableHeaderCell({
  checkbox,
  sortDirection,
  onSort,
  arrow,
  text = true,
  children,
  className,
  ref,
  ...rest
}: TableHeaderCellProps) {
  const cell = cx('h-11 border-b border-secondary bg-primary px-3xl py-lg align-middle', className);
  if (!text) {
    return (
      <th ref={ref} scope="col" aria-sort={sortDirection} className={cell} {...rest}>
        {checkbox}
        {children != null && <VisuallyHidden>{children}</VisuallyHidden>}
      </th>
    );
  }
  const label = (
    <>
      {children}
      {arrow}
    </>
  );
  return (
    <th
      ref={ref}
      scope="col"
      aria-sort={sortDirection}
      className={cell}
      {...rest}
    >
      <div className="flex items-center gap-lg">
        {checkbox}
        {onSort ? (
          <button
            type="button"
            onClick={onSort}
            className={cx(headerLabel, 'cursor-pointer rounded-xs focus-visible:outline-2 focus-visible:outline-focus-ring')}
          >
            {label}
          </button>
        ) : (
          <span className={headerLabel}>{label}</span>
        )}
      </div>
    </th>
  );
}

export interface TableBodyProps extends HTMLAttributes<HTMLTableSectionElement> {
  ref?: Ref<HTMLTableSectionElement>;
}

function TableBody({ ref, ...rest }: TableBodyProps) {
  return <tbody ref={ref} {...rest} />;
}

export interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  /** The design's `State=Hover/selected` fill, kept on. */
  selected?: boolean;
  /** Called when the row is clicked or activated with Enter / Space; clicks on controls inside it don't count. */
  onAction?: () => void;
  ref?: Ref<HTMLTableRowElement>;
}

const interactive = 'a, button, input, label, select, textarea, [role="checkbox"]';

function TableRow({ selected = false, onAction, onClick, onKeyDown, className, ref, ...rest }: TableRowProps) {
  const handleClick = (event: MouseEvent<HTMLTableRowElement>) => {
    onClick?.(event);
    if (!onAction || event.defaultPrevented) return;
    const target = event.target as Element;
    if (target.closest(interactive) && target.closest(interactive) !== event.currentTarget) return;
    onAction();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    onKeyDown?.(event);
    if (!onAction || event.defaultPrevented || event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onAction();
    }
  };
  return (
    <tr
      ref={ref}
      aria-selected={selected || undefined}
      data-selected={selected || undefined}
      tabIndex={onAction ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cx(
        'hover:bg-secondary data-[selected]:bg-secondary',
        onAction && 'cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
        className,
      )}
      {...rest}
    />
  );
}

export interface TableCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  ref?: Ref<HTMLTableCellElement>;
}

/** The `Table cell` frame (`Size=md`): 72px row, 16/24 padding, bottom divider. Cell components build on it. */
function TableCell({ className, ref, ...rest }: TableCellProps) {
  return <td ref={ref} className={cx('h-18 border-b border-secondary px-3xl py-xl align-middle', className)} {...rest} />;
}

export const Table = Object.assign(TableRoot, {
  Header: TableHeader,
  HeaderCell: TableHeaderCell,
  Body: TableBody,
  Row: TableRow,
  Cell: TableCell,
});

export interface LeadActionProps extends CheckboxProps {
  type?: 'checkbox';
}

/** `Table cell lead action` (`Type=Checkbox`): the row's selection checkbox. */
export function LeadAction({ type: _type, ...rest }: LeadActionProps) {
  return <Checkbox size="md" {...rest} />;
}

export interface TextCellProps extends Omit<TableCellProps, 'children'> {
  /** `Text`: the cell's primary text. */
  children: ReactNode;
  /** `Supporting text`, under the primary text. */
  supportingText?: ReactNode;
  /** `Lead action` slot (`<LeadAction />`) before the text. */
  leadAction?: ReactNode;
}

function TextBlock({ children, supportingText }: { children: ReactNode; supportingText?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <Text weight="medium" className="truncate">
        {children}
      </Text>
      {supportingText != null && (
        <Text color="tertiary" className="truncate">
          {supportingText}
        </Text>
      )}
    </div>
  );
}

/** `Type=Text`. */
export function TextCell({ children, supportingText, leadAction, ...rest }: TextCellProps) {
  return (
    <TableCell {...rest}>
      <div className="flex items-center gap-lg">
        {leadAction}
        <TextBlock supportingText={supportingText}>{children}</TextBlock>
      </div>
    </TableCell>
  );
}

export interface AvatarCellProps extends TextCellProps {
  /** `Avatar` slot before the text. */
  avatar: ReactNode;
}

/** `Type=Avatar`: an `<Avatar size="md" />` before the text and supporting text. */
export function AvatarCell({ avatar, children, supportingText, leadAction, ...rest }: AvatarCellProps) {
  return (
    <TableCell {...rest}>
      <div className="flex items-center gap-lg">
        {leadAction}
        {avatar}
        <TextBlock supportingText={supportingText}>{children}</TextBlock>
      </div>
    </TableCell>
  );
}

export interface LeadActionCellProps extends Omit<TableCellProps, 'children'> {
  /** The `<LeadAction />`. */
  children: ReactNode;
}

/** A cell holding only the lead action, for a dedicated selection column. */
export function LeadActionCell({ className, ...rest }: LeadActionCellProps) {
  return <TableCell className={cx('w-0 pr-0', className)} {...rest} />;
}

export interface BadgeCellProps extends Omit<TableCellProps, 'children'> {
  /** The `<Badge />`. */
  children: ReactNode;
}

/** `Type=Badge`. */
export function BadgeCell(props: BadgeCellProps) {
  return <TableCell {...props} />;
}

export interface BadgesCellProps extends Omit<TableCellProps, 'children'> {
  /** The `<Badge />`s, in order. */
  badges: ReactNode[];
  /** How many badges to show before the `+N` overflow badge. */
  max?: number;
  /** Text of the overflow badge. */
  overflowLabel?: (hidden: number) => string;
}

/** `Type=Badges multiple`: badges in a row, the rest folded into a gray `+N` badge. */
export function BadgesCell({ badges, max = badges.length, overflowLabel = n => `+${n}`, ...rest }: BadgesCellProps) {
  const hidden = badges.length - max;
  return (
    <TableCell {...rest}>
      <div className="flex items-center gap-xs">
        {badges.slice(0, max)}
        {hidden > 0 && <Badge color="gray">{overflowLabel(hidden)}</Badge>}
      </div>
    </TableCell>
  );
}

export interface ProgressCellProps extends Omit<TableCellProps, 'children'> {
  /** 0–100. */
  value: number;
  /** Accessible name of the progress bar. */
  label: string;
}

/** `Type=Progress bar`: a progress bar with its percentage on the right. */
export function ProgressCell({ value, label, ...rest }: ProgressCellProps) {
  return (
    <TableCell {...rest}>
      <ProgressBar value={value} label="right" aria-label={label} />
    </TableCell>
  );
}

export interface ActionsCellProps extends TableCellProps {
  /** Button utilities for the row. */
  children: ReactNode;
}

/** `Type=Action icons`: `ButtonUtility`s (`size="xs"`, tertiary) in a cell that hugs them, 16px padding. */
export function ActionsCell({ children, className, ...rest }: ActionsCellProps) {
  return (
    <TableCell className={cx('w-0 px-xl', className)} {...rest}>
      <div className="flex items-center gap-xxs">{children}</div>
    </TableCell>
  );
}
