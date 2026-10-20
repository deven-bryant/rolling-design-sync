/** Figma → code for `domain/RenderCheckTarget/` (Portal components page, rev9b). */
export const figmaRenderCheckTarget = {
  details: {
    component: { nodeId: '230:49685', name: 'Render Check Target Details' },
    axes: {
      Excluded: {
        False: { nodeId: '229:43674', props: { excluded: false } },
        True: { nodeId: '230:49686', props: { excluded: true, hint: '…' } },
      },
    },
  },
  history: { component: { nodeId: '230:43820', name: 'Render Check History' } },
  containing: { component: { nodeId: '230:44018', name: 'Render Checks Containing Mismatch Targets' } },
  heatmapCrop: { component: { nodeId: '230:45984', name: 'Node Details - Note Section / Screenshots (Preview Target Note Reference)' } },
  layers: {
    'Target Details / header': 'Text h3 md semibold secondary + Toggle sm, supporting text "Exclude from checks"; justify-between',
    'Target Details / rows': 'dl grid: labels text-sm regular tertiary · values text-sm semibold tertiary, gap-md; Route has ButtonUtility edit-01',
    'Target Details / hint': 'pt-xl, card border-secondary rounded-md px-xl py-lg: text-sm tertiary + Button link-color "Learn more"',
    'History / row': 'flex gap-lg px-lg py-md rounded-md (bg-secondary when viewing): Badge sm dot · summary flex-1 · Viewing | Badge badge-modern "Baseline" · time',
    'Containing / row': 'flex gap-lg py-2.5 border-b border-secondary: name + meta (text-sm tertiary) · Badge sm dot · Button link-color "Open"',
    'Heatmap crop': '124px square, rounded-md border-secondary; caption text-xs tertiary, right-aligned',
  },
} as const;
