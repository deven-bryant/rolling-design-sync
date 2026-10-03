/** Figma `Progress bar` (`9:7357`, Portal file Section 1) → `<ProgressBar>`. */
export const figmaProgressBar = {
  componentSet: { nodeId: '9:7357', name: 'Progress bar' },
  axes: {
    Progress: { prop: 'value', values: '0%–100% → 0–100' },
    Label: { prop: 'label', values: { False: 'none', Right: 'right', Bottom: 'bottom' } },
  },
  variants: {
    'Progress=60%, Label=Right': {
      nodeId: '9:7388',
      key: '4f2fa4d4cd5e9f119c446891eee4f47550b42b0d',
      props: { value: 60, label: 'right' },
    },
    'Progress=80%, Label=False': {
      nodeId: '9:7402',
      key: 'a2fe7c15934d03b41421a9e3dce9e77f98d7a49e',
      props: { value: 80, label: 'none' },
    },
  },
} as const;
