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
          nodeId: '111:18442',
          key: 'f58bc7ed14fc8eb6b7e26b8c874fa8ae48fc5a4b',
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
          nodeId: '111:18378',
          key: '86779b5352a878046069ae3185284dfd581d5899',
          props: {},
        },
        {
          name: 'Shape=Square, State=Hover/active',
          nodeId: '111:18380',
          key: 'abe80849852c4557b82ddc562951a94918718606',
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
