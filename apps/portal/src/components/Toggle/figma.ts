/**
 * Figma ↔ code for Toggle (Portal file `PORTAL_DESIGN_FILE`, Section 1).
 * Only `Type=Default` exists in the synced design, so there is no `type` prop. `State=Default`
 * covers rest; focus and disabled come from React Aria.
 */
export const figmaToggle = {
  component: 'Toggle',
  setId: '9:3128',
  properties: {
    Pressed: 'isSelected',
    Size: 'size',
    Text: 'children',
    'Supporting text#3281:833': 'supportingText',
  },
  variants: [
    {
      nodeId: '9:3151',
      key: '41b87d56b9c1ee3d078b9966034b81c71b8ea051',
      name: 'Type=Default, Pressed=True, Size=sm, Text=True, State=Default',
      code: '<Toggle size="sm" isSelected supportingText="…">…</Toggle>',
    },
  ],
} as const;

export const figmaToggleBase = {
  component: 'Toggle.Base',
  setId: '9:3053',
  properties: { Pressed: 'pressed', Size: 'size' },
  variants: [
    {
      nodeId: '9:3064',
      key: '17fddff5e6fcd33be7872cf76e5f83ce71918d4d',
      name: 'Type=Default, Pressed=True, Size=sm, State=Default',
      code: '<Toggle.Base size="sm" pressed />',
    },
  ],
} as const;
