import type { Ref } from 'react';
import { Label as AriaLabel, type LabelProps as AriaLabelProps, Text as AriaText, type TextProps as AriaTextProps } from 'react-aria-components';
import { cx, textStyles, variants } from '../primitives';

export type InputSize = 'sm';

/** The `Input` frame shared by text fields and selects. */
export const inputFrameStyles = variants({
  base: 'flex w-full min-w-0 items-center gap-md rounded-md border border-primary bg-primary shadow-xs outline-focus-ring',
  variants: {
    size: { sm: 'px-lg py-md' },
  },
  defaults: { size: 'sm' },
});

/** The value / placeholder text inside the frame. */
export const inputTextClass =
  'min-w-0 flex-1 bg-transparent text-md font-regular text-primary outline-none placeholder:text-placeholder disabled:cursor-not-allowed disabled:text-disabled';

export interface InputLabelProps extends AriaLabelProps {
  /** Figma `Required *`: appends the brand asterisk. */
  required?: boolean;
  ref?: Ref<HTMLLabelElement>;
}

/** The field label (`Label` + `Asterisk`). Inside a React Aria field it labels the control automatically. */
export function InputLabel({ required, children, className, ref, ...rest }: InputLabelProps) {
  return (
    <AriaLabel
      ref={ref}
      {...rest}
      className={textStyles({ size: 'sm', weight: 'medium', color: 'secondary', className: cx('inline-flex items-center gap-xxs', className) })}
    >
      {children}
      {required && (
        <span aria-hidden className="text-brand-tertiary">
          *
        </span>
      )}
    </AriaLabel>
  );
}

export interface InputHintProps extends Omit<AriaTextProps, 'slot'> {
  ref?: Ref<HTMLElement>;
}

/** The `Hint text` under a field. Inside a React Aria field it becomes the control's description. */
export function InputHint({ className, ref, ...rest }: InputHintProps) {
  return <AriaText ref={ref} slot="description" {...rest} className={textStyles({ size: 'sm', color: 'tertiary', className })} />;
}
