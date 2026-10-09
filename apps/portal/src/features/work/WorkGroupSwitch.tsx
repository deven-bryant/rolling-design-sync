import type { Key } from 'react-aria-components';
import { ButtonGroup } from '../../components/ButtonGroup';
import type { WorkGroup } from './api';

export interface WorkGroupSwitchProps {
  group: WorkGroup;
  onGroupChange: (group: WorkGroup) => void;
  className?: string;
}

const isGroup = (key: Key): key is WorkGroup => key === 'component' || key === 'frame';

/** By component · By frame. */
export function WorkGroupSwitch({ group, onGroupChange, className }: WorkGroupSwitchProps) {
  return (
    <ButtonGroup
      aria-label="Group work items"
      className={className}
      selectedKeys={[group]}
      onSelectionChange={keys => {
        const [key] = [...keys];
        if (key !== undefined && isGroup(key) && key !== group) onGroupChange(key);
      }}
    >
      <ButtonGroup.Item id="component">By component</ButtonGroup.Item>
      <ButtonGroup.Item id="frame">By frame</ButtonGroup.Item>
    </ButtonGroup>
  );
}
