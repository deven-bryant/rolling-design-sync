// Figma link for Card (Portal file PORTAL_DESIGN_FILE, Section 1): component keys and variant → prop mapping.

export const figma = {
  'Card header': {
    setId: '111:18804',
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
    variants: [{ nodeId: '111:18805', key: '1a82d4ef2e99cb940edcf1a71b53bdf30a294de7', name: 'Avatar=False, Breakpoint=Desktop' }],
  },
} as const;
