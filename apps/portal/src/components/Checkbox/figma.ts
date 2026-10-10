/**
 * Figma ↔ code for the Checkbox family (Portal file `PORTAL_DESIGN_FILE`, Section 1).
 * `Type=Checkbox` renders `<Checkbox>`, `Type=Radio` renders `<Checkbox.Radio>` inside a
 * `<Checkbox.RadioGroup>`; `_Checkbox base` is `<Checkbox.Base>`. `State=Default` covers rest;
 * focus and disabled come from React Aria.
 */
export const figmaCheckbox = {
  component: 'Checkbox',
  setId: '111:8157',
  properties: {
    Checked: 'isSelected',
    Indeterminate: 'isIndeterminate',
    Size: 'size',
    Type: 'Checkbox → <Checkbox>, Radio → <Checkbox.Radio>',
    Text: 'children',
    'Supporting text#3281:1085': 'supportingText',
  },
  variants: [
    {
      nodeId: '111:8210',
      key: '0bf54b33758dc2d536b700bd486582289c69d8e0',
      name: 'Checked=True, Indeterminate=False, Size=sm, Type=Radio, Text=False, State=Default',
      code: '<Checkbox.Radio size="sm" value="…" aria-label="…" /> (selected)',
    },
    {
      nodeId: '111:8227',
      key: 'fd342419445e9e5b3412ae861b1c7ba96ea757b7',
      name: 'Checked=False, Indeterminate=False, Size=sm, Type=Radio, Text=False, State=Default',
      code: '<Checkbox.Radio size="sm" value="…" aria-label="…" />',
    },
    {
      nodeId: '111:8228',
      key: '3210e4c9a64a893e68bf5d0d460be97897ab41a2',
      name: 'Checked=False, Indeterminate=False, Size=md, Type=Checkbox, Text=False, State=Default',
      code: '<Checkbox size="md" aria-label="…" />',
    },
  ],
} as const;

export const figmaCheckboxBase = {
  component: 'Checkbox.Base',
  setId: '111:8092',
  properties: { Checked: 'checked', Indeterminate: 'indeterminate', Size: 'size', Type: 'type' },
  variants: [
    {
      nodeId: '111:8094',
      key: 'e95d2be401557359391c8b76be1c880ae3bc0104',
      name: 'Checked=False, Indeterminate=False, Size=sm, Type=Radio, State=Default',
      code: '<Checkbox.Base size="sm" type="radio" />',
    },
    {
      nodeId: '111:8103',
      key: 'f0fd5a19cb8b19db2f8d3d88418f3634f294977a',
      name: 'Checked=True, Indeterminate=False, Size=sm, Type=Radio, State=Default',
      code: '<Checkbox.Base size="sm" type="radio" checked />',
    },
    {
      nodeId: '111:8113',
      key: 'b61300c6dd27da4e7ac841582cc9518797a217d4',
      name: 'Checked=False, Indeterminate=False, Size=md, Type=Checkbox, State=Default',
      code: '<Checkbox.Base size="md" type="checkbox" />',
    },
  ],
} as const;
