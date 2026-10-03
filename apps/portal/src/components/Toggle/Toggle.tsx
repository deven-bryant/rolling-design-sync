import type { ReactNode, Ref } from 'react';
import { Switch as AriaSwitch, type SwitchProps as AriaSwitchProps } from 'react-aria-components';
import { cx, Text } from '../primitives';
import { ToggleBase, type ToggleSize } from './ToggleBase';

export interface ToggleProps extends Omit<AriaSwitchProps, 'children' | 'className'> {
  /** Figma `Size`. */
  size?: ToggleSize;
  /** Figma `Text`. Without it, give the toggle an `aria-label`. */
  children?: ReactNode;
  /** Figma `Supporting text`. */
  supportingText?: ReactNode;
  className?: string;
  ref?: Ref<HTMLLabelElement>;
}

/** Figma `Toggle`: a React Aria switch with optional text and supporting text. */
export function Toggle({ size = 'sm', children, supportingText, className, ref, ...rest }: ToggleProps) {
  const hasText = children != null || supportingText != null;
  return (
    <AriaSwitch
      ref={ref}
      {...rest}
      className={cx('flex items-start gap-md outline-none cursor-pointer data-[disabled]:cursor-not-allowed', className)}
    >
      {({ isSelected, isFocusVisible, isDisabled }) => (
        <>
          <ToggleBase size={size} pressed={isSelected} focusVisible={isFocusVisible} disabled={isDisabled} />
          {hasText && (
            <span className="flex min-w-0 flex-col">
              {children != null && (
                <Text weight="medium" color="secondary">
                  {children}
                </Text>
              )}
              {supportingText != null && <Text color="tertiary">{supportingText}</Text>}
            </span>
          )}
        </>
      )}
    </AriaSwitch>
  );
}

Toggle.Base = ToggleBase;
