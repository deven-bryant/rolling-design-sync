import type { ReactElement, ReactNode } from 'react';
import {
  Button,
  Header,
  Keyboard,
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  MenuSection as AriaMenuSection,
  MenuTrigger,
  Popover,
  Separator,
  type MenuItemProps as AriaMenuItemProps,
  type MenuProps as AriaMenuProps,
  type MenuSectionProps as AriaMenuSectionProps,
  type MenuTriggerProps,
  type PopoverProps,
} from 'react-aria-components';
import { cx, Icon, variants, type IconName } from '../primitives';

export const menuTriggerStyles = variants({
  base: 'flex cursor-pointer rounded-xs text-fg-quaternary outline-none data-hovered:text-fg-quaternary_hover data-pressed:text-fg-quaternary_hover data-focus-visible:ring-2 data-focus-visible:ring-focus-ring',
  variants: {},
});

export const menuItemStyles = variants({
  base: 'flex items-center gap-lg rounded-sm',
  variants: {
    type: { 'menu-item': 'p-md', account: 'px-md py-sm' },
    current: { true: 'bg-primary_hover', false: '' },
    highlighted: { true: 'bg-primary_hover', false: '' },
  },
  defaults: { type: 'menu-item', current: false, highlighted: false },
});

export interface MenuProps<T> extends Omit<AriaMenuProps<T>, 'className'>, Pick<MenuTriggerProps, 'isOpen' | 'defaultOpen' | 'onOpenChange'> {
  /** Accessible name of the trigger (and so of the menu). */
  label: string;
  /** A custom pressable trigger (a React Aria `Button`); defaults to the Figma `Type=Icon` dots-vertical trigger. */
  trigger?: ReactElement;
  placement?: PopoverProps['placement'];
  className?: string;
  popoverClassName?: string;
}

/** Figma `Dropdown` (Type=Icon): a dots-vertical trigger for card headers that opens a React Aria menu. */
export function Menu<T extends object>({
  label,
  trigger,
  isOpen,
  defaultOpen,
  onOpenChange,
  placement = 'bottom end',
  className,
  popoverClassName,
  ...rest
}: MenuProps<T>) {
  return (
    <MenuTrigger isOpen={isOpen} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {trigger ?? (
        <Button aria-label={label} className={menuTriggerStyles()}>
          <Icon name="dots-vertical" size="md" />
        </Button>
      )}
      <Popover
        placement={placement}
        offset={4}
        className={cx('w-66 overflow-hidden rounded-xl border border-secondary_alt bg-primary shadow-lg outline-none', popoverClassName)}
      >
        <AriaMenu<T> aria-label={label} {...rest} className={cx('flex flex-col gap-xxs py-sm outline-none', className)} />
      </Popover>
    </MenuTrigger>
  );
}

export interface MenuItemProps extends Omit<AriaMenuItemProps, 'className' | 'children'> {
  children: ReactNode;
  /** Figma `Type`: a plain `menu-item`, or an `account` row with a radio indicator (use in a single-selection menu). */
  type?: 'menu-item' | 'account';
  /** Figma `Icon`: a leading icon. */
  icon?: IconName;
  /** Figma `Shortcut`: a keyboard shortcut hint, e.g. `⌘K->P`. */
  shortcut?: string;
  className?: string;
}

function MenuItem({ children, type = 'menu-item', icon, shortcut, className, textValue, ...rest }: MenuItemProps) {
  return (
    <AriaMenuItem
      {...rest}
      textValue={textValue ?? (typeof children === 'string' ? children : undefined)}
      className={cx('cursor-pointer px-sm outline-none', className)}
    >
      {({ isFocused, isSelected }) => (
        <div className={menuItemStyles({ type, current: isSelected, highlighted: isFocused })}>
          <span className="flex min-w-0 flex-1 items-center gap-md text-sm font-semibold text-secondary">
            {icon && <Icon name={icon} size="md" className="text-fg-quaternary" />}
            {children}
          </span>
          {shortcut && (
            <Keyboard className="rounded-xs border border-secondary px-xs py-px text-xs font-medium text-tertiary">
              {shortcut}
            </Keyboard>
          )}
          {type === 'account' && (
            <span
              aria-hidden
              className={cx(
                'flex size-4 shrink-0 items-center justify-center rounded-full',
                isSelected ? 'bg-brand-solid' : 'border border-primary',
              )}
            >
              {isSelected && <span className="size-1.5 rounded-full bg-fg-white" />}
            </span>
          )}
        </div>
      )}
    </AriaMenuItem>
  );
}

export interface MenuSectionProps<T> extends Omit<AriaMenuSectionProps<T>, 'className' | 'children'> {
  children: ReactNode;
  /** A visible section heading. */
  title?: ReactNode;
  className?: string;
}

function MenuSection<T extends object>({ title, children, className, ...rest }: MenuSectionProps<T>) {
  return (
    <AriaMenuSection<T> {...rest} className={cx('flex flex-col gap-xxs', className)}>
      {title && <Header className="px-lg pt-sm pb-xs text-xs font-semibold text-tertiary">{title}</Header>}
      {children}
    </AriaMenuSection>
  );
}

function MenuSeparator({ className }: { className?: string }) {
  return <Separator className={cx('my-xs border-t border-secondary', className)} />;
}

Menu.Item = MenuItem;
Menu.Section = MenuSection;
Menu.Separator = MenuSeparator;
