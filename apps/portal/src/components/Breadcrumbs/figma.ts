/** Figma `Breadcrumbs` and its `_Breadcrumb button base` (Portal file, Section 1) → `Breadcrumbs` / `Breadcrumbs.Item`. */
export const figma = {
  component: 'Breadcrumbs',
  sets: [
    {
      name: 'Breadcrumbs',
      nodeId: '111:18954',
      variants: [
        {
          name: 'Divider=Chevron, Type=Button, Breakpoint=Desktop',
          nodeId: '111:18963',
          key: '29a64e7e20efa9bcdfb3494ae449b24398504fd6',
          props: {},
        },
      ],
    },
    {
      name: '_Breadcrumb button base',
      nodeId: '111:18904',
      part: 'Breadcrumbs.Item',
      variants: [
        {
          name: 'Current=False, Type=Button, Icon=False, State=Default',
          nodeId: '111:18915',
          key: 'd7bd25a991a966f0a2dcf13db1181c1daef40826',
          props: {},
        },
        {
          name: 'Current=True, Type=Button, Icon=False, State=Default',
          nodeId: '111:18916',
          key: '673a7f9189605e085281588ebcdd68626d2e726a',
          props: { current: 'last item' },
        },
        {
          name: 'Current=False, Type=Button, Icon=True, State=Default',
          nodeId: '111:18927',
          key: '49650e0e4ff38fb996d2e4e764bd5dc8d6ef21b4',
          props: { home: true },
        },
      ],
    },
  ],
  /** Figma property → prop. */
  properties: {
    Current: 'the last `Breadcrumbs.Item` is current (aria-current="page")',
    Icon: '`Breadcrumbs.Item` `home`',
    State: 'hover / focus-visible styles',
  },
} as const;
