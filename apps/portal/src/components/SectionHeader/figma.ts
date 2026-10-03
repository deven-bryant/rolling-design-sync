/** Figma `Custom Section header` (Portal file `PORTAL_DESIGN_FILE`, Section 1) → `SectionHeader`. */
export const figma = {
  component: 'SectionHeader',
  sets: [
    {
      name: 'Custom Section header',
      nodeId: '50:14809',
      variants: [
        {
          name: 'Custom Section header',
          nodeId: '50:14809',
          key: '54a652ef615cbc7866a42a540da3355686fcea2e',
          props: {},
        },
      ],
    },
  ],
  /** Figma layer / property → prop / part. */
  properties: {
    Text: '`SectionHeader.Title`',
    'Supporting Content#50:1': '`SectionHeader.SupportingContent` slot',
    Actions: '`SectionHeader.Actions` slot (holds `Button`s; the main shows a tertiary icon-only one)',
    Dropdown: '`SectionHeader.Dropdown` slot (holds a `Menu`); hidden in the main component',
    Divider: '`divider` (hidden in the main component → default `false`)',
  },
} as const;
