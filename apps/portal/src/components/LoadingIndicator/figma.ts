/**
 * `Loading indicator` (design-system library set `3aca7f64f6a0bf23fc80f4a46749e7fca084bf51`) → `<LoadingIndicator>`.
 * The portal uses `Type=Line simple` only, at the two sizes that fit table rows and drawer sections.
 */
export const figmaLoadingIndicator = {
  component: 'LoadingIndicator',
  componentSetKey: '3aca7f64f6a0bf23fc80f4a46749e7fca084bf51',
  properties: { Size: 'size', 'Supporting text': 'label' },
  variants: [
    { name: 'Type=Line simple, Size=sm', code: '<LoadingIndicator size="sm" label="…" />' },
    { name: 'Type=Line simple, Size=md', code: '<LoadingIndicator size="md" label="…" />' },
  ],
} as const;
