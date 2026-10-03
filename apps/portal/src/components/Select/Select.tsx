import type { ReactNode, Ref } from 'react';
import {
  Button as AriaButton,
  Select as AriaSelect,
  type SelectProps as AriaSelectProps,
  SelectValue as AriaSelectValue,
} from 'react-aria-components';
import { InputHint, inputFrameStyles, type InputSize } from '../Input/InputParts';
import { cx, Icon } from '../primitives';
import { SelectItem } from './SelectItem';
import { FieldLabel, OptionsPopover } from './SelectParts';
import { SelectSearch } from './SelectSearch';

export interface SelectProps<T extends object = object>
  extends Omit<AriaSelectProps<T, 'single'>, 'children' | 'className' | 'placeholder'> {
  /** Figma `Size`. */
  size?: InputSize;
  /** Figma `Label`. Without it, give the select an `aria-label`. */
  label?: ReactNode;
  /** Figma `Hint text`. */
  hint?: ReactNode;
  /** Figma `Required *`. */
  required?: boolean;
  /** Figma `Help icon`: shown beside the label, with this text as its accessible name. */
  tooltip?: string;
  /** Figma `Type=Icon leading` / `Icon swap`. */
  iconLeading?: ReactNode;
  /** Figma `State=Placeholder` text. */
  placeholder?: string;
  /** Dynamic options; render each with `children` as a function. */
  items?: Iterable<T>;
  /** `<Select.Item>` elements, or a render function for `items`. */
  children: ReactNode | ((item: T) => ReactNode);
  className?: string;
  ref?: Ref<HTMLDivElement>;
}

/** Figma `Select` (`Type=Default`): a React Aria select with label, hint and a popover list box. */
export function Select<T extends object = object>({
  size = 'sm',
  label,
  hint,
  required,
  tooltip,
  iconLeading,
  placeholder,
  items,
  children,
  className,
  ref,
  ...rest
}: SelectProps<T>) {
  return (
    <AriaSelect ref={ref} isRequired={required} placeholder={placeholder} {...rest} className={cx('group flex w-full flex-col gap-sm', className)}>
      <FieldLabel label={label} required={required} tooltip={tooltip} />
      <AriaButton
        className={inputFrameStyles({
          size,
          className:
            'cursor-pointer text-left data-[focus-visible]:outline-2 data-[focus-visible]:-outline-offset-1 data-[disabled]:cursor-not-allowed data-[disabled]:border-disabled data-[disabled]:bg-disabled_subtle data-[disabled]:shadow-none',
        })}
      >
        {iconLeading != null && <span className="flex shrink-0 text-fg-quaternary">{iconLeading}</span>}
        <AriaSelectValue className="flex min-w-0 flex-1 items-center gap-md truncate text-md font-medium text-primary data-[placeholder]:font-regular data-[placeholder]:text-placeholder" />
        <Icon name="chevron-down" size="sm" className="text-fg-quaternary group-data-[disabled]:text-fg-disabled_subtle" />
      </AriaButton>
      {hint != null && <InputHint>{hint}</InputHint>}
      <OptionsPopover items={items}>{children}</OptionsPopover>
    </AriaSelect>
  );
}

Select.Item = SelectItem;
Select.Search = SelectSearch;
