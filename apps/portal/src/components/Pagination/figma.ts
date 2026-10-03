/** Figma `Pagination` and its `_Pagination number base` (Portal file, Section 1) → `Pagination`. */
export const figma = {
  component: 'Pagination',
  sets: [
    {
      name: 'Pagination',
      nodeId: '9:2855',
      variants: [
        {
          name: 'Type=Card default, Shape=Square, Breakpoint=Desktop',
          nodeId: '9:2870',
          key: '392f1409c93f82e858a6335dd1df829002679814',
          props: { type: 'card-default' },
        },
      ],
    },
    {
      name: '_Pagination number base',
      nodeId: '9:2799',
      part: 'page number button',
      variants: [
        {
          name: 'Shape=Square, State=Default',
          nodeId: '9:2800',
          key: '2cedd7c327151f573722a9de7e77b82ccd2ef570',
          props: {},
        },
        {
          name: 'Shape=Square, State=Hover/active',
          nodeId: '9:2802',
          key: 'b242b0579f32c4a1c72e821b7541621cadb57418',
          props: { current: 'the `page` number (aria-current="page")' },
        },
      ],
    },
  ],
  /** Figma property → prop. */
  properties: {
    Type: '`type`: Card default → card-default',
    Shape: 'Square (the only shape used)',
    State: 'Hover/active → the page button matching `page`, and hover'
  },
} as const;
