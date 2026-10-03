/** Figma `Page header` (Portal file, Section 1) → `PageHeader`. */
export const figma = {
  component: 'PageHeader',
  sets: [
    {
      name: 'Page header',
      nodeId: '9:6403',
      variants: [
        {
          name: 'Style=Simple, Breakpoint=Desktop',
          nodeId: '9:6404',
          key: 'ee2a1ff156a81f2774174739d0a3fe87c7ef9320',
          props: {},
        },
      ],
    },
  ],
  /** Figma property → prop / part. */
  properties: {
    'Breadcrumbs#3281:1426': '`PageHeader.Breadcrumbs` slot (holds `Breadcrumbs`)',
    'Supporting text#3281:1571': '`PageHeader.Description`',
    'Actions#3281:1716': '`PageHeader.Actions` slot (holds buttons)',
    'Divider#3304:0': '`divider`',
    Text: '`PageHeader.Title`',
    'Search#3281:1861': 'not used by any screen (off in every instance); not implemented',
  },
} as const;
