import type { ReactNode, Ref } from 'react';
import { ToggleButton, ToggleButtonGroup, type Key, type ToggleButtonGroupProps, type ToggleButtonProps } from 'react-aria-components';
import { cx } from '../primitives';

export const buttonGroupClassName = 'inline-flex rounded-md shadow-xs';

export const buttonGroupItemClassName = [
  'relative -ml-px inline-flex cursor-pointer items-center justify-center gap-sm whitespace-nowrap first:ml-0 first:rounded-l-md last:rounded-r-md',
  'min-h-10 bg-primary px-xl py-md text-sm font-semibold text-secondary ring-1 ring-primary ring-inset outline-focus-ring transition duration-100 ease-linear',
  'data-hovered:bg-primary_hover data-hovered:text-secondary_hover data-selected:bg-active data-selected:text-secondary_hover',
  'data-focus-visible:z-10 data-focus-visible:outline-2 data-focus-visible:outline-offset-2',
  'data-disabled:cursor-not-allowed data-disabled:bg-primary data-disabled:text-disabled',
].join(' ');

export interface ButtonGroupProps extends Omit<ToggleButtonGroupProps, 'className' | 'style' | 'selectionMode' | 'children'> {
  /** `ButtonGroup.Item`s. */
  children: ReactNode;
  className?: string;
  ref?: Ref<HTMLDivElement>;
}

/**
 * Figma `Button group` (`Icon=False`): a segmented control. One item is current at a time; pressing another
 * moves the selection (`selectedKeys` / `defaultSelectedKeys` / `onSelectionChange`, React Aria `ToggleButtonGroup`).
 */
function ButtonGroupRoot({ className, disallowEmptySelection = true, ref, ...rest }: ButtonGroupProps) {
  return (
    <ToggleButtonGroup
      ref={ref}
      selectionMode="single"
      disallowEmptySelection={disallowEmptySelection}
      {...rest}
      className={cx(buttonGroupClassName, className)}
    />
  );
}

export interface ButtonGroupItemProps extends Omit<ToggleButtonProps, 'className' | 'style' | 'children' | 'id'> {
  /** The item's key in the group's selection. */
  id: Key;
  /** The label (Figma `Text`). */
  children: ReactNode;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
}

/** Figma `_Button group base`; `Current=True` is the selected item. */
function ButtonGroupItem({ className, ref, ...rest }: ButtonGroupItemProps) {
  return <ToggleButton ref={ref} {...rest} className={cx(buttonGroupItemClassName, className)} />;
}

export const ButtonGroup = Object.assign(ButtonGroupRoot, { Item: ButtonGroupItem });
