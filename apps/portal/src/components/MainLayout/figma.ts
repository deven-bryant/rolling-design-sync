/** Figma `Main` (Portal file, Section 1) → `MainLayout`. */
export const figma = {
  component: 'MainLayout',
  sets: [
    {
      name: 'Main',
      nodeId: '48:5939',
      variants: [
        {
          name: 'Main',
          nodeId: '48:5939',
          key: 'd2c85a1e2c62ff6853712aa1fc0e9945be4da7e9',
          props: {},
        },
      ],
    },
  ],
  /** Figma property / layer → prop / class. */
  properties: {
    'Slot#48:0': '`children`',
    'Main (48:5939)':
      'root: vertical, fill width (`flex-1 min-w-0`, no max width), hug height, clips content (`overflow-x-clip`), fill Background/bg-primary (`bg-primary`)',
    'Slot (48:5938)': 'root: itemSpacing spacing-4xl (`gap-4xl`), padding spacing-3xl / spacing-6xl (`py-3xl px-6xl`)',
  },
} as const;
