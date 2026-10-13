/**
 * Figma → code for the `Button/` folder (Portal file `PORTAL_DESIGN_FILE`, Section 1).
 * Each variant lists its main-component node id, component key and the props that render it.
 */

/** `Buttons/Button` (`9:2238`) → `<Button>`. */
export const figmaButton = {
  componentSet: { nodeId: '9:2238', name: 'Buttons/Button' },
  axes: {
    Size: { prop: 'size', values: { sm: 'sm', md: 'md', lg: 'lg', xl: 'xl' } },
    Hierarchy: {
      prop: 'hierarchy',
      values: {
        Primary: 'primary',
        Secondary: 'secondary',
        Tertiary: 'tertiary',
        'Link color': 'link-color',
        'Link gray': 'link-gray',
      },
    },
    State: {
      prop: null,
      values: {
        Default: {},
        Hover: 'data-hovered',
        Focused: 'data-focus-visible',
        Disabled: { isDisabled: true },
        Loading: { loading: true },
      },
    },
    'Icon only': { prop: 'iconOnly', values: { False: false, True: true } },
  },
  properties: {
    'Loading text#8994:0': 'loadingText',
    '⬅️ Icon leading#3287:1577': 'iconLeading',
    '🔀 Icon leading swap#3466:91': 'iconLeading',
    '➡️ Icon trailing#3287:2338': 'iconTrailing',
    '🔀 Icon trailing swap#3466:852': 'iconTrailing',
    Text: 'children',
  },
  variants: {
    'Size=md, Hierarchy=Primary, State=Default, Icon only=False': {
      nodeId: '111:11169',
      key: 'e53a6681e460a8cb6af8453dcc2f5b03fd8548d7',
      props: { size: 'md', hierarchy: 'primary' },
    },
    'Size=md, Hierarchy=Tertiary, State=Default, Icon only=False': {
      nodeId: '111:11172',
      key: 'abc6ca9ce46d31a0cabdfe311eaaa74e45b6abbf',
      props: { size: 'md', hierarchy: 'tertiary' },
    },
    'Size=md, Hierarchy=Tertiary, State=Default, Icon only=True': {
      nodeId: '111:11195',
      key: '927427fee61a9eef51804453fb4a717c0b657e64',
      props: { size: 'md', hierarchy: 'tertiary', iconOnly: true },
    },
    'Size=md, Hierarchy=Secondary, State=Default, Icon only=False': {
      nodeId: '111:11173',
      key: 'aa8fdc25db3faf5803607753f61fea1829ca77bc',
      props: { size: 'md', hierarchy: 'secondary' },
    },
    'Size=md, Hierarchy=Link color, State=Default, Icon only=False': {
      nodeId: '111:11170',
      key: '29110720e99656a1849f9be4676dbb04afac5826',
      props: { size: 'md', hierarchy: 'link-color' },
    },
    'Size=sm, Hierarchy=Link color, State=Default, Icon only=False': {
      nodeId: '111:11290',
      key: '26f64c92e8ecd3bf0e9ce1165a669beb22854305',
      props: { size: 'sm', hierarchy: 'link-color' },
    },
    'Size=sm, Hierarchy=Link gray, State=Default, Icon only=False': {
      nodeId: '111:11291',
      key: 'e3d01c304b4470158db60bed7a8ed5a2ce75068f',
      props: { size: 'sm', hierarchy: 'link-gray' },
    },
    'Size=sm, Hierarchy=Secondary, State=Default, Icon only=False': {
      nodeId: '111:11293',
      key: '7a0e02eafb8a834181f59562a307b485c931d3ea',
      props: { size: 'sm', hierarchy: 'secondary' },
    },
  },
} as const;

/** `Buttons/Button utility` (`9:7139`) → `<ButtonUtility>`. */
export const figmaButtonUtility = {
  componentSet: { nodeId: '9:7139', name: 'Buttons/Button utility' },
  axes: {
    Size: { prop: 'size', values: { xs: 'xs' } },
    Hierarchy: {
      prop: 'hierarchy',
      values: { Secondary: 'secondary', Tertiary: 'tertiary' },
    },
    State: {
      prop: null,
      values: {
        Default: {},
        Hover: 'data-hovered',
        Focused: 'data-focus-visible',
        Disabled: { isDisabled: true },
      },
    },
  },
  properties: { '🔀 Icon swap#8003:0': 'icon', Tooltip: 'tooltip' },
  variants: {
    'Size=xs, Hierarchy=Tertiary, State=Default': {
      nodeId: '111:11966',
      key: '3cbb4e5fc0db235d647c8339f1e26fe6c9a7ee22',
      props: { size: 'xs', hierarchy: 'tertiary' },
    },
    'Size=xs, Hierarchy=Tertiary, State=Hover': {
      nodeId: '111:11969',
      key: '2c8c5f19f3296948725dbf4756e951affdb98c49',
      props: { size: 'xs', hierarchy: 'tertiary' },
    },
  },
} as const;

/** `Button close X` (`9:7319`) → `<CloseButton>`. */
export const figmaCloseButton = {
  componentSet: { nodeId: '9:7319', name: 'Button close X' },
  axes: {
    Size: { prop: 'size', values: { sm: 'sm', md: 'md' } },
    'Dark background': { prop: null, values: { False: {} } },
    State: {
      prop: null,
      values: {
        Default: {},
        Hover: 'data-hovered',
        Focused: 'data-focus-visible',
      },
    },
  },
  variants: {
    'Size=md, Dark background=False, State=Default': {
      nodeId: '111:12635',
      key: 'a5065b9fa212482abf1ce01d01282c9eeec9f61f',
      props: { size: 'md' },
    },
    'Size=sm, Dark background=False, State=Default': {
      nodeId: '111:12636',
      key: 'ef5b4ee254658239ca7fd608d02d4575ff275f26',
      props: { size: 'sm' },
    },
  },
} as const;
