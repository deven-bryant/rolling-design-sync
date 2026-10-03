/** Figma `Breadcrumbs` and its `_Breadcrumb button base` (Portal file, Section 1) → `Breadcrumbs` / `Breadcrumbs.Item`. */
export const figma = {
  component: 'Breadcrumbs',
  sets: [
    {
      name: 'Breadcrumbs',
      nodeId: '9:6202',
      variants: [
        {
          name: 'Divider=Chevron, Type=Button, Breakpoint=Desktop',
          nodeId: '9:6211',
          key: 'ee57779b3aa257dc8fa6af15c237dbe6d4e7f478',
          props: {},
        },
      ],
    },
    {
      name: '_Breadcrumb button base',
      nodeId: '9:6148',
      part: 'Breadcrumbs.Item',
      variants: [
        {
          name: 'Current=False, Type=Button, Icon=False, State=Default',
          nodeId: '9:6159',
          key: '14b472ab02770c85feb5b7776e8b301340f4837d',
          props: {},
        },
        {
          name: 'Current=True, Type=Button, Icon=False, State=Default',
          nodeId: '9:6160',
          key: '7f3af5672a5b427cc55bc408a9f300008708cfb7',
          props: { current: 'last item' },
        },
        {
          name: 'Current=False, Type=Button, Icon=True, State=Default',
          nodeId: '9:6171',
          key: '05e1d1f530c7d9f483265fc48fbde6942da9bd43',
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
