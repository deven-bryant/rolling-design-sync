import type { ReactNode, Ref } from 'react';
import { TextArea as AriaTextArea, TextField as AriaTextField, type TextFieldProps as AriaTextFieldProps } from 'react-aria-components';
import { cx } from '../primitives';
import { HelpIcon } from './HelpIcon';
import { InputHint, InputLabel } from './InputParts';

export interface TextareaProps extends Omit<AriaTextFieldProps, 'children' | 'className'> {
  /** Figma `Label`. Without it, give the field an `aria-label`. */
  label?: ReactNode;
  /** Figma `Hint text`. */
  hint?: ReactNode;
  /** Figma `Required *`: marks the label and makes the field required. */
  required?: boolean;
  /** Figma `Help icon`: shown beside the label when set, with this text as its accessible name. */
  tooltip?: string;
  /** Figma `State=Placeholder` text. */
  placeholder?: string;
  /** Visible rows; the field is vertically resizable. */
  rows?: number;
  className?: string;
  /** Forwarded to the `<textarea>`. */
  ref?: Ref<HTMLTextAreaElement>;
}

/**
 * Figma `Textarea input field`: a React Aria multi-line text field with label (required asterisk, help icon), a
 * 12/14px padded frame with a resize handle, and hint text.
 */
export function Textarea({ label, hint, required, tooltip, placeholder, rows = 5, className, ref, ...rest }: TextareaProps) {
  return (
    <AriaTextField isRequired={required} {...rest} className={cx('group flex w-full flex-col gap-sm', className)}>
      {label != null && (
        <span className="inline-flex items-center gap-xxs">
          <InputLabel required={required}>{label}</InputLabel>
          {tooltip && <HelpIcon label={tooltip} />}
        </span>
      )}
      <AriaTextArea
        ref={ref}
        rows={rows}
        placeholder={placeholder}
        className={cx(
          'min-h-32 w-full min-w-0 resize-y rounded-md border border-primary bg-primary px-3.5 py-lg text-md font-regular text-primary shadow-xs outline-focus-ring',
          'placeholder:text-placeholder focus:outline-2 focus:-outline-offset-1',
          'group-data-[invalid]:border-error_subtle group-data-[invalid]:outline-focus-ring-error',
          'disabled:cursor-not-allowed disabled:border-disabled disabled:bg-disabled_subtle disabled:text-disabled disabled:shadow-none',
        )}
      />
      {hint != null && <InputHint>{hint}</InputHint>}
    </AriaTextField>
  );
}
