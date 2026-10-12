/**
 * The design file has no toast: `ToastRegion` / `ToastCard` are built from existing tokens (the card surface,
 * `shadow-lg`, the `check-circle` icon and `CloseButton`) for confirmations such as "Component key copied".
 */
export const figmaToast = {
  component: 'Toast',
  nodeId: null,
  tones: { success: 'fg-success-primary', error: 'fg-error-primary' },
} as const;
