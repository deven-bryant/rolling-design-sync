import type { ReactNode, Ref } from 'react';
import {
  Checkbox as AriaCheckbox,
  type CheckboxProps as AriaCheckboxProps,
  Radio as AriaRadio,
  RadioGroup as AriaRadioGroup,
  type RadioGroupProps as AriaRadioGroupProps,
  type RadioProps as AriaRadioProps,
} from 'react-aria-components';
import { cx } from '../primitives';
import { CheckboxBase, type CheckboxSize } from './CheckboxBase';
import { SelectionText } from './SelectionText';

const rootClass = 'flex items-start gap-md outline-none cursor-pointer data-[disabled]:cursor-not-allowed';

/** A 16px base sits 2px down to center on the 20px first text line. */
const baseOffset = (size: CheckboxSize, hasText: boolean) => (hasText && size === 'sm' ? 'mt-xxs' : undefined);

export interface CheckboxProps extends Omit<AriaCheckboxProps, 'children' | 'className'> {
  /** Figma `Size`. */
  size?: CheckboxSize;
  /** Figma `Text`. Without it, give the checkbox an `aria-label`. */
  children?: ReactNode;
  /** Figma `Supporting text`. */
  supportingText?: ReactNode;
  className?: string;
  ref?: Ref<HTMLLabelElement>;
}

/** Figma `Checkbox` with `Type=Checkbox`: a React Aria checkbox, optionally labelled. */
export function Checkbox({ size = 'sm', children, supportingText, className, ref, ...rest }: CheckboxProps) {
  const hasText = children != null || supportingText != null;
  return (
    <AriaCheckbox ref={ref} {...rest} className={cx(rootClass, className)}>
      {({ isSelected, isIndeterminate, isFocusVisible, isDisabled }) => (
        <>
          <CheckboxBase
            type="checkbox"
            size={size}
            checked={isSelected}
            indeterminate={isIndeterminate}
            focusVisible={isFocusVisible}
            disabled={isDisabled}
            className={baseOffset(size, hasText)}
          />
          <SelectionText supportingText={supportingText}>{children}</SelectionText>
        </>
      )}
    </AriaCheckbox>
  );
}

export interface RadioProps extends Omit<AriaRadioProps, 'children' | 'className'> {
  /** Figma `Size`. */
  size?: CheckboxSize;
  /** Figma `Text`. Without it, give the radio an `aria-label`. */
  children?: ReactNode;
  /** Figma `Supporting text`. */
  supportingText?: ReactNode;
  className?: string;
  ref?: Ref<HTMLLabelElement>;
}

/** Figma `Checkbox` with `Type=Radio`: one option of a `Checkbox.RadioGroup`. */
export function Radio({ size = 'sm', children, supportingText, className, ref, ...rest }: RadioProps) {
  const hasText = children != null || supportingText != null;
  return (
    <AriaRadio ref={ref} {...rest} className={cx(rootClass, className)}>
      {({ isSelected, isFocusVisible, isDisabled }) => (
        <>
          <CheckboxBase
            type="radio"
            size={size}
            checked={isSelected}
            focusVisible={isFocusVisible}
            disabled={isDisabled}
            className={baseOffset(size, hasText)}
          />
          <SelectionText supportingText={supportingText}>{children}</SelectionText>
        </>
      )}
    </AriaRadio>
  );
}

export interface RadioGroupProps extends Omit<AriaRadioGroupProps, 'children' | 'className'> {
  children?: ReactNode;
  className?: string;
  ref?: Ref<HTMLDivElement>;
}

/** Groups `Checkbox.Radio` options: arrow keys move the selection. Layout is the caller's. */
export function RadioGroup({ className, ref, ...rest }: RadioGroupProps) {
  return <AriaRadioGroup ref={ref} {...rest} className={cx(className) || undefined} />;
}

Checkbox.Radio = Radio;
Checkbox.RadioGroup = RadioGroup;
Checkbox.Base = CheckboxBase;
