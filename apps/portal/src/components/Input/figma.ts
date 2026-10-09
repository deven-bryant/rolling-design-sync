/**
 * Figma ↔ code for Input field and its help icon (Portal file `PORTAL_DESIGN_FILE`,
 * Section 1). The synced design has `Size=sm`, `Type=Default`, `Destructive=False` only, so
 * those axes have no other values in code. `State=Placeholder` is the empty field; focus and
 * disabled come from React Aria.
 */
export const figmaInput = {
  component: 'Input',
  setId: '111:15133',
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
      nodeId: '111:15135',
      key: 'de8523a0c99dd13856beab4f9d0b1b5a6860499f',
      name: 'Size=sm, Type=Default, Destructive=False, State=Placeholder',
      code: '<Input size="sm" label="…" required hint="…" tooltip="…" iconLeading={<Icon name="mail-01" size="md" />} placeholder="…" />',
    },
  ],
} as const;

export const figmaHelpIcon = {
  component: 'Input.HelpIcon',
  setId: '111:5965',
  properties: { Tooltip: 'label (accessible name)' },
  variants: [
    {
      nodeId: '111:5966',
      key: '7640e8e4c064e750c9917a06d3ca48a43927eb15',
      name: 'Open=False, Supporting text=False, Tooltip=Top no arrow',
      code: '<Input.HelpIcon label="…" />',
    },
  ],
} as const;
