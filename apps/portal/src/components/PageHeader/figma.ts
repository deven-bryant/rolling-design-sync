/** Figma `Page header` (Portal file, Section 1) → `PageHeader`. */
export const figma = {
  component: 'PageHeader',
  sets: [
    {
      name: 'Page header',
      nodeId: '111:19126',
      variants: [
        {
          name: 'Style=Simple, Breakpoint=Desktop',
          nodeId: '111:19127',
          key: 'baa05ab337b6e92d2144fee09fb0459b92c42da1',
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
