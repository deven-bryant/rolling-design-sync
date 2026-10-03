/** `StateBadge` is a `Badge` (`9:3656`, Size=sm, Type=Pill color, Icon=Dot) whose Color follows the node state. */
export const figmaStateBadge = {
  instanceOf: { nodeId: '9:3656', name: 'Badge' },
  props: { size: 'sm', type: 'pill-color', dot: true },
  color: { dirty: 'Warning', clean: 'Success', blocked: 'Error' },
} as const;
