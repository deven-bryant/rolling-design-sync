// Figma link for Metric (Portal file PORTAL_DESIGN_FILE, Section 1): component keys and variant → prop mapping.

export const figma = {
  'Metric item': {
    setId: '24:1959',
    axes: {
      Type: { Simple: '<Metric type="simple">' },
      Actions: { False: 'no actions' },
      Breakpoint: { Desktop: 'the only layout' },
    },
    properties: {
      Heading: '<Metric heading>',
      Number: '<Metric value>',
      _Change: '<Metric change={<MetricChange />}>',
      'Dropdown icon': '<Metric menu={…}>',
    },
    variants: [
      { nodeId: '24:1960', key: 'a31aac1a8cd308c3ae8a6097f79bf1a82c2dc5f8', name: 'Actions=False, Type=Simple, Breakpoint=Desktop' },
    ],
  },
  _Change: {
    setId: '24:1743',
    axes: { Type: { '03': '<MetricChange type="03">' }, Trend: { Positive: '<MetricChange trend="positive">' } },
    variants: [{ nodeId: '24:1748', key: '0f260ba70191e314a999b096fe8204709f59fb11', name: 'Type=03, Trend=Positive' }],
  },
} as const;
