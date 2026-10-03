import { createContext, useContext, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { Button, Disclosure, DisclosurePanel, Link, RouterProvider } from 'react-aria-components';
import { Menu } from '../Menu';
import { cx, Icon, Text, variants, type IconName } from '../primitives';

export const navItemStyles = variants({
  base: 'flex w-full cursor-pointer items-center gap-lg rounded-sm px-lg py-md text-left outline-none data-focus-visible:ring-2 data-focus-visible:ring-focus-ring',
  variants: {
    current: { true: 'bg-active', false: 'bg-primary data-hovered:bg-primary_hover' },
  },
  defaults: { current: false },
});

const InFooter = createContext(false);

export interface SidebarNavProps extends HTMLAttributes<HTMLElement> {
  /** Client-side navigation for item links: called with the `href` instead of a full page load. */
  onNavigate?: (href: string) => void;
  ref?: Ref<HTMLElement>;
}

/**
 * Figma `Sidebar navigation` (Style=Simple, Breakpoint=Desktop, Open=False): a `nav` landmark with a header,
 * item sections and a footer. Router-agnostic: items take an `href`; pass `onNavigate` to route them client-side.
 */
export function SidebarNav({ onNavigate, className, 'aria-label': ariaLabel = 'Main', ref, ...rest }: SidebarNavProps) {
  const nav = (
    <nav
      ref={ref}
      aria-label={ariaLabel}
      className={cx('flex h-full w-74 flex-col gap-xl overflow-y-auto border-r border-secondary bg-primary pt-3xl', className)}
      {...rest}
    />
  );
  return onNavigate ? <RouterProvider navigate={onNavigate}>{nav}</RouterProvider> : nav;
}

export interface SidebarNavSlotProps extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>;
}

function SidebarNavHeader({ className, ref, ...rest }: SidebarNavSlotProps) {
  return <div ref={ref} className={cx('flex flex-col gap-2xl px-2xl', className)} {...rest} />;
}

function SidebarNavSearch({ className, ref, ...rest }: SidebarNavSlotProps) {
  return <div ref={ref} role="search" className={cx('flex flex-col', className)} {...rest} />;
}

export interface SidebarNavSectionProps extends HTMLAttributes<HTMLUListElement> {
  ref?: Ref<HTMLUListElement>;
}

function SidebarNavSection({ className, ref, ...rest }: SidebarNavSectionProps) {
  const inFooter = useContext(InFooter);
  return <ul ref={ref} className={cx('flex flex-col', !inFooter && 'px-xl', className)} {...rest} />;
}

export interface SidebarNavItemProps {
  /** The item label. */
  children: ReactNode;
  href?: string;
  /** Figma `Icon leading` / `Icon swap`. */
  icon?: IconName;
  /** Figma `Badge`: e.g. a count `Badge` after the label. */
  badge?: ReactNode;
  /** Figma `Current`: the item for the current page (aria-current="page"). */
  current?: boolean;
  /** Sub-items: makes this a Figma `_Nav item dropdown base` that expands them. */
  items?: ReactNode;
  defaultExpanded?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  className?: string;
}

function ItemContent({ icon, badge, current, children }: Pick<SidebarNavItemProps, 'icon' | 'badge' | 'current' | 'children'>) {
  return (
    <>
      <span className={cx('flex min-w-0 flex-1 items-center gap-md text-md font-semibold', current ? 'text-secondary_hover' : 'text-secondary')}>
        {icon && <Icon name={icon} size="md" className="text-fg-quaternary" />}
        {children}
      </span>
      {badge}
    </>
  );
}

function SidebarNavItem({
  children,
  href,
  icon,
  badge,
  current = false,
  items,
  defaultExpanded,
  expanded,
  onExpandedChange,
  className,
}: SidebarNavItemProps) {
  if (items === undefined) {
    return (
      <li className={cx('py-xxs', className)}>
        <Link href={href} aria-current={current ? 'page' : undefined} className={navItemStyles({ current })}>
          <ItemContent icon={icon} badge={badge} current={current}>
            {children}
          </ItemContent>
        </Link>
      </li>
    );
  }
  return (
    <li className={className}>
      <Disclosure defaultExpanded={defaultExpanded} isExpanded={expanded} onExpandedChange={onExpandedChange} className="group">
        <div className="py-xxs">
          <Button slot="trigger" className={navItemStyles({ current })}>
            <ItemContent icon={icon} badge={badge} current={current}>
              {children}
            </ItemContent>
            <Icon name="chevron-down" size="sm" className="text-fg-quaternary group-data-expanded:rotate-180" />
          </Button>
        </div>
        <DisclosurePanel>
          <ul className="flex flex-col">{items}</ul>
        </DisclosurePanel>
      </Disclosure>
    </li>
  );
}

function SidebarNavFooter({ className, ref, ...rest }: SidebarNavSlotProps) {
  return (
    <InFooter.Provider value>
      <div ref={ref} className={cx('mt-auto flex flex-col gap-xl px-xl pb-3xl', className)} {...rest} />
    </InFooter.Provider>
  );
}

export interface SidebarNavFeatureCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  /** Figma `Supporting text`. */
  children?: ReactNode;
  /** Figma `Type=Progress bar`: the progress bar slot. */
  progress?: ReactNode;
  /** Link buttons under the content. */
  actions?: ReactNode;
  /** Figma `X close button`: shown when set. */
  onDismiss?: () => void;
  dismissLabel?: string;
  ref?: Ref<HTMLDivElement>;
}

function SidebarNavFeatureCard({
  title,
  children,
  progress,
  actions,
  onDismiss,
  dismissLabel = 'Dismiss',
  className,
  ref,
  ...rest
}: SidebarNavFeatureCardProps) {
  return (
    <div ref={ref} className={cx('relative flex flex-col gap-xl rounded-xl bg-secondary p-xl', className)} {...rest}>
      {onDismiss && (
        <Button
          aria-label={dismissLabel}
          onPress={onDismiss}
          className="absolute top-md right-md flex cursor-pointer rounded-md p-md text-fg-quaternary outline-none data-hovered:bg-primary_hover data-hovered:text-fg-quaternary_hover data-focus-visible:ring-2 data-focus-visible:ring-focus-ring"
        >
          <Icon name="x-close" size="md" />
        </Button>
      )}
      <div className="flex flex-col gap-xs">
        <Text as="p" size="sm" weight="semibold" color="primary" className="pr-3xl">
          {title}
        </Text>
        {children && (
          <Text as="p" size="sm" weight="regular" color="tertiary">
            {children}
          </Text>
        )}
      </div>
      {progress}
      {actions && <div className="flex gap-lg">{actions}</div>}
    </div>
  );
}

export interface SidebarNavAccountProps extends HTMLAttributes<HTMLDivElement> {
  /** The signed-in identity, e.g. an avatar label group. */
  children: ReactNode;
  /** `Menu.Item` / `Menu.Section` / `Menu.Separator` children for the account menu. */
  menu?: ReactNode;
  menuLabel?: string;
  ref?: Ref<HTMLDivElement>;
}

function SidebarNavAccount({ children, menu, menuLabel = 'Account menu', className, ref, ...rest }: SidebarNavAccountProps) {
  return (
    <div
      ref={ref}
      className={cx('relative flex gap-xl rounded-xl border border-secondary bg-primary_alt p-lg', className)}
      {...rest}
    >
      <div className="flex min-w-0 flex-1">{children}</div>
      {menu && (
        <Menu
          label={menuLabel}
          placement="top end"
          trigger={
            <Button
              aria-label={menuLabel}
              className="flex shrink-0 cursor-pointer self-start rounded-sm p-sm text-fg-quaternary outline-none data-hovered:bg-primary_hover data-hovered:text-fg-quaternary_hover data-pressed:bg-primary_hover data-focus-visible:ring-2 data-focus-visible:ring-focus-ring"
            >
              <Icon name="chevron-selector-vertical" size="sm" />
            </Button>
          }
        >
          {menu}
        </Menu>
      )}
    </div>
  );
}

SidebarNav.Header = SidebarNavHeader;
SidebarNav.Search = SidebarNavSearch;
SidebarNav.Section = SidebarNavSection;
SidebarNav.Item = SidebarNavItem;
SidebarNav.Footer = SidebarNavFooter;
SidebarNav.FeatureCard = SidebarNavFeatureCard;
SidebarNav.Account = SidebarNavAccount;
