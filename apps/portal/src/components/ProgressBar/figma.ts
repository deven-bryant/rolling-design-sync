/** Figma `Progress bar` (`9:7357`, Portal file Section 1) → `<ProgressBar>`. */
export const figmaProgressBar = {
  componentSet: { nodeId: '9:7357', name: 'Progress bar' },
  axes: {
    Progress: { prop: 'value', values: '0%–100% → 0–100' },
    Label: { prop: 'label', values: { False: 'none', Right: 'right', Bottom: 'bottom' } },
  },
  variants: {
    'Progress=60%, Label=Right': {
      nodeId: '111:10851',
      key: '44115076e9fc1903c31cf56e85e305f51767f6b8',
      props: { value: 60, label: 'right' },
    },
    'Progress=80%, Label=False': {
      nodeId: '111:10865',
      key: '610490a08226038dbc30b13d954f720f46a960c7',
      props: { value: 80, label: 'none' },
    },
  },
} as const;
