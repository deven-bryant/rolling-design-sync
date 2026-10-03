// Figma link for Card (Portal file PORTAL_DESIGN_FILE, Section 1): component keys and variant → prop mapping.

export const figma = {
  'Card header': {
    setId: '9:6090',
    axes: {
      Avatar: { False: 'no avatar' },
      Breakpoint: { Desktop: 'the only layout' },
    },
    properties: {
      Text: '<Card.Header title>',
      Badge: '<Card.Header badge={<Badge />}>',
      'Supporting text': '<Card.Header description>',
      Actions: '<Card.Header actions={<Button />…}>',
      'Dropdown icon': '<Card.Header menu={…}>',
      Divider: '<Card.Header divider>',
    },
    variants: [{ nodeId: '9:6091', key: '7889f3194421086570e70e8dc72d083c0cb2d1eb', name: 'Avatar=False, Breakpoint=Desktop' }],
  },
} as const;
