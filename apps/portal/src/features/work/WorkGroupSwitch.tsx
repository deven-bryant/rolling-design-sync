import { useId, useRef } from 'react';
import { TooltipTriggerStateContext, type Key } from 'react-aria-components';
import { useTooltipTriggerState } from 'react-stately';
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
  const tooltip = useTooltipTriggerState({ delay: 0, closeDelay: 0 });
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
            onPointerEnter={() => tooltip.open(true)}
            onPointerLeave={() => tooltip.close(true)}
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
          <TooltipTriggerStateContext.Provider value={tooltip}>
            <Tooltip triggerRef={frameRef}>{frameDisabledReason}</Tooltip>
          </TooltipTriggerStateContext.Provider>
        </>
      )}
    </>
  );
}
