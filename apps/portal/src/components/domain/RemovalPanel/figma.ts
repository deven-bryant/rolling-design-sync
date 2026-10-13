/**
 * The design file has no removal panel: `RemovalPanel` is built for removed work items from existing parts
 * (`Badge` success / warning, `Text`, the `alert-circle` icon) and tokens, as a card inside the node drawer.
 */
export const figmaRemovalPanel = {
  component: 'RemovalPanel',
  nodeId: null,
  badges: { Keep: 'success', 'Likely unused': 'warning' },
} as const;
