import type { ReactNode } from 'react';
import { Text } from '../primitives';

export interface SelectionTextProps {
  children?: ReactNode;
  supportingText?: ReactNode;
}

/** The `Text and supporting text` frame beside a checkbox or radio. */
export function SelectionText({ children, supportingText }: SelectionTextProps) {
  if (children == null && supportingText == null) return null;
  return (
    <span className="flex min-w-0 flex-col">
      {children != null && (
        <Text weight="medium" color="secondary">
          {children}
        </Text>
      )}
      {supportingText != null && <Text color="tertiary">{supportingText}</Text>}
    </span>
  );
}
