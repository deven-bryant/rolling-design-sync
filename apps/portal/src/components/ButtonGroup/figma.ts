/** Figma `Button group` (`25:2144`, Portal file Section 1) → `<ButtonGroup>` with `<ButtonGroup.Item>` children. */
export const figmaButtonGroup = {
  componentSet: { nodeId: '25:2144', name: 'Button group' },
  axes: { Icon: { prop: null, values: { False: {} } } },
  item: {
    component: { nodeId: '25:2061', name: '_Button group base' },
    axes: {
      Current: { prop: 'selectedKeys', values: { False: 'not selected', True: 'selected' } },
      State: { prop: null, values: { Default: {}, Hover: 'data-hovered', Focused: 'data-focus-visible', Disabled: { isDisabled: true } } },
    },
    properties: { Text: 'children' },
    variants: {
      'Current=False, Icon=False, State=Default': {
        nodeId: '25:2061',
        key: '6264ac5d718bfbc934b10b3a1e58ebc0e7a536cc',
        props: {},
        note: '40px min height (`min-h-10`), 8/16 padding, Text sm/Semibold secondary on bg-primary',
      },
    },
  },
  variants: {
    'Icon=False': {
      nodeId: '25:2145',
      key: '0e583efab42f056087e6908545e60f067215610b',
      props: {},
    },
  },
} as const;
