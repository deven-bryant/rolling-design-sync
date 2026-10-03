// Figma link for Table (Portal file PORTAL_DESIGN_FILE, Section 1): component keys and variant → prop mapping.

export const figma = {
  'Table cell': {
    setId: '15:1700',
    axes: {
      Type: {
        Text: '<TextCell>',
        Badge: '<BadgeCell>',
        'Badges multiple': '<BadgesCell>',
        'Progress bar': '<ProgressCell>',
        Avatar: '<AvatarCell avatar={<Avatar size="md" />}>',
        'Action icons': '<ActionsCell> of <ButtonUtility size="xs" hierarchy="tertiary">',
      },
      Size: { md: 'the only size' },
      State: { Default: '<Table.Row>', 'Hover/selected': '<Table.Row selected> (also :hover)' },
    },
    properties: { 'Lead action': 'TextCell leadAction={<LeadAction />}' },
    variants: [
      { nodeId: '15:1709', key: 'd102de94d452bb4ebee66a777446fe5d291fd276', name: 'Type=Text, Size=md, State=Default' },
      { nodeId: '15:1745', key: 'd310de32114d9dae0df5f3ffaea0bf3ffb1f340e', name: 'Type=Text, Size=md, State=Hover/selected' },
      { nodeId: '15:1701', key: 'bedef3ae551488f6a14bb1949c5b6f94f73b848c', name: 'Type=Badge, Size=md, State=Default' },
      { nodeId: '15:1753', key: '48f0479cf70be50cf156d98ff9440e1b1b2ff263', name: 'Type=Badge, Size=md, State=Hover/selected' },
      { nodeId: '15:1707', key: '2cdbea62094195cdd7b60a67932dad624d606006', name: 'Type=Badges multiple, Size=md, State=Default' },
      { nodeId: '15:1759', key: 'b1b061adc034ffb856d92d7b394e0b1d846ea1d1', name: 'Type=Badges multiple, Size=md, State=Hover/selected' },
      { nodeId: '15:1721', key: '7e0b8ca9b5e74b8725b6eacdd6ffca58aa39943e', name: 'Type=Progress bar, Size=md, State=Default' },
      { nodeId: '15:1711', key: 'f571dd2ae9b358c949978703afb1c105225f6f6e', name: 'Type=Avatar, Size=md, State=Default' },
      { nodeId: '15:1729', key: '47e050b42e4285047253b3688d5779581b80dbf0', name: 'Type=Action icons, Size=md, State=Default' },
    ],
  },
  'Table header cell': {
    setId: '15:642',
    axes: {
      Size: { md: 'the only size' },
      Text: {
        True: '<Table.HeaderCell>{label}</Table.HeaderCell>',
        False: '<Table.HeaderCell text={false}>{label for assistive tech}</Table.HeaderCell>',
      },
      Checkbox: { False: 'no checkbox prop' },
    },
    variants: [
      { nodeId: '15:645', key: 'a4fcb0b46bf6576647d4eb1b9994eb5a33fdca43', name: 'Size=md, Text=True, Checkbox=False' },
      { nodeId: '15:647', key: '992bd1d14e64f6e08d16541ae4346eec75f81372', name: 'Size=md, Text=False, Checkbox=False' },
    ],
  },
  '_Table header label': {
    setId: '15:589',
    axes: {
      'Help icon': { False: '' },
      Arrow: { False: 'no arrow prop' },
      State: { Default: '' },
    },
    variants: [
      { nodeId: '15:590', key: '3a31da2a72f2afc16166ba64a6f599a41d67683a', name: 'Help icon=False, Arrow=False, State=Default' },
    ],
  },
  'Table cell lead action': {
    setId: '15:658',
    axes: { Type: { Checkbox: '<LeadAction type="checkbox" />' } },
    variants: [{ nodeId: '15:661', key: '49bbfc0f7ad48dfd43bb0be33a8a41fab6ff35cf', name: 'Type=Checkbox' }],
  },
} as const;
