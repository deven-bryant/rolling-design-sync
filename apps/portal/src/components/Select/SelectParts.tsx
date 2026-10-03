import type { ReactNode } from 'react';
import { ListBox, Popover } from 'react-aria-components';
import { HelpIcon } from '../Input/HelpIcon';
import { InputLabel } from '../Input/InputParts';

export interface FieldLabelProps {
  label?: ReactNode;
  required?: boolean;
  tooltip?: string;
}

/** `Label wrapper`: label, asterisk and help icon. The icon sits outside `<label>` so it stays out of the accessible name. */
export function FieldLabel({ label, required, tooltip }: FieldLabelProps) {
  if (label == null) return null;
  return (
    <span className="flex items-center gap-xxs">
      <InputLabel required={required}>{label}</InputLabel>
      {tooltip && <HelpIcon label={tooltip} />}
    </span>
  );
}

export interface OptionsPopoverProps<T> {
  items?: Iterable<T>;
  children: ReactNode | ((item: T) => ReactNode);
}

export function OptionsPopover<T extends object>({ items, children }: OptionsPopoverProps<T>) {
  return (
    <Popover className="w-(--trigger-width) rounded-md border border-secondary bg-primary shadow-lg outline-none">
      <ListBox items={items} className="max-h-80 overflow-auto py-xs outline-none">
        {children}
      </ListBox>
    </Popover>
  );
}
