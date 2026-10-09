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
        nodeId: '111:16493',
        key: '8c8c32f5ec109e663b23da50b1aa1c715bee9bfa',
        props: {},
        note: '40px min height (`min-h-10`), 8/16 padding, Text sm/Semibold secondary on bg-primary',
      },
    },
  },
  variants: {
    'Icon=False': {
      nodeId: '111:16577',
      key: 'e96e6ac8e8a82add0f61ca2e243efde9cf219fdb',
      props: {},
    },
  },
} as const;
