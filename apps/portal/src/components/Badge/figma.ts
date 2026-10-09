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
      nodeId: '111:3964',
      key: '583c57089fd1a44ae774ce64919ba98332d1baa8',
      props: { size: 'sm', type: 'pill-color', color: 'brand' },
    },
    'Size=sm, Type=Pill color, Icon=False, Color=Success': {
      nodeId: '111:3968',
      key: '4de2a5c4ab00d5be72c5158f3afc367a458a84e9',
      props: { size: 'sm', type: 'pill-color', color: 'success' },
    },
    'Size=sm, Type=Pill color, Icon=False, Color=Gray blue': {
      nodeId: '111:3970',
      key: '2e50c22071257bfffee94d95ae0c407e618a1f1c',
      props: { size: 'sm', type: 'pill-color', color: 'gray-blue' },
    },
    'Size=sm, Type=Pill color, Icon=False, Color=Indigo': {
      nodeId: '111:3974',
      key: 'ebd4cbfae21db9db65c53390dd2e8c3f2aef533e',
      props: { size: 'sm', type: 'pill-color', color: 'indigo' },
    },
    'Size=sm, Type=Pill color, Icon=False, Color=Blue': {
      nodeId: '111:3978',
      key: '720c4d3af3952d72c44ae88c6a0efef99e115bfb',
      props: { size: 'sm', type: 'pill-color', color: 'blue' },
    },
    'Size=sm, Type=Pill color, Icon=False, Color=Pink': {
      nodeId: '111:3980',
      key: '04b8b5cffae230aa927b644cac6cfa3b41958be4',
      props: { size: 'sm', type: 'pill-color', color: 'pink' },
    },
    'Size=sm, Type=Pill color, Icon=False, Color=Orange': {
      nodeId: '111:3982',
      key: 'bf42d9dcded3f04f73f7fa146f0cad3594a69dae',
      props: { size: 'sm', type: 'pill-color', color: 'orange' },
    },
    'Size=sm, Type=Pill color, Icon=False, Color=Gray': {
      nodeId: '111:3986',
      key: '4e1248eb88eac1894ab181c4c23d7eac8b0100b6',
      props: { size: 'sm', type: 'pill-color', color: 'gray' },
    },
    'Size=md, Type=Pill color, Icon=False, Color=Brand': {
      nodeId: '111:4186',
      key: 'd99aa7d7a2028d1d2265217b01bf119f9978fccb',
      props: { size: 'md', type: 'pill-color', color: 'brand' },
    },
    'Size=md, Type=Pill color, Icon=False, Color=Warning': {
      nodeId: '111:4188',
      key: 'b1b97e3281e8fadebe5c0ac59299ceb661680f75',
      props: { size: 'md', type: 'pill-color', color: 'warning' },
    },
    'Size=md, Type=Pill color, Icon=False, Color=Blue light': {
      nodeId: '111:4194',
      key: '6ebc63a664b9c605a9f8fc5eac7bddc1f63b9483',
      props: { size: 'md', type: 'pill-color', color: 'blue-light' },
    },
    'Size=md, Type=Pill color, Icon=False, Color=Indigo': {
      nodeId: '111:4196',
      key: '118d7d8bd48d7167ded21e28be95add86cfb3204',
      props: { size: 'md', type: 'pill-color', color: 'indigo' },
    },
    'Size=md, Type=Pill color, Icon=False, Color=Gray': {
      nodeId: '111:4208',
      key: '5a4cfb44376ccc4f337207d0cbf1478586da796f',
      props: { size: 'md', type: 'pill-color', color: 'gray' },
    },
  },
} as const;

/** `_Dot` (`9:541`) → `<BadgeDot>`. */
export const figmaBadgeDot = {
  componentSet: { nodeId: '9:541', name: '_Dot' },
  axes: { Size: { prop: 'size', values: { sm: 'sm', md: 'md' } }, Outline: { prop: null, values: { False: {} } } },
  variants: {
    'Size=md, Outline=False': { nodeId: '111:3650', key: '2daa57cd7df37659dc072a9eb3e09b0336ff00b6', props: { size: 'md' } },
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
      nodeId: '111:12437',
      key: 'abc629e1141c1c1340efafcdcc3c288c798ab6fe',
      props: { size: 'md', color: 'gray', type: 'modern' },
    },
  },
} as const;
