import { Children, isValidElement, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { cx, Text, type TextProps } from '../primitives';

export interface PageHeaderProps extends HTMLAttributes<HTMLElement> {
  /** Figma `Divider`: a border-secondary rule under the header. */
  divider?: boolean;
  children?: ReactNode;
  ref?: Ref<HTMLElement>;
}

export interface PageHeaderSlotProps extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>;
}

function PageHeaderBreadcrumbs({ className, ref, ...rest }: PageHeaderSlotProps) {
  return <div ref={ref} className={cx('flex', className)} {...rest} />;
}

function PageHeaderTitle({ className, ...rest }: Omit<TextProps, 'as' | 'size' | 'weight' | 'color'>) {
  return <Text as="h1" size="display-xs" weight="semibold" color="primary" className={className} {...rest} />;
}

function PageHeaderDescription({ className, ...rest }: Omit<TextProps, 'as' | 'size' | 'weight' | 'color'>) {
  return <Text as="p" size="md" weight="regular" color="tertiary" className={className} {...rest} />;
}

function PageHeaderActions({ className, ref, ...rest }: PageHeaderSlotProps) {
  return <div ref={ref} className={cx('flex items-center gap-lg', className)} {...rest} />;
}

/**
 * Figma `Page header` (Style=Simple): optional breadcrumbs above a title and supporting text,
 * actions beside them, and an optional divider. Children are placed by slot type.
 */
export function PageHeader({ divider = false, children, className, ref, ...rest }: PageHeaderProps) {
  const breadcrumbs: ReactNode[] = [];
  const actions: ReactNode[] = [];
  const text: ReactNode[] = [];
  Children.forEach(children, child => {
    if (isValidElement(child) && child.type === PageHeaderBreadcrumbs) breadcrumbs.push(child);
    else if (isValidElement(child) && child.type === PageHeaderActions) actions.push(child);
    else text.push(child);
  });
  return (
    <header ref={ref} className={cx('flex flex-col gap-xl', className)} {...rest}>
      {breadcrumbs}
      <div className="flex items-start gap-xl">
        <div className="flex min-w-80 flex-1 flex-col gap-xs">{text}</div>
        {actions}
      </div>
      {divider && <hr className="border-secondary" />}
    </header>
  );
}

PageHeader.Breadcrumbs = PageHeaderBreadcrumbs;
PageHeader.Title = PageHeaderTitle;
PageHeader.Description = PageHeaderDescription;
PageHeader.Actions = PageHeaderActions;
