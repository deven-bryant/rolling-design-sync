// Figma link for Metric (Portal file PORTAL_DESIGN_FILE, Section 1): component keys and variant → prop mapping.

export const figma = {
  'Metric item': {
    setId: '111:14656',
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
      { nodeId: '111:14657', key: 'b3107d46f3ec7c660b226cb9b7a23a5414dff969', name: 'Actions=False, Type=Simple, Breakpoint=Desktop' },
    ],
  },
  _Change: {
    setId: '111:14442',
    axes: { Type: { '03': '<MetricChange type="03">' }, Trend: { Positive: '<MetricChange trend="positive">' } },
    variants: [{ nodeId: '111:14447', key: '0f8fbfff9291ed519269b571fbac6856b7ce3227', name: 'Type=03, Trend=Positive' }],
  },
} as const;
