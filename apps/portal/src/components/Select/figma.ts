/**
 * Figma ↔ code for Select (Portal file `PORTAL_DESIGN_FILE`, Section 1). The synced design
 * has `Size=sm` with `Type=Default` and `Type=Search`; the other `Type` options are not in the
 * synced scope, so they have no code. `State` (Placeholder / Default / Focused / Open / Disabled)
 * comes from React Aria.
 */
export const figmaSelect = {
  component: 'Select',
  setId: '9:1305',
  properties: {
    Size: 'size',
    Type: 'Default → <Select>, Search → <Select.Search>',
    'Label#3281:500': 'label',
    '↳ Required *#7495:0': 'required',
    '↳ Help icon#7495:31': 'tooltip',
    'Hint text#3281:516': 'hint',
    'Supporting text#3281:532': '<Select.Item supportingText>',
    'Shortcut#7953:6': 'shortcut (Select.Search)',
    '🔀 Icon swap#3473:79': 'iconLeading',
  },
  variants: [
    {
      nodeId: '9:1307',
      key: '54c9998484c62caee08c1bf77a458cc186e95cae',
      name: 'Size=sm, Type=Default, State=Default',
      code: '<Select size="sm" label="…" required tooltip="…" hint="…" defaultSelectedKey="…"><Select.Item id="…" supportingText="…">…</Select.Item></Select>',
    },
    {
      nodeId: '9:1331',
      key: '6dd3061519f19925a621829393c27594b7facf2a',
      name: 'Size=sm, Type=Search, State=Placeholder',
      code: '<Select.Search size="sm" label="…" required tooltip="…" hint="…" shortcut="⌘K" placeholder="…">…</Select.Search>',
    },
  ],
} as const;
