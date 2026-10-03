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
      nodeId: '9:414',
      key: 'e59df24ba2d73fecd73e4713fda82b7cd0b95b61',
      props: { size: 'sm', initials: 'OR', status: 'online' },
    },
    'Size=lg, Placeholder=False, Text=False, Status icon=Online indicator': {
      nodeId: '9:442',
      key: 'bc1867984bc2673693005b24cbcca32aebb23dbe',
      props: { size: 'lg', src: 'photo', status: 'online' },
    },
    'Size=md, Placeholder=False, Text=False, Status icon=False': {
      nodeId: '9:457',
      key: 'ebcb7f14f5d7b6c72f97f5a30284a75d0e75151c',
      props: { size: 'md', src: 'photo' },
    },
    'Size=md, Placeholder=False, Text=False, Status icon=Online indicator': {
      nodeId: '9:445',
      key: '06cb115c12e204fb6f6ead4d0cb57f3c024f4880',
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
    'Size=sm, Online=True': { nodeId: '9:356', key: '62de4108559250eeb71aaba8b20cd65fb0644d6d', props: { size: 'sm' } },
    'Size=md, Online=True': { nodeId: '9:358', key: '0d396d125784c85cd4fc81ad2bc1f1ebb701b4da', props: { size: 'md' } },
    'Size=lg, Online=True': { nodeId: '9:360', key: '9901d7d56371c83d962956ec6f6aa934382416db', props: { size: 'lg' } },
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
      nodeId: '9:5509',
      key: '487a3d66c4ee289ee1a5eae0c4a4b7781c9b8208',
      props: { size: 'md', status: 'online' },
    },
  },
} as const;
