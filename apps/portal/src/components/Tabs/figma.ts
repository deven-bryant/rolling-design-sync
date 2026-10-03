/** Figma `Horizontal tabs` and its `_Tab button base` (Portal file, Section 1) → `Tabs` / `Tabs.Tab`. */
export const figma = {
  component: 'Tabs',
  sets: [
    {
      name: 'Horizontal tabs',
      nodeId: '9:6809',
      variants: [
        {
          name: 'Type=Underline, Size=md, Full width=False, Breakpoint=Desktop',
          nodeId: '9:6815',
          key: 'ef6a20bcd694d2f73875aeccdb23a57a39d77b13',
          props: { type: 'underline', size: 'md' },
        },
        {
          name: 'Type=Button gray, Size=sm, Full width=False, Breakpoint=Desktop',
          nodeId: '9:6818',
          key: '6a107a56724f6eb471b23937e4d38f443901ee36',
          props: { type: 'button-gray', size: 'sm' },
        },
        {
          name: 'Type=Button gray, Size=md, Full width=False, Breakpoint=Desktop',
          nodeId: '9:6819',
          key: 'e5d39d2bc608ee48b478747bae341cd8a228eca6',
          props: { type: 'button-gray', size: 'md' },
        },
      ],
    },
    {
      name: '_Tab button base',
      nodeId: '9:6590',
      part: 'Tabs.Tab',
      variants: [
        {
          name: 'Current=True, Size=sm, Type=Button gray, State=Default',
          nodeId: '9:6607',
          key: 'c05b2dc437946d6fee4b3a1cd1e34ab1f04741c9',
          props: { type: 'button-gray', size: 'sm', selected: true },
        },
        {
          name: 'Current=False, Size=sm, Type=Button gray, State=Default',
          nodeId: '9:6631',
          key: 'f1ba4fa730efe94c37dca1a007d42295f7543b34',
          props: { type: 'button-gray', size: 'sm' },
        },
        {
          name: 'Current=True, Size=md, Type=Button gray, State=Default',
          nodeId: '9:6610',
          key: '8641d636356c03c098786a0042924aacccdf234a',
          props: { type: 'button-gray', size: 'md', selected: true },
        },
        {
          name: 'Current=False, Size=md, Type=Button gray, State=Default',
          nodeId: '9:6634',
          key: 'ad92a8a343d33f08d6a5ed35910af7fdfc703ceb',
          props: { type: 'button-gray', size: 'md' },
        },
        {
          name: 'Current=True, Size=md, Type=Underline, State=Default',
          nodeId: '9:6649',
          key: '1bc80d485a371aad8156aaf04da94ccbb04c1089',
          props: { type: 'underline', size: 'md', selected: true },
        },
        {
          name: 'Current=False, Size=md, Type=Underline, State=Default',
          nodeId: '9:6661',
          key: 'd0813f0399f2df7547243f5d18b83d4e8a4128b6',
          props: { type: 'underline', size: 'md' },
        },
      ],
    },
  ],
  /** Figma property → prop. */
  properties: {
    Type: '`type`: Underline → underline, Button gray → button-gray',
    Size: '`size`: sm · md',
    Current: 'the selected tab (`selectedKey` / `defaultSelectedKey`)',
    'Badge#7225:0': '`Tabs.Tab` `badge` slot',
    State: 'hover / focus-visible styles',
  },
} as const;
