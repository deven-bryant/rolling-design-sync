// Figma link for FeedItem (Portal file PORTAL_DESIGN_FILE, Section 1): component keys and variant → prop mapping.

export const figma = {
  'Activity feed': {
    setId: '111:13541',
    axes: {
      Divider: { Connector: '<Feed divider="connector">', False: '<Feed divider="none">' },
      Type: { Notifications: '<Feed> of <FeedItem>s' },
    },
    variants: [
      { nodeId: '111:13543', key: '0815a69903bbafb38fd3a78c8a5cd145dbfed2b6', name: 'Divider=Connector, Type=Notifications' },
      { nodeId: '111:13544', key: 'b2375e057a3cd356d937dc327f1a1b89b0066ada', name: 'Divider=False, Type=Notifications' },
    ],
  },
  '_Feed item base': {
    setId: '111:13320',
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
      { nodeId: '111:13321', key: '9771fe7c7726f8d7c6f68d4b808c12e30378b91c', name: 'Size=md, Supporting item=False, Connector=True' },
      { nodeId: '111:13323', key: 'a7ded7b8e8f59f88fa34fafa9b87fc8fdb198eb9', name: 'Size=md, Supporting item=False, Connector=False' },
      { nodeId: '111:13325', key: '0fe763ffb197e76239ef46f8f4a371f7df2b901c', name: 'Size=md, Supporting item=File, Connector=True' },
      { nodeId: '111:13327', key: 'b19fa4306acfd4fcb72a543d241a2cc6d1d52e13', name: 'Size=md, Supporting item=File, Connector=False' },
      { nodeId: '111:13333', key: 'a5a1e009f18e31ad865f9b67b49a38e7e2989753', name: 'Size=md, Supporting item=Text, Connector=True' },
      { nodeId: '111:13335', key: '6df7c2f2fb62edce6328e07dcb3a1eff7a07c18c', name: 'Size=md, Supporting item=Text, Connector=False' },
    ],
  },
  'File type icon': {
    setId: '111:8439',
    axes: {
      'File type': { 'Document / PDF': '<FileTypeIcon type="pdf">', 'Simple / Empty': '<FileTypeIcon type="empty">' },
      Type: { Default: '' },
    },
    variants: [
      { nodeId: '111:8497', key: '5256e9391c4654591a33656768ceece851012cff', name: 'File type=Document / PDF, Type=Default' },
      { nodeId: '111:8469', key: '2a5e66ba5fb1fb802f06b4f30723b51b51c34297', name: 'File type=Simple / Empty, Type=Default' },
    ],
  },
} as const;
