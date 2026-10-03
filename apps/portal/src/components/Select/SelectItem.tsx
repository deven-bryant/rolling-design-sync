import type { ReactNode, Ref } from 'react';
import { ListBoxItem, type ListBoxItemProps } from 'react-aria-components';
import { cx } from '../primitives';

export interface SelectItemProps extends Omit<ListBoxItemProps, 'children' | 'className'> {
  /** Figma `Text`. */
  children: ReactNode;
  /** Figma `Supporting text`, e.g. a handle beside a name. */
  supportingText?: ReactNode;
  className?: string;
  ref?: Ref<HTMLDivElement>;
}

/** One option. Its content is also what the closed select shows as its value. */
export function SelectItem({ children, supportingText, textValue, className, ref, ...rest }: SelectItemProps) {
  return (
    <ListBoxItem
      ref={ref}
      textValue={textValue ?? (typeof children === 'string' ? children : undefined)}
      {...rest}
      className={cx(
        'mx-xs flex cursor-pointer items-center rounded-sm px-md py-md outline-none data-[focused]:bg-primary_hover data-[selected]:bg-active data-[disabled]:cursor-not-allowed data-[disabled]:text-disabled',
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-md">
        <span className="truncate text-md font-medium text-primary">{children}</span>
        {supportingText != null && <span className="truncate text-md font-regular text-tertiary">{supportingText}</span>}
      </span>
    </ListBoxItem>
  );
}
