/** Figma → code for `domain/RenderCheck/` (Portal components page). */

/**
 * `Node Details - Render Check` (`198:145401`) → `<RenderCheck>`, `Property 1` → the `view` tab;
 * `Render Check Header` (`198:164177`) → `<RenderCheckHeader>` (Variant2: KV badges in a row; Default: two columns).
 */
export const figmaRenderCheck = {
  component: { nodeId: '198:145401', name: 'Node Details - Render Check' },
  axes: {
    'Property 1': {
      'Side by Side': { nodeId: '198:145400', props: { view: 'side-by-side' } },
      Heatmap: { nodeId: '198:145402', props: { view: 'heatmap' } },
    },
  },
  header: {
    component: { nodeId: '198:164177', name: 'Render Check Header' },
    variants: { Default: '198:164018', Variant2: '198:164178' },
  },
  layers: {
    'Render Check Header / title': 'Text as h3 size md semibold secondary ("Render check") + RenderCheckBadge',
    'Render Check Header / KV Badge': 'KvBadgeList: Checked · Commit · Source · Limit',
    'Horizontal tabs': 'Tabs type="underline" size="md" fullWidth: Side by side · Heatmap',
    Images: 'two Shots (flex-1, gap-xxs, px-xl): Designed · Implemented, ImageThumbnail rounded-md border-secondary',
    'Diff region': 'regions outlined on the implemented image: border-error, bg-error-solid/15, rounded-xxs',
    'Render Check Footer': 'summary (text-sm semibold primary) · details bullets (text-sm tertiary, gap-xs)',
    Actions: 'Check settings (Button secondary) · Request check (Button primary), right-aligned, gap-lg',
  },
  instances: { 'KV Badge': '198:164176', 'Vertical Divider': '198:164213' },
} as const;
