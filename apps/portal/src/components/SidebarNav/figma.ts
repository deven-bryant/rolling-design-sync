/** Figma `Sidebar navigation` and its `_Nav …` parts (Portal file, Section 1) → `SidebarNav` and its parts. */
export const figma = {
  component: 'SidebarNav',
  sets: [
    {
      name: 'Sidebar navigation',
      nodeId: '9:11379',
      variants: [
        {
          name: 'Open=False, Style=Simple, Breakpoint=Desktop',
          nodeId: '9:11391',
          key: '17cafdc98904c14077bd93a3d9a8b97da6ae7ccf',
          props: {},
        },
      ],
    },
    {
      name: '_Nav item base',
      nodeId: '9:7059',
      part: 'SidebarNav.Item',
      variants: [
        {
          name: 'Current=False, State=Default',
          nodeId: '9:7060',
          key: '35454174500992d739315788bc6bddbb591222e7',
          props: {},
        },
      ],
    },
    {
      name: '_Nav item dropdown base',
      nodeId: '9:7112',
      part: 'SidebarNav.Item with `items`',
      variants: [
        {
          name: 'Open=False, Current=False',
          nodeId: '9:7113',
          key: '3c0d357eee3f03465e6a7aa21f02453404fb200a',
          props: { items: 'sub-items', expanded: false },
        },
      ],
    },
    {
      name: '_Nav featured card',
      nodeId: '9:11181',
      part: 'SidebarNav.FeatureCard',
      variants: [
        {
          name: 'Type=Progress bar',
          nodeId: '9:11182',
          key: '1db268a678490a5fb3fca631702fe50a9b6e47bf',
          props: { progress: 'Progress bar slot' },
        },
      ],
    },
    {
      name: '_Nav account card',
      nodeId: '9:7232',
      part: 'SidebarNav.Account',
      variants: [
        {
          name: 'Type=Card, Open=True, Breakpoint=Desktop',
          nodeId: '9:7237',
          key: '26f7c973e72e82926bb3bdc47fb9ce1e82e7f054',
          props: { menu: 'account `Menu` items (open)' },
        },
      ],
    },
  ],
  /** Figma property → prop. */
  properties: {
    Current: '`SidebarNav.Item` `current` (aria-current="page")',
    Open: '`_Nav item dropdown base`: `expanded` / `defaultExpanded`; `_Nav account card`: the account menu is open',
    '⬅️ Icon leading#3292:690 / 🔀 Icon swap#3479:0': '`SidebarNav.Item` `icon`',
    'Badge#3292:112': '`SidebarNav.Item` `badge` slot',
    '➡️ Icon trailing#3292:401': 'the chevron-down of an item with `items`',
    'Dot#3292:979': 'off in every instance; not implemented',
    'X close button#3292:87': '`SidebarNav.FeatureCard` `onDismiss`',
    State: 'hover / focus-visible styles',
  },
} as const;
