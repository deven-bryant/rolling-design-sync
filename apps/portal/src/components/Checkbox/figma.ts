/**
 * Figma ↔ code for the Checkbox family (Portal file `PORTAL_DESIGN_FILE`, Section 1).
 * `Type=Checkbox` renders `<Checkbox>`, `Type=Radio` renders `<Checkbox.Radio>` inside a
 * `<Checkbox.RadioGroup>`; `_Checkbox base` is `<Checkbox.Base>`. `State=Default` covers rest;
 * focus and disabled come from React Aria.
 */
export const figmaCheckbox = {
  component: 'Checkbox',
  setId: '9:5664',
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
      nodeId: '9:5717',
      key: '50dbd945cfa0cd8c5143c8ea405fe671bdc6f0b8',
      name: 'Checked=True, Indeterminate=False, Size=sm, Type=Radio, Text=False, State=Default',
      code: '<Checkbox.Radio size="sm" value="…" aria-label="…" /> (selected)',
    },
    {
      nodeId: '9:5734',
      key: 'd578449228a7e3ae5bdd31ddfb078574df70dff5',
      name: 'Checked=False, Indeterminate=False, Size=sm, Type=Radio, Text=False, State=Default',
      code: '<Checkbox.Radio size="sm" value="…" aria-label="…" />',
    },
    {
      nodeId: '9:5735',
      key: '6d1b91000ccf8bd9fa729ea55f465c7b5f002cfb',
      name: 'Checked=False, Indeterminate=False, Size=md, Type=Checkbox, Text=False, State=Default',
      code: '<Checkbox size="md" aria-label="…" />',
    },
  ],
} as const;

export const figmaCheckboxBase = {
  component: 'Checkbox.Base',
  setId: '9:5599',
  properties: { Checked: 'checked', Indeterminate: 'indeterminate', Size: 'size', Type: 'type' },
  variants: [
    {
      nodeId: '9:5601',
      key: '71e4e58b6f4f077307c37d15d36941b0b8c0ebab',
      name: 'Checked=False, Indeterminate=False, Size=sm, Type=Radio, State=Default',
      code: '<Checkbox.Base size="sm" type="radio" />',
    },
    {
      nodeId: '9:5610',
      key: 'c933c319c745f05bf644265dec533c6a354c3cab',
      name: 'Checked=True, Indeterminate=False, Size=sm, Type=Radio, State=Default',
      code: '<Checkbox.Base size="sm" type="radio" checked />',
    },
    {
      nodeId: '9:5620',
      key: 'c1a7ba7972a40c31fa96755b5eb26c533381c31c',
      name: 'Checked=False, Indeterminate=False, Size=md, Type=Checkbox, State=Default',
      code: '<Checkbox.Base size="md" type="checkbox" />',
    },
  ],
} as const;
