import { Children, isValidElement, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { cx, Text, type TextProps } from '../primitives';

export interface SectionHeaderProps extends HTMLAttributes<HTMLElement> {
  /** Figma `Divider`: a border-secondary rule under the header (hidden in the main component). */
  divider?: boolean;
  children?: ReactNode;
  ref?: Ref<HTMLElement>;
}

export interface SectionHeaderSlotProps extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>;
}

export interface SectionHeaderTitleProps extends Omit<TextProps, 'as' | 'size' | 'weight' | 'color'> {
  /** Heading level of the title. */
  as?: 'h2' | 'h3' | 'h4';
}

function SectionHeaderTitle({ as = 'h2', ...rest }: SectionHeaderTitleProps) {
  return <Text as={as} size="lg" weight="semibold" color="primary" {...rest} />;
}

/** Figma `Supporting Content` slot: a row under the title; plain text gets `Text sm/Regular` tertiary. */
function SectionHeaderSupportingContent({ className, ref, ...rest }: SectionHeaderSlotProps) {
  return <div ref={ref} className={cx('flex text-sm text-tertiary', className)} {...rest} />;
}

/** Figma `Actions`: buttons, 12px apart. */
function SectionHeaderActions({ className, ref, ...rest }: SectionHeaderSlotProps) {
  return <div ref={ref} className={cx('flex items-center gap-lg', className)} {...rest} />;
}

/** Figma `Dropdown`: holds a `<Menu>` trigger after the actions. */
function SectionHeaderDropdown({ className, ref, ...rest }: SectionHeaderSlotProps) {
  return <div ref={ref} className={cx('flex', className)} {...rest} />;
}

/**
 * Figma `Custom Section header`: a title with optional supporting content, actions and dropdown beside it,
 * and an optional divider. Children are placed by slot type; anything else joins the title column.
 */
function SectionHeaderRoot({ divider = false, children, className, ref, ...rest }: SectionHeaderProps) {
  const text: ReactNode[] = [];
  const actions: ReactNode[] = [];
  const dropdown: ReactNode[] = [];
  Children.forEach(children, child => {
    if (isValidElement(child) && child.type === SectionHeaderActions) actions.push(child);
    else if (isValidElement(child) && child.type === SectionHeaderDropdown) dropdown.push(child);
    else text.push(child);
  });
  return (
    <header ref={ref} className={cx('flex flex-col gap-2xl', className)} {...rest}>
      <div className="flex items-start gap-xl">
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-xxs self-stretch">{text}</div>
        {actions}
        {dropdown}
      </div>
      {divider && <hr className="border-secondary" />}
    </header>
  );
}

export const SectionHeader = Object.assign(SectionHeaderRoot, {
  Title: SectionHeaderTitle,
  SupportingContent: SectionHeaderSupportingContent,
  Actions: SectionHeaderActions,
  Dropdown: SectionHeaderDropdown,
});
