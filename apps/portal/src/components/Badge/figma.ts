/**
 * Figma → code for the `Badge/` folder (Portal file `PORTAL_DESIGN_FILE`, Section 1).
 * Each variant lists its main-component node id, component key and the props that render it.
 */

/** `Badge` (`9:3656`) → `<Badge>`. */
export const figmaBadge = {
  componentSet: { nodeId: '9:3656', name: 'Badge' },
  axes: {
    Size: { prop: 'size', values: { sm: 'sm', md: 'md' } },
    Type: { prop: 'type', values: { 'Pill color': 'pill-color', 'Badge color': 'badge-color', 'Badge modern': 'badge-modern' } },
    Color: {
      prop: 'color',
      values: {
        Gray: 'gray',
        Brand: 'brand',
        Warning: 'warning',
        Success: 'success',
        'Blue light': 'blue-light',
        Blue: 'blue',
        Indigo: 'indigo',
        Pink: 'pink',
        Orange: 'orange',
        'Gray blue': 'gray-blue',
      },
    },
    Icon: {
      prop: null,
      values: { False: {}, Dot: { dot: true }, 'Icon leading': 'iconLeading', 'Icon trailing': 'iconTrailing' },
    },
  },
  properties: {
    Text: 'children',
    '🔀 Icon leading swap#3920:433': 'iconLeading',
    '🔀 Icon trailing swap#3920:0': 'iconTrailing',
  },
  variants: {
    'Size=sm, Type=Pill color, Icon=False, Color=Brand': {
      nodeId: '9:3657',
      key: '9259295e822059fc6ba519d01d6f5dfb50d05ac6',
      props: { size: 'sm', type: 'pill-color', color: 'brand' },
    },
    'Size=sm, Type=Pill color, Icon=False, Color=Success': {
      nodeId: '9:3661',
      key: 'f06a8ac31fb99d6adbb681c387314f161c71e1a7',
      props: { size: 'sm', type: 'pill-color', color: 'success' },
    },
    'Size=sm, Type=Pill color, Icon=False, Color=Gray blue': {
      nodeId: '9:3663',
      key: 'e65abb1918faf633fed00a43721d51331fec9552',
      props: { size: 'sm', type: 'pill-color', color: 'gray-blue' },
    },
    'Size=sm, Type=Pill color, Icon=False, Color=Indigo': {
      nodeId: '9:3667',
      key: '504ac7b68f5a115b5c62d46cc3c0f398195b54ab',
      props: { size: 'sm', type: 'pill-color', color: 'indigo' },
    },
    'Size=sm, Type=Pill color, Icon=False, Color=Blue': {
      nodeId: '9:3671',
      key: '89f1322e89324493ea1bb012e7fceb2c3fee4145',
      props: { size: 'sm', type: 'pill-color', color: 'blue' },
    },
    'Size=sm, Type=Pill color, Icon=False, Color=Pink': {
      nodeId: '9:3673',
      key: 'f94677d2cdfb6e31e70a6ff40748d68cdca75400',
      props: { size: 'sm', type: 'pill-color', color: 'pink' },
    },
    'Size=sm, Type=Pill color, Icon=False, Color=Orange': {
      nodeId: '9:3675',
      key: '8a508545de91a011b1deef33a51125c67dc64c79',
      props: { size: 'sm', type: 'pill-color', color: 'orange' },
    },
    'Size=sm, Type=Pill color, Icon=False, Color=Gray': {
      nodeId: '9:3679',
      key: '26b1f19bbd73535d61549471f175f70b0c8daf03',
      props: { size: 'sm', type: 'pill-color', color: 'gray' },
    },
    'Size=md, Type=Pill color, Icon=False, Color=Brand': {
      nodeId: '9:3879',
      key: '8cc3132800a40984b98589aeb38806ea85ff76a8',
      props: { size: 'md', type: 'pill-color', color: 'brand' },
    },
    'Size=md, Type=Pill color, Icon=False, Color=Warning': {
      nodeId: '9:3881',
      key: '3948570b5af1ec905796a8f830ef8e9e97f1ed2b',
      props: { size: 'md', type: 'pill-color', color: 'warning' },
    },
    'Size=md, Type=Pill color, Icon=False, Color=Blue light': {
      nodeId: '9:3887',
      key: 'f9e08b58dac89eaf642a37c5611e44291b1220d8',
      props: { size: 'md', type: 'pill-color', color: 'blue-light' },
    },
    'Size=md, Type=Pill color, Icon=False, Color=Indigo': {
      nodeId: '9:3889',
      key: '9a776946d14b5887f9d6572a623d2b11bbf26d51',
      props: { size: 'md', type: 'pill-color', color: 'indigo' },
    },
    'Size=md, Type=Pill color, Icon=False, Color=Gray': {
      nodeId: '9:3901',
      key: '6e2ec4d2d49c8c48c2de9b837bd302b2f74373dc',
      props: { size: 'md', type: 'pill-color', color: 'gray' },
    },
  },
} as const;

/** `_Dot` (`9:541`) → `<BadgeDot>`. */
export const figmaBadgeDot = {
  componentSet: { nodeId: '9:541', name: '_Dot' },
  axes: { Size: { prop: 'size', values: { sm: 'sm', md: 'md' } }, Outline: { prop: null, values: { False: {} } } },
  variants: {
    'Size=md, Outline=False': { nodeId: '9:542', key: '8caa77bb0b5c25ff22440a5430779d096e915b97', props: { size: 'md' } },
  },
} as const;

/** `Featured icon` (`9:8134`) → `<FeaturedIcon>`. */
export const figmaFeaturedIcon = {
  componentSet: { nodeId: '9:8134', name: 'Featured icon' },
  axes: {
    Size: { prop: 'size', values: { md: 'md' } },
    Color: { prop: 'color', values: { Gray: 'gray' } },
    Type: { prop: 'type', values: { Modern: 'modern' } },
  },
  properties: { '🔀 Icon swap#3465:0': 'icon' },
  variants: {
    'Size=md, Color=Gray, Type=Modern': {
      nodeId: '9:8159',
      key: '7dd7901c785c5a331ddaa0d454780ace0edb9416',
      props: { size: 'md', color: 'gray', type: 'modern' },
    },
  },
} as const;
