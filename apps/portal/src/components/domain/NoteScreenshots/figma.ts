/** `Node Details - Notes Screenshots` (`198:82719`, Portal components page) → `<NoteScreenshots>`; in `Add Change` (`173:34249`). */
export const figmaNoteScreenshots = {
  component: { nodeId: '198:82719', name: 'Node Details - Notes Screenshots' },
  layers: {
    label: '"Screenshots (optional)" (text-sm medium text-secondary)',
    'Drop zone': 'react-aria DropZone + FileTrigger: rounded-xl border-dashed border-secondary bg-secondary p-xl gap-xs',
    'Drop zone / title': 'the browse button (text-sm semibold text-primary)',
    'Drop zone / hint': 'hint (text-sm text-tertiary)',
    Attached: 'ul, gap-lg, centered',
    'Attachment / Thumbnail': 'h-20 w-32 rounded-md border-secondary, image object-cover',
    'Attachment / caption': 'name · detail (text-xs text-tertiary)',
    'Attachment / Buttons/Button': 'CloseButton "Remove <name>" (rounded-2xl), top-right',
  },
} as const;
