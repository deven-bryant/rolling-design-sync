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
          nodeId: '111:12898',
          key: 'ee7ad0115e8637e9740f17db8fe018ac2e0dbecc',
          props: { type: 'underline', size: 'md' },
        },
        {
          name: 'Type=Button gray, Size=sm, Full width=False, Breakpoint=Desktop',
          nodeId: '111:12901',
          key: '4c9ebbdbae962f8110ccdecd24bd3b8bf6bc986e',
          props: { type: 'button-gray', size: 'sm' },
        },
        {
          name: 'Type=Button gray, Size=md, Full width=False, Breakpoint=Desktop',
          nodeId: '111:12902',
          key: 'ad935ed2b778895c46ff80d363625e7b318832fb',
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
          nodeId: '111:12691',
          key: 'bbb65aa7fc9dade9f0775880e81c5503422e0603',
          props: { type: 'button-gray', size: 'sm', selected: true },
        },
        {
          name: 'Current=False, Size=sm, Type=Button gray, State=Default',
          nodeId: '111:12715',
          key: '642cd88bd59d16ed292c2b0df6221c0096588952',
          props: { type: 'button-gray', size: 'sm' },
        },
        {
          name: 'Current=True, Size=md, Type=Button gray, State=Default',
          nodeId: '111:12694',
          key: '49f8d767590db64c4ea19174c804aefde0915e2b',
          props: { type: 'button-gray', size: 'md', selected: true },
        },
        {
          name: 'Current=False, Size=md, Type=Button gray, State=Default',
          nodeId: '111:12718',
          key: '2f69e349388f4495cd31e02e7655a374be645724',
          props: { type: 'button-gray', size: 'md' },
        },
        {
          name: 'Current=True, Size=md, Type=Underline, State=Default',
          nodeId: '111:12733',
          key: '6e597fa897b5009f57db88cb6aca938fc78d7151',
          props: { type: 'underline', size: 'md', selected: true },
        },
        {
          name: 'Current=False, Size=md, Type=Underline, State=Default',
          nodeId: '111:12745',
          key: '612f1c8b8483b978ff79798b2f39c762cc5086cb',
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
