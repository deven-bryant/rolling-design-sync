import type { ReactNode, Ref } from 'react';
import {
  Breadcrumb as AriaBreadcrumb,
  Breadcrumbs as AriaBreadcrumbs,
  Link,
  RouterProvider,
  type BreadcrumbProps as AriaBreadcrumbProps,
  type BreadcrumbsProps as AriaBreadcrumbsProps,
} from 'react-aria-components';
import { cx, Icon, variants } from '../primitives';

export const breadcrumbButtonStyles = variants({
  base: 'flex items-center rounded-sm text-sm font-semibold text-quaternary outline-none data-focus-visible:ring-2 data-focus-visible:ring-focus-ring',
  variants: {
    icon: { true: 'p-xs', false: 'px-md py-xs' },
    current: {
      true: 'bg-primary_hover text-tertiary_hover',
      false: 'cursor-pointer data-hovered:bg-primary_hover data-hovered:text-tertiary_hover',
    },
  },
  defaults: { icon: false, current: false },
});

export interface BreadcrumbsProps extends Omit<AriaBreadcrumbsProps<object>, 'children' | 'className' | 'items'> {
  children: ReactNode;
  /** Accessible name of the `nav` landmark. */
  label?: string;
  /** Client-side navigation for item links: called with the `href` instead of a full page load. */
  onNavigate?: (href: string) => void;
  className?: string;
  ref?: Ref<HTMLElement>;
}

/** Figma `Breadcrumbs` (Type=Button, Divider=Chevron): a trail of breadcrumb buttons; the last item is the current page. */
export function Breadcrumbs({ children, label = 'Breadcrumbs', onNavigate, className, ref, ...rest }: BreadcrumbsProps) {
  const trail = (
    <nav ref={ref} aria-label={label} className={className}>
      <AriaBreadcrumbs {...rest} className="flex items-center gap-xs">
        {children}
      </AriaBreadcrumbs>
    </nav>
  );
  return onNavigate ? <RouterProvider navigate={onNavigate}>{trail}</RouterProvider> : trail;
}

export interface BreadcrumbsItemProps extends Omit<AriaBreadcrumbProps, 'children' | 'className'> {
  /** The page name; for a `home` item it becomes the accessible name of the icon. */
  children: string;
  href?: string;
  /** Figma `Icon=True`: the icon-only home item. */
  home?: boolean;
  className?: string;
}

function BreadcrumbsItem({ children, href, home = false, className, ...rest }: BreadcrumbsItemProps) {
  return (
    <AriaBreadcrumb {...rest} className={cx('flex items-center gap-xs', className)}>
      {({ isCurrent }) => (
        <>
          <Link
            href={href}
            aria-label={home ? children : undefined}
            className={breadcrumbButtonStyles({ icon: home, current: isCurrent })}
          >
            {home ? <Icon name="home-line" size="md" className="text-fg-quaternary" /> : children}
          </Link>
          {!isCurrent && <Icon name="chevron-right" size="sm" className="text-fg-quaternary" />}
        </>
      )}
    </AriaBreadcrumb>
  );
}

Breadcrumbs.Item = BreadcrumbsItem;
