import type { ReactNode, Ref } from 'react';
import { Input as AriaInput, TextField as AriaTextField, type TextFieldProps as AriaTextFieldProps } from 'react-aria-components';
import { cx } from '../primitives';
import { HelpIcon } from './HelpIcon';
import { InputHint, InputLabel, inputFrameStyles, inputTextClass, type InputSize } from './InputParts';

export interface InputProps extends Omit<AriaTextFieldProps, 'children' | 'className'> {
  /** Figma `Size`. */
  size?: InputSize;
  /** Figma `Label`. Without it, give the field an `aria-label`. */
  label?: ReactNode;
  /** Figma `Hint text`. */
  hint?: ReactNode;
  /** Figma `Required *`: marks the label and makes the field required. */
  required?: boolean;
  /** Figma `Help icon`: shown when set, with this text as its accessible name. */
  tooltip?: string;
  /** Figma `Icon leading` / `Icon swap`, e.g. `<Icon name="mail-01" size="md" />`. */
  iconLeading?: ReactNode;
  /** Figma `State=Placeholder` text. */
  placeholder?: string;
  className?: string;
  /** Forwarded to the `<input>`. */
  ref?: Ref<HTMLInputElement>;
}

/** Figma `Input field`: a React Aria text field with label, hint, leading icon and help icon. */
export function Input({
  size = 'sm',
  label,
  hint,
  required,
  tooltip,
  iconLeading,
  placeholder,
  className,
  ref,
  ...rest
}: InputProps) {
  return (
    <AriaTextField isRequired={required} {...rest} className={cx('group flex w-full flex-col gap-sm', className)}>
      {label != null && <InputLabel required={required}>{label}</InputLabel>}
      <div
        className={inputFrameStyles({
          size,
          className:
            'focus-within:outline-2 focus-within:-outline-offset-1 group-data-[disabled]:border-disabled group-data-[disabled]:bg-disabled_subtle group-data-[disabled]:shadow-none',
        })}
      >
        {iconLeading != null && <span className="flex shrink-0 text-fg-quaternary">{iconLeading}</span>}
        <AriaInput ref={ref} placeholder={placeholder} className={inputTextClass} />
        {tooltip && <HelpIcon label={tooltip} />}
      </div>
      {hint != null && <InputHint>{hint}</InputHint>}
    </AriaTextField>
  );
}

Input.Label = InputLabel;
Input.Hint = InputHint;
Input.HelpIcon = HelpIcon;
