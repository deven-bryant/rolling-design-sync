/**
 * `Node Details - Note Section` (`198:104578`, Portal components page). `Property 1=Preview` → `<NoteSection>` (an
 * open note); `Default` / `Edit` are `<NodeDetails addChange>`'s toggle row closed / open.
 */
export const figmaNoteSection = {
  component: { nodeId: '198:104578', name: 'Node Details - Note Section' },
  axes: {
    'Property 1': {
      Default: { nodeId: '198:95091', props: { component: 'NodeDetails', state: 'change-list', addChange: 'set' } },
      Edit: { nodeId: '198:104579', props: { component: 'NodeDetails', state: 'add-change', addChange: 'set' } },
      Preview: { nodeId: '198:106305', props: { component: 'NoteSection' } },
    },
  },
  layers: {
    'Frame 12 / Buttons/Button (md)': 'Default: Add note (Button hierarchy="secondary" size="md") · Edit: the same, disabled',
    'Frame 12 / Buttons/Button (sm)': 'Edit: Cancel (Button hierarchy="secondary" size="sm")',
    'Frame 14 / Textarea input field': 'Edit: the Description textarea',
    'Node Details - Notes Screenshots': 'Edit: <NoteScreenshots>',
    'Frame 13 / Buttons/Button': 'Edit: Add change note (Button hierarchy="secondary" size="sm"), right-aligned',
    'After adding': 'NoteSection root: flex-col gap-md',
    'Frame 21 / Title': 'title (text-md semibold text-primary)',
    'Frame 21 / Author / Badge': 'badge (Badge size="md" color="orange" "Requested")',
    'Frame 18': 'actions: Edit · Delete · Dismiss (Button hierarchy="secondary" size="md"), gap-lg, p-2.5',
    'Note / reviewer': 'body: p-lg rounded-md flex-col gap-md',
    'Note / reviewer / Subtitle': 'children (text-sm text-tertiary)',
    'Note / reviewer / Screenshots': 'screenshots: ImageThumbnail h-11.25 w-18 rounded-sm, justify-end gap-md',
  },
  instances: { Badge: '111:4204', 'Buttons/Button': ['111:11173', '111:11178', '111:11293'] },
} as const;
