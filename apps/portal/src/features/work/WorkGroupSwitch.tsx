import type { Key } from 'react-aria-components';
import { ButtonGroup } from '../../components/ButtonGroup';
import type { WorkGroup } from './api';

export interface WorkGroupSwitchProps {
  group: WorkGroup;
  onGroupChange: (group: WorkGroup) => void;
  /** "Flat list": the Nodes tab. */
  onShowFlatList: () => void;
  className?: string;
}

const isGroup = (key: Key): key is WorkGroup => key === 'component' || key === 'frame';

/** By component · By frame · Flat list. */
export function WorkGroupSwitch({ group, onGroupChange, onShowFlatList, className }: WorkGroupSwitchProps) {
  return (
    <ButtonGroup
      aria-label="Group work items"
      className={className}
      selectedKeys={[group]}
      onSelectionChange={keys => {
        const [key] = [...keys];
        if (key === 'flat') onShowFlatList();
        else if (key !== undefined && isGroup(key) && key !== group) onGroupChange(key);
      }}
    >
      <ButtonGroup.Item id="component">By component</ButtonGroup.Item>
      <ButtonGroup.Item id="frame">By frame</ButtonGroup.Item>
      <ButtonGroup.Item id="flat">Flat list</ButtonGroup.Item>
    </ButtonGroup>
  );
}
