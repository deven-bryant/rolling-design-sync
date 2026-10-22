/** Figma → code for `domain/NodeDetails/` (Portal file `PORTAL_DESIGN_FILE`, Portal components page). */

/**
 * `Node Details` (`50:14271`) → `<NodeDetails>`; placed in the *Node drawer* (`22:1988`) as `50:15024`.
 * `State=Change List` fills its container (designed at 1080px: Attribute plus two equal From / To columns);
 * `State=Change History` is compact (485px in the 505px drawer). `State=Add Change` is the Change List tab with the
 * note input in place of the table.
 */
export const figmaNodeDetails = {
  /** `Node Details Header` (`198:79445`): the header and status row every variant places. */
  header: { nodeId: '198:79445', name: 'Node Details Header' },
  component: { nodeId: '50:14271', name: 'Node Details' },
  axes: {
    State: {
      'Change List': { nodeId: '50:14270', props: { state: 'change-list' } },
      'Add Change': { nodeId: '173:34249', props: { state: 'add-change' } },
      'Change History': { nodeId: '50:14272', props: { state: 'change-history' } },
      'Change List - Existing Note': { nodeId: '198:45537', props: { state: 'change-list', notes: '<NoteSection> per open note' } },
    },
    Context: {
      Default: { props: {} },
      'Render mismatch sbs': { nodeId: '197:35103', props: { renderCheck: '<RenderCheck status="mismatch" view="side-by-side">' } },
      'Render mismatch heatmap': { nodeId: '197:53702', props: { renderCheck: '<RenderCheck status="mismatch" view="heatmap">' } },
    },
  },
  /** The set's variants (not every State × Context pair is drawn). */
  variants: [
    'State=Change List - No Note, Context=Default',
    'State=Change List - No Note, Context=Excluded from render check',
    'State=Change List - Existing Note, Context=Default',
    'State=Change List - Existing Note, Context=Node contained by mismatched target',
    'State=Change List, Context=Render mismatch sbs',
    'State=Change List, Context=Render mismatch heatmap',
    'State=Add Change, Context=Default',
    'State=Change History, Context=Default',
  ],
  /** Figma layer → prop / part. */
  layers: {
    'Custom Section header': 'SectionHeader (title · description · actions)',
    'Node Details Header': 'SectionHeader: title, then SupportingContent (gap-xs) with the description and the status row',
    'Node Details Header / Status': 'status (md pill Badges: state, change, render mismatch, categories) in a py-xxs row, gap-md, named by a hidden "Status" label',
    'Section / Claim': 'Change List: gap-md, text fills · Change History: justify-between, gap-6xl (48px), text hugs',
    'Section / Claim / Title': 'claimTitle',
    'Section / Claim / Subtitle': 'claimSubtitle · claimNote',
    'Section / Claim / Buttons/Button': 'claimAction (Button size="sm" hierarchy="secondary")',
    'Horizontal tabs': 'Tabs type="button-brand" size="md" fullWidth (the State switch), spacing-3xl above the panel',
    'Node Details - Note Section / Frame 12': 'the addChange toggle row (h-9 px-md, space-between): Add note (Button hierarchy="secondary" size="md", aria-expanded; disabled while open)',
    'Node Details - Note Section / Frame 12 / Buttons/Button': 'Edit: Cancel (Button hierarchy="secondary" size="sm"), back to the change list',
    'Frame 14 / Textarea input field': 'addChange: <Textarea label="Description" required tooltip placeholder="Enter a description..." /> (px-md)',
    'Frame 13 / Buttons/Button': 'addChange: Add change note (Button hierarchy="secondary" size="sm"), right-aligned',
    'Table / Card header': 'Card.Header title="Change List" (badge, changesDescription, changesMenu)',
    'Table / Content': 'Table: Attribute · From · To (TextCell with supportingText)',
    'Table / Pagination': 'Pagination (Type=Card default)',
    'Activity feed': 'Feed divider="none" of FeedItem (history), hugging its items',
  },
  instances: {
    'Custom Section header': '50:14809',
    Badge: ['9:3881', '9:3879', '9:3889', '9:3887'],
    Button: '9:2363',
    'Horizontal tabs': ['50:14119', '50:14281'],
    'Card header': '9:6091',
    Pagination: '9:2870',
    'Activity feed': '22:1212',
  },
} as const;
