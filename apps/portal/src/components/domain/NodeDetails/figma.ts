/** Figma → code for `domain/NodeDetails/` (Portal file `PORTAL_DESIGN_FILE`, Portal components page). */

/**
 * `Node Details` (`50:14271`) → `<NodeDetails>`; placed in the *Node drawer* (`22:1988`) as `50:15024`.
 * `State=Change List` fills its container (designed at 1080px: Attribute plus two equal From / To columns);
 * `State=Change History` is compact (485px in the 505px drawer). `State=Add Change` is the Change List tab with the
 * note input in place of the table.
 */
export const figmaNodeDetails = {
  component: { nodeId: '50:14271', name: 'Node Details' },
  axes: {
    State: {
      'Change List': { nodeId: '50:14270', props: { state: 'change-list' } },
      'Add Change': { nodeId: '173:34249', props: { state: 'add-change' } },
      'Change History': { nodeId: '50:14272', props: { state: 'change-history' } },
    },
  },
  /** Figma layer → prop / part. */
  layers: {
    'Custom Section header': 'SectionHeader (title · description · actions)',
    'Frame 3 / Subtitle': '"Status" label (text-sm medium text-primary)',
    'Frame 3 / Status': 'status (md pill Badges: state, change, categories); fills on Change List, hugs on Change History',
    'Section / Claim': 'Change List: gap-md, text fills · Change History: justify-between, gap-6xl (48px), text hugs',
    'Section / Claim / Title': 'claimTitle',
    'Section / Claim / Subtitle': 'claimSubtitle · claimNote',
    'Section / Claim / Buttons/Button': 'claimAction (Button size="sm" hierarchy="secondary")',
    'Horizontal tabs': 'Tabs type="button-brand" size="md" fullWidth (the State switch), spacing-3xl above the panel',
    'Frame 12 / Dropdown': 'the addChange toggle: Button hierarchy="link-color" size="md" with chevron-down / chevron-up (aria-expanded), h-9 px-md',
    'Frame 12 / Buttons/Button': 'Add Change: Cancel (Button hierarchy="link-gray" size="sm"), back to the change list',
    'Frame 14 / Textarea input field': 'addChange: <Textarea label="Description" required tooltip placeholder="Enter a description..." /> (px-md)',
    'Frame 13 / Buttons/Button': 'addChange: Add Change Note (Button hierarchy="secondary" size="sm"), right-aligned',
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
