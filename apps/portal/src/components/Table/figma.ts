// Figma link for Table (Portal file PORTAL_DESIGN_FILE, Section 1): component keys and variant → prop mapping.

export const figma = {
  'Table cell': {
    setId: '162:13390',
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
      { nodeId: '162:13399', key: '5d25ec13ffe98d883c3337e36cbbef897f373099', name: 'Type=Text, Size=md, State=Default' },
      { nodeId: '15:1745', key: 'd310de32114d9dae0df5f3ffaea0bf3ffb1f340e', name: 'Type=Text, Size=md, State=Hover/selected' },
      { nodeId: '162:13391', key: 'cef203b28437208dae1d4ad09bd2e192c7e9e74b', name: 'Type=Badge, Size=md, State=Default' },
      { nodeId: '15:1753', key: '48f0479cf70be50cf156d98ff9440e1b1b2ff263', name: 'Type=Badge, Size=md, State=Hover/selected' },
      { nodeId: '162:13397', key: '04c711f34e99cd4d6772b21064274a0c4da1e3d4', name: 'Type=Badges multiple, Size=md, State=Default' },
      { nodeId: '15:1759', key: 'b1b061adc034ffb856d92d7b394e0b1d846ea1d1', name: 'Type=Badges multiple, Size=md, State=Hover/selected' },
      { nodeId: '162:13411', key: '5ece57eb65e6cb8119984525429fcbf8d0444d13', name: 'Type=Progress bar, Size=md, State=Default' },
      { nodeId: '162:13401', key: 'da70eae1f84f67b6a8642fcf3f967df5d4820ecc', name: 'Type=Avatar, Size=md, State=Default' },
      { nodeId: '162:13419', key: 'de35dfdb43f4f59139e3ef49f5e7e91a7de6c800', name: 'Type=Action icons, Size=md, State=Default' },
    ],
  },
  'Table header cell': {
    setId: '111:16427',
    axes: {
      Size: { md: 'the only size' },
      Text: {
        True: '<Table.HeaderCell>{label}</Table.HeaderCell>',
        False: '<Table.HeaderCell text={false}>{label for assistive tech}</Table.HeaderCell>',
      },
      Checkbox: { False: 'no checkbox prop' },
    },
    variants: [
      { nodeId: '111:16430', key: '13cf409e33acd3be7da735d98d8f8a6d0d340343', name: 'Size=md, Text=True, Checkbox=False' },
      { nodeId: '111:16432', key: '5be4f0a5051605587129c5255e73f7ee9652ef4c', name: 'Size=md, Text=False, Checkbox=False' },
    ],
  },
  '_Table header label': {
    setId: '111:16374',
    axes: {
      'Help icon': { False: '' },
      Arrow: { False: 'no arrow prop' },
      State: { Default: '' },
    },
    variants: [
      { nodeId: '111:16375', key: 'f5be66a5fb6fed5e6caa1832b3b0a62b85710766', name: 'Help icon=False, Arrow=False, State=Default' },
    ],
  },
  'Table cell lead action': {
    setId: '111:8430',
    axes: { Type: { Checkbox: '<LeadAction type="checkbox" />' } },
    variants: [{ nodeId: '111:8433', key: '674d0fafc55f06a39159ee0ae182f5cc7cd114f7', name: 'Type=Checkbox' }],
  },
} as const;
