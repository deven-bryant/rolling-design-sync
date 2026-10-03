/** `CategoryBadges` is a row of `Badge`s (`9:3656`, Color=Gray blue) with a Color=Gray `+N` overflow, as in `Diff row`'s `Category`. */
export const figmaCategoryBadges = {
  instanceOf: { nodeId: '9:3656', name: 'Badge' },
  props: { size: 'sm', type: 'pill-color', color: 'gray-blue' },
  overflow: { color: 'gray', label: '+N' },
} as const;
