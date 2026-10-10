/** Figma `Sidebar navigation` and its `_Nav …` parts (Portal file, shared library) → `SidebarNav` and its parts. */
export const figma = {
  component: 'SidebarNav',
  sets: [
    {
      name: 'Portal Sidebar Navigation',
      nodeId: '122:49271',
      variants: [
        {
          name: 'Color Mode=Default',
          nodeId: '120:36024',
          key: '848f7b35b6f3241055d3dc24b060ee0a6d69a8e8',
          props: { header: '`SidebarNav.Header` `title` + `ThemeToggle` in `actions` (light theme)' },
        },
        {
          name: 'Color Mode=Dark',
          nodeId: '122:49272',
          key: '5c15b19e2dcfa892810d8d09f77f0392245c18c4',
          props: { header: '`SidebarNav.Header` `title` + `ThemeToggle` in `actions` (dark theme)' },
        },
      ],
    },
    {
      name: 'Sidebar navigation',
      nodeId: '111:17495',
      variants: [
        {
          name: 'Open=False, Style=Simple, Breakpoint=Desktop',
          nodeId: '111:17507',
          key: '3f157e01d7bd5186abe2d9c790e8d492387d82f7',
          props: {},
        },
      ],
    },
    {
      name: '_Nav item base',
      nodeId: '111:16642',
      part: 'SidebarNav.Item',
      variants: [
        {
          name: 'Current=False, State=Default',
          nodeId: '111:16643',
          key: 'ebac58c9c5246cc09572c87394cd7b93c42164f0',
          props: {},
        },
      ],
    },
    {
      name: '_Nav item dropdown base',
      part: 'SidebarNav.Item (built without the chevron or expand behavior)',
      variants: [
        {
          name: 'Open=False, Current=False',
          nodeId: '111:16692',
          key: '183551a1a7a81d328cdadea072aa38e0040c8825',
          props: {},
        },
      ],
    },
    {
      name: '_Nav featured card',
      part: 'SidebarNav.FeatureCard',
      variants: [
        {
          name: 'Type=Progress bar',
          nodeId: '111:17314',
          key: '5c9b2481709b2c4380c4b9217a609270ad78af4a',
          props: { progress: 'not built (the progress bar is left out)' },
        },
      ],
    },
    {
      name: '_Nav account card',
      part: 'SidebarNav.Account',
      variants: [
        {
          name: 'Type=Card, Open=True, Breakpoint=Desktop',
          nodeId: '111:16760',
          key: 'db22a536df8929e018e83264a2fb75d5dd65dc8b',
          props: { menu: 'account `Menu` items (open)' },
        },
      ],
    },
  ],
  /** Figma property / layer → prop. */
  properties: {
    Current: '`SidebarNav.Item` `current` (aria-current="page")',
    Open: '`_Nav item dropdown base`: not built (no sub-items); `_Nav account card`: the account menu is open',
    '⬅️ Icon leading / 🔀 Icon swap': '`SidebarNav.Item` `icon`',
    Badge: '`SidebarNav.Item` `badge` slot',
    '➡️ Icon trailing': 'the chevron on nav items: not built',
    Dot: 'off in every instance; not implemented',
    'X close button': '`SidebarNav.FeatureCard` `onDismiss`',
    'Progress bar': 'not built',
    'Header / Logo': '`SidebarNav.Header` `title`: the product name (text, on one line)',
    'Header / Color Mode Toggle': '`SidebarNav.Header` `actions` slot, right of the product name, 12px from the edge',
    'Buttons/Button utility': '`SidebarNav.Account` menu trigger, pinned top-right',
    State: 'hover / focus-visible styles',
    'Color Mode': 'the theme (`data-theme`), not a prop',
  },
} as const;
