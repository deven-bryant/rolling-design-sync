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
          nodeId: '111:11890',
          key: '09834d30afed8f31ddcb27aed63de3670787e56d',
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
          nodeId: '111:16715',
          key: 'ffd914446e9f3b441ecc3ed02c99ab02fdcb4594',
          props: { type: 'menu-item' },
        },
        {
          name: 'Type=Account, State=Default, Current=False',
          nodeId: '111:16717',
          key: 'cf71aa3b50ede8a0ec13292445f78635a901b80a',
          props: { type: 'account' },
        },
        {
          name: 'Type=Account, State=Default, Current=True',
          nodeId: '111:16718',
          key: '50b066889a5e90e6475da7d5e1e0c0cc407ed77a',
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
