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
      nodeId: '9:2239',
      key: '95edaeda33c6966f6335a867096d1d12a407a8ad',
      props: { size: 'md', hierarchy: 'primary' },
    },
    'Size=md, Hierarchy=Tertiary, State=Default, Icon only=False': {
      nodeId: '9:2242',
      key: '57d62938d9808e5c621c75cb33aa0aae337a21e5',
      props: { size: 'md', hierarchy: 'tertiary' },
    },
    'Size=md, Hierarchy=Tertiary, State=Default, Icon only=True': {
      nodeId: '9:2265',
      key: '51aa55302b5a2a01b49ffb6154017acc3fc37842',
      props: { size: 'md', hierarchy: 'tertiary', iconOnly: true },
    },
    'Size=md, Hierarchy=Secondary, State=Default, Icon only=False': {
      nodeId: '9:2243',
      key: '2def7e66b88415e9765f9fc7fd7e815642d45965',
      props: { size: 'md', hierarchy: 'secondary' },
    },
    'Size=sm, Hierarchy=Link color, State=Default, Icon only=False': {
      nodeId: '9:2360',
      key: '8c441b633ce937959fe4b6896dcee9db9d96442c',
      props: { size: 'sm', hierarchy: 'link-color' },
    },
    'Size=sm, Hierarchy=Link gray, State=Default, Icon only=False': {
      nodeId: '9:2361',
      key: 'd5004241599ea075b7b06e9193def598f0455166',
      props: { size: 'sm', hierarchy: 'link-gray' },
    },
    'Size=sm, Hierarchy=Secondary, State=Default, Icon only=False': {
      nodeId: '9:2363',
      key: '1b16133fd821cbe698ad29e843b23f358a76c474',
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
      nodeId: '9:7152',
      key: '5845c288a1d03c9289748850ca53c97be8ecffc4',
      props: { size: 'xs', hierarchy: 'tertiary' },
    },
    'Size=xs, Hierarchy=Tertiary, State=Hover': {
      nodeId: '9:7155',
      key: '5b9ee6393a5226dc43289ec7d9013fcaf4d587c2',
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
      nodeId: '9:7321',
      key: 'f660e709d32cc8c9ac237e3ac6fb9a39d5e7e605',
      props: { size: 'md' },
    },
    'Size=sm, Dark background=False, State=Default': {
      nodeId: '9:7322',
      key: '7e93f89b1c0a91b860f1e147de9f0b527e645f76',
      props: { size: 'sm' },
    },
  },
} as const;
