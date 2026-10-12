/** Figma `Page header` (Portal file, Section 1) → `PageHeader`. */
export const figma = {
  component: 'PageHeader',
  sets: [
    {
      name: 'Page header',
      nodeId: '162:12647',
      variants: [
        {
          name: 'Style=Simple, Breakpoint=Desktop',
          nodeId: '162:12648',
          key: 'baa05ab337b6e92d2144fee09fb0459b92c42da1',
          props: {},
        },
      ],
    },
  ],
  /**
   * `Portal Page Header` (local, Portal components page): the file header — a `bg-primary` frame around a
   * `Page header` (Divider · Supporting text · Actions on). Built by `FileLayout` as
   * `<PageHeader divider className="bg-primary">` with the file name, scope metadata and the actions
   * File settings (`ButtonUtility`) · Copy agent prompt · Open in Figma.
   */
  composition: {
    name: 'Portal Page Header',
    nodeId: '163:12666',
    key: '37dc8f4a6140df0ff3d20da3aa15a099e8b585dc',
    instance: { name: 'Page header', nodeId: '163:12541', props: { divider: true } },
  },
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
