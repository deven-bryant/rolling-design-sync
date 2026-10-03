/**
 * Figma ↔ code for Input field and its help icon (Portal file `PORTAL_DESIGN_FILE`,
 * Section 1). The synced design has `Size=sm`, `Type=Default`, `Destructive=False` only, so
 * those axes have no other values in code. `State=Placeholder` is the empty field; focus and
 * disabled come from React Aria.
 */
export const figmaInput = {
  component: 'Input',
  setId: '9:9810',
  properties: {
    Size: 'size',
    'Label#3285:0': 'label',
    '↳ Required *#7487:0': 'required',
    'Hint text#3285:337': 'hint',
    'Help icon#3285:674': 'tooltip',
    '⬅️ Icon leading#8753:0': 'iconLeading',
    '🔀 Icon swap#3473:104': 'iconLeading',
  },
  variants: [
    {
      nodeId: '9:9812',
      key: '7ce4295c8cc023265ec8e4996ff5ba1bab03a793',
      name: 'Size=sm, Type=Default, Destructive=False, State=Placeholder',
      code: '<Input size="sm" label="…" required hint="…" tooltip="…" iconLeading={<Icon name="mail-01" size="md" />} placeholder="…" />',
    },
  ],
} as const;

export const figmaHelpIcon = {
  component: 'Input.HelpIcon',
  setId: '9:208',
  properties: { Tooltip: 'label (accessible name)' },
  variants: [
    {
      nodeId: '9:209',
      key: '145d361558287ab6cec9c1711d1291a0e210fd9b',
      name: 'Open=False, Supporting text=False, Tooltip=Top no arrow',
      code: '<Input.HelpIcon label="…" />',
    },
  ],
} as const;
