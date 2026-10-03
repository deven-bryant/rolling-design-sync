/**
 * `AgentSprite` has no component of its own in the Portal file: it is the `Avatar` inside `Agent cell` (`14:597`),
 * colored and animated per docs/ui-portal.md "Agent sprites".
 */
export const figmaAgentSprite = {
  instanceOf: { nodeId: '14:597', name: 'Avatar', in: 'Agent cell' },
  props: { size: 'sm' },
  states: ['enter', 'idle', 'poof', 'fade'],
} as const;
