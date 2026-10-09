import { useId, useRef, useState } from 'react';
import type { Key } from 'react-aria-components';
import { ButtonGroup } from '../../components/ButtonGroup';
import { Tooltip } from '../../components/Tooltip';
import { VisuallyHidden } from '../../components/primitives';
import type { WorkGroup } from './api';

export interface WorkGroupSwitchProps {
  group: WorkGroup;
  onGroupChange: (group: WorkGroup) => void;
  /** Disables *By frame* and says why in a tooltip (e.g. several scopes are selected; frames need one root). */
  frameDisabledReason?: string;
  className?: string;
}

const isGroup = (key: Key): key is WorkGroup => key === 'component' || key === 'frame';

/** By component · By frame. */
export function WorkGroupSwitch({ group, onGroupChange, frameDisabledReason, className }: WorkGroupSwitchProps) {
  const reasonId = useId();
  const frameRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <ButtonGroup
        aria-label="Group work items"
        aria-describedby={frameDisabledReason ? reasonId : undefined}
        className={className}
        selectedKeys={[group]}
        onSelectionChange={keys => {
          const [key] = [...keys];
          if (key !== undefined && isGroup(key) && key !== group) onGroupChange(key);
        }}
      >
        <ButtonGroup.Item id="component">By component</ButtonGroup.Item>
        {frameDisabledReason ? (
          <span
            ref={frameRef}
            className="-ml-px inline-flex"
            onPointerEnter={() => setOpen(true)}
            onPointerLeave={() => setOpen(false)}
          >
            <ButtonGroup.Item id="frame" isDisabled className="pointer-events-none">
              By frame
            </ButtonGroup.Item>
          </span>
        ) : (
          <ButtonGroup.Item id="frame">By frame</ButtonGroup.Item>
        )}
      </ButtonGroup>
      {frameDisabledReason && (
        <>
          <VisuallyHidden id={reasonId}>{frameDisabledReason}</VisuallyHidden>
          <Tooltip triggerRef={frameRef} isOpen={open} onOpenChange={setOpen}>
            {frameDisabledReason}
          </Tooltip>
        </>
      )}
    </>
  );
}
