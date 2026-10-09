/**
 * Figma ↔ code for Toggle (Portal file `PORTAL_DESIGN_FILE`, Section 1).
 * Only `Type=Default` exists in the synced design, so there is no `type` prop. `State=Default`
 * covers rest; focus and disabled come from React Aria.
 */
export const figmaToggle = {
  component: 'Toggle',
  setId: '111:7851',
  properties: {
    Pressed: 'isSelected',
    Size: 'size',
    Text: 'children',
    'Supporting text#3281:833': 'supportingText',
  },
  variants: [
    {
      nodeId: '111:7874',
      key: 'c754faee13716335d5a6d57ca29fd82891041470',
      name: 'Type=Default, Pressed=True, Size=sm, Text=True, State=Default',
      code: '<Toggle size="sm" isSelected supportingText="…">…</Toggle>',
    },
    {
      nodeId: '111:7900',
      key: '9cddb275cd2959ae35f115c3fef8b58083e10447',
      name: 'Type=Default, Pressed=False, Size=md, Text=False, State=Default',
      code: '<Toggle size="md" aria-label="…" />',
    },
    {
      nodeId: '111:7868',
      key: 'd07607591a06576de05c8018955cc88e21605565',
      name: 'Type=Default, Pressed=True, Size=md, Text=False, State=Default',
      code: '<Toggle size="md" isSelected aria-label="…" />',
    },
  ],
} as const;

export const figmaToggleBase = {
  component: 'Toggle.Base',
  setId: '111:7776',
  properties: { Pressed: 'pressed', Size: 'size' },
  variants: [
    {
      nodeId: '111:7787',
      key: '1a8e25f0cac99e1e47c26f15c474d81accb19e06',
      name: 'Type=Default, Pressed=True, Size=sm, State=Default',
      code: '<Toggle.Base size="sm" pressed />',
    },
    {
      nodeId: '111:7801',
      key: '65772855be5be4954cc34163dfa630dcfb120bbe',
      name: 'Type=Default, Pressed=False, Size=md, State=Default',
      code: '<Toggle.Base size="md" />',
    },
    {
      nodeId: '111:7785',
      key: 'e5ad6d04c21d1eacc443daabf7bae7f0a2e77bb9',
      name: 'Type=Default, Pressed=True, Size=md, State=Default',
      code: '<Toggle.Base size="md" pressed />',
    },
  ],
} as const;
