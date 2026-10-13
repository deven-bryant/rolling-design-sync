/** Figma `Horizontal tabs` and its `_Tab button base` (Portal file, Section 1) → `Tabs` / `Tabs.Tab`. */
export const figma = {
  component: 'Tabs',
  sets: [
    {
      name: 'Horizontal tabs',
      nodeId: '162:13133',
      variants: [
        {
          name: 'Type=Underline, Size=md, Full width=False, Breakpoint=Desktop',
          nodeId: '162:13139',
          key: 'ee7ad0115e8637e9740f17db8fe018ac2e0dbecc',
          props: { type: 'underline', size: 'md' },
        },
        {
          name: 'Type=Button gray, Size=sm, Full width=False, Breakpoint=Desktop',
          nodeId: '162:13142',
          key: '4c9ebbdbae962f8110ccdecd24bd3b8bf6bc986e',
          props: { type: 'button-gray', size: 'sm' },
        },
        {
          name: 'Type=Button gray, Size=md, Full width=False, Breakpoint=Desktop',
          nodeId: '111:12902',
          key: 'ad935ed2b778895c46ff80d363625e7b318832fb',
          props: { type: 'button-gray', size: 'md' },
        },
        {
          name: 'Type=Button brand, Size=md, Full width=True, Breakpoint=Desktop',
          nodeId: '162:13155',
          key: '6d29006c1859c6c495cd5a33cb27a81aabddaa27',
          props: { type: 'button-brand', size: 'md', fullWidth: true },
        },
      ],
    },
    {
      name: '_Tab button base',
      nodeId: '162:12916',
      part: 'Tabs.Tab',
      variants: [
        {
          name: 'Current=True, Size=sm, Type=Button gray, State=Default',
          nodeId: '162:12933',
          key: 'bbb65aa7fc9dade9f0775880e81c5503422e0603',
          props: { type: 'button-gray', size: 'sm', selected: true },
        },
        {
          name: 'Current=False, Size=sm, Type=Button gray, State=Default',
          nodeId: '162:12957',
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
          name: 'Current=True, Size=md, Type=Button brand, State=Default',
          nodeId: '162:12940',
          key: '38b4a1f2f7726ed5eee3044f067ba3dcccce259b',
          props: { type: 'button-brand', size: 'md', selected: true },
        },
        {
          name: 'Current=False, Size=md, Type=Button brand, State=Default',
          nodeId: '162:12964',
          key: 'd81c36902e93a35eceb67e5316d6ad8065ef729d',
          props: { type: 'button-brand', size: 'md' },
        },
        {
          name: 'Current=True, Size=md, Type=Underline, State=Default',
          nodeId: '162:12975',
          key: '6e597fa897b5009f57db88cb6aca938fc78d7151',
          props: { type: 'underline', size: 'md', selected: true },
        },
        {
          name: 'Current=False, Size=md, Type=Underline, State=Default',
          nodeId: '162:12987',
          key: '612f1c8b8483b978ff79798b2f39c762cc5086cb',
          props: { type: 'underline', size: 'md' },
        },
      ],
    },
  ],
  /** Figma property → prop. */
  properties: {
    Type: '`type`: Underline → underline, Button gray → button-gray, Button brand → button-brand',
    'Full width': '`fullWidth`: the list fills its container and the tabs share it equally',
    Size: '`size`: sm · md',
    Current: 'the selected tab (`selectedKey` / `defaultSelectedKey`)',
    'Badge#7225:0': '`Tabs.Tab` `badge` slot',
    State: 'hover / focus-visible styles',
  },
} as const;
