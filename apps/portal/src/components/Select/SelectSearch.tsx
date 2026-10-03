import type { ReactNode, Ref } from 'react';
import {
  ComboBox as AriaComboBox,
  type ComboBoxProps as AriaComboBoxProps,
  Group as AriaGroup,
  Input as AriaInput,
} from 'react-aria-components';
import { InputHint, inputFrameStyles, inputTextClass, type InputSize } from '../Input/InputParts';
import { cx, Icon } from '../primitives';
import { FieldLabel, OptionsPopover } from './SelectParts';

export interface SelectSearchProps<T extends object = object>
  extends Omit<AriaComboBoxProps<T, 'single'>, 'children' | 'className'> {
  /** Figma `Size`. */
  size?: InputSize;
  /** Figma `Label`. Without it, give the field an `aria-label`. */
  label?: ReactNode;
  /** Figma `Hint text`. */
  hint?: ReactNode;
  /** Figma `Required *`. */
  required?: boolean;
  /** Figma `Help icon`: shown beside the label, with this text as its accessible name. */
  tooltip?: string;
  /** Figma `Shortcut`: a key hint such as `⌘K`. Visual only; bind the key in the page. */
  shortcut?: ReactNode;
  /** Figma `State=Placeholder` text. */
  placeholder?: string;
  items?: Iterable<T>;
  /** `<Select.Item>` elements, or a render function for `items`. */
  children: ReactNode | ((item: T) => ReactNode);
  className?: string;
  /** Forwarded to the `<input>`. */
  ref?: Ref<HTMLInputElement>;
}

/** Figma `Select` (`Type=Search`): a React Aria combo box that filters its options as you type. */
export function SelectSearch<T extends object = object>({
  size = 'sm',
  label,
  hint,
  required,
  tooltip,
  shortcut,
  placeholder,
  items,
  children,
  className,
  ref,
  ...rest
}: SelectSearchProps<T>) {
  return (
    <AriaComboBox isRequired={required} {...rest} className={cx('group flex w-full flex-col gap-sm', className)}>
      <FieldLabel label={label} required={required} tooltip={tooltip} />
      <AriaGroup
        className={inputFrameStyles({
          size,
          className:
            'data-[focus-within]:outline-2 data-[focus-within]:-outline-offset-1 data-[disabled]:border-disabled data-[disabled]:bg-disabled_subtle data-[disabled]:shadow-none',
        })}
      >
        <Icon name="search-lg" size="md" className="shrink-0 text-fg-quaternary" />
        <AriaInput ref={ref} placeholder={placeholder} className={inputTextClass} />
        {shortcut != null && (
          <kbd className="shrink-0 rounded-xs border border-secondary px-xs py-px font-sans text-xs font-medium text-quaternary">
            {shortcut}
          </kbd>
        )}
      </AriaGroup>
      {hint != null && <InputHint>{hint}</InputHint>}
      <OptionsPopover items={items}>{children}</OptionsPopover>
    </AriaComboBox>
  );
}
