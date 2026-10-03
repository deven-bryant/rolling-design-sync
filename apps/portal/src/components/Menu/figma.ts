/** Figma `Dropdown` trigger and `_Dropdown menu item` (Portal file, Section 1) → `Menu` / `Menu.Item`. */
export const figma = {
  component: 'Menu',
  sets: [
    {
      name: 'Dropdown',
      nodeId: '9:6025',
      variants: [
        {
          name: 'Type=Icon, Open=False',
          nodeId: '9:6027',
          key: 'd17c07d1f7ccbfdc5b5f704666676e7c2dfcab56',
          props: {},
        },
      ],
    },
    {
      name: '_Dropdown menu item',
      nodeId: '9:7183',
      part: 'Menu.Item',
      variants: [
        {
          name: 'Type=Menu item, State=Default, Current=False',
          nodeId: '9:7188',
          key: '8a38b539ea79acdf2d1b135318811034a4f1f28b',
          props: { type: 'menu-item' },
        },
        {
          name: 'Type=Account, State=Default, Current=False',
          nodeId: '9:7190',
          key: '6fd61c897aad6d845fcb712b7022b952d96b9d3b',
          props: { type: 'account' },
        },
        {
          name: 'Type=Account, State=Default, Current=True',
          nodeId: '9:7191',
          key: '598c363f36a636908f4fee3ba94605d3f6f09cfa',
          props: { type: 'account', selected: true },
        },
      ],
    },
  ],
  /** Figma property → prop. */
  properties: {
    Type: '`Menu.Item` `type`: Menu item → menu-item, Account → account',
    Current: 'the selected item of a `selectionMode="single"` menu',
    Open: 'the menu popover is open (`isOpen` / `defaultOpen`)',
    '🔀 Icon swap#3473:33': '`Menu.Item` `icon`',
    'Shortcut#3281:732': '`Menu.Item` `shortcut`',
    State: 'hover / keyboard focus highlight',
  },
} as const;
