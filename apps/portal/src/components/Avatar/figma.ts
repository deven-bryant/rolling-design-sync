/**
 * Figma → code for the `Avatar/` folder (Portal file `PORTAL_DESIGN_FILE`, Section 1).
 * Each variant lists its main-component node id, component key and the props that render it.
 */

/** `Avatar` (`9:399`) → `<Avatar>`. */
export const figmaAvatar = {
  componentSet: { nodeId: '9:399', name: 'Avatar' },
  axes: {
    Size: { prop: 'size', values: { xs: 'xs', sm: 'sm', md: 'md', lg: 'lg', xl: 'xl', '2xl': '2xl' } },
    Placeholder: { prop: 'placeholder', values: { False: false, True: true } },
    Text: { prop: 'initials', values: { False: 'src (photo)', True: 'initials' } },
    'Status icon': { prop: 'status', values: { False: undefined, 'Online indicator': 'online' } },
  },
  variants: {
    'Size=sm, Placeholder=False, Text=True, Status icon=Online indicator': {
      nodeId: '111:3839',
      key: 'fe62789256d6f958d2325b1f5984c6db219c137b',
      props: { size: 'sm', initials: 'OR', status: 'online' },
    },
    'Size=lg, Placeholder=False, Text=False, Status icon=Online indicator': {
      nodeId: '111:3867',
      key: 'acfd75928f716ec1872488189b34e9becccb1353',
      props: { size: 'lg', src: 'photo', status: 'online' },
    },
    'Size=md, Placeholder=False, Text=False, Status icon=False': {
      nodeId: '111:3882',
      key: '8878fcd47b0bd7d5069244847d5bda82dfdb2735',
      props: { size: 'md', src: 'photo' },
    },
    'Size=md, Placeholder=False, Text=False, Status icon=Online indicator': {
      nodeId: '111:3870',
      key: '63a33d0e08a5cc30821d4c2cf3d6a05da033234f',
      props: { size: 'md', src: 'photo', status: 'online' },
    },
  },
} as const;

/** `_Avatar online indicator` (`9:352`) → `<OnlineIndicator>` (rendered by `<Avatar status="online">`). */
export const figmaOnlineIndicator = {
  componentSet: { nodeId: '9:352', name: '_Avatar online indicator' },
  axes: {
    Size: { prop: 'size', values: { xs: 'xs', sm: 'sm', md: 'md', lg: 'lg', xl: 'xl', '2xl': '2xl' } },
    Online: { prop: null, values: { True: {} } },
  },
  variants: {
    'Size=sm, Online=True': { nodeId: '111:3789', key: 'b298e8323a94ab650a4b62638b56160ff7837a38', props: { size: 'sm' } },
    'Size=md, Online=True': { nodeId: '111:3791', key: '34c632f642b53331ee479425400c147eee26d342', props: { size: 'md' } },
    'Size=lg, Online=True': { nodeId: '111:3793', key: '544e16f61071437ee018a6aa7cb4f4b0da203355', props: { size: 'lg' } },
  },
} as const;

/** `Avatar label group` (`9:5508`) → `<AvatarLabelGroup>`. */
export const figmaAvatarLabelGroup = {
  componentSet: { nodeId: '9:5508', name: 'Avatar label group' },
  axes: {
    Size: { prop: 'size', values: { md: 'md' } },
    'Status icon': { prop: 'status', values: { 'Online indicator': 'online' } },
  },
  properties: { Text: 'label', 'Supporting text': 'supportingText' },
  variants: {
    'Size=md, Status icon=Online indicator': {
      nodeId: '111:11730',
      key: 'dab9d3dc4d457222561f7801289d7c81436a3586',
      props: { size: 'md', status: 'online' },
    },
  },
} as const;
