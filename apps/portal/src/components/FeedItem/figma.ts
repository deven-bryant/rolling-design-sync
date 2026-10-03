// Figma link for FeedItem (Portal file PORTAL_DESIGN_FILE, Section 1): component keys and variant → prop mapping.

export const figma = {
  'Activity feed': {
    setId: '22:1209',
    axes: {
      Divider: { Connector: '<Feed divider="connector">', False: '<Feed divider="none">' },
      Type: { Notifications: '<Feed> of <FeedItem>s' },
    },
    variants: [
      { nodeId: '22:1211', key: '04e1c5e5fa65f0ac0ba6db06162a201f9aa92e02', name: 'Divider=Connector, Type=Notifications' },
      { nodeId: '22:1212', key: 'defca1bb3ffe58c4c8120413063ee8e2f1e75ffe', name: 'Divider=False, Type=Notifications' },
    ],
  },
  '_Feed item base': {
    setId: '22:982',
    axes: {
      Size: { md: 'the only size' },
      'Supporting item': {
        False: 'no supportingItem',
        File: 'supportingItem={<FeedItem.File />}',
        Text: 'supportingItem={<FeedItem.Message />}',
      },
      Connector: { True: '<FeedItem connector>', False: '<FeedItem connector={false}>' },
    },
    properties: {
      Avatar: '<FeedItem avatar={<Avatar size="lg" />}>',
      Text: '<FeedItem name>',
      Subtext: '<FeedItem time>',
      'Supporting text': '<FeedItem>{text}</FeedItem>',
      'New dot': '<FeedItem unread>',
    },
    variants: [
      { nodeId: '22:983', key: 'e17e97fcbb0b6c01a12e7be2a436c6eee86efe78', name: 'Size=md, Supporting item=False, Connector=True' },
      { nodeId: '22:985', key: 'd18f1928236fa3a9d4ea353d46478cd453708b0b', name: 'Size=md, Supporting item=False, Connector=False' },
      { nodeId: '22:987', key: 'e75c827e4dab3f698cd990a6be5e713d574c8a23', name: 'Size=md, Supporting item=File, Connector=True' },
      { nodeId: '22:989', key: '7d8628615334c2c321186ac783c3ca196e75d067', name: 'Size=md, Supporting item=File, Connector=False' },
      { nodeId: '22:995', key: '7370faf375635dfe2046ddcb2245ea73f8e76dda', name: 'Size=md, Supporting item=Text, Connector=True' },
      { nodeId: '22:997', key: '2b7aaa27be88c1a12e492a5813b5a622da9a2e30', name: 'Size=md, Supporting item=Text, Connector=False' },
    ],
  },
  'File type icon': {
    setId: '15:672',
    axes: { 'File type': { 'Document / PDF': '<FileTypeIcon type="pdf">' }, Type: { Default: '' } },
    variants: [{ nodeId: '15:730', key: '889dfbe2c8a74824c42a799dee9b4eebcc326150', name: 'File type=Document / PDF, Type=Default' }],
  },
} as const;
