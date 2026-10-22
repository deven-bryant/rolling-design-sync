import { Avatar } from '../../Avatar';
import { Badge } from '../../Badge';
import { Button, CloseButton } from '../../Button';
import { Menu } from '../../Menu';
import { SectionHeader } from '../../SectionHeader';
import type { GalleryEntry, GalleryExample } from '../../primitives';
import {
  addChangeForm,
  containingTargets,
  renderCheckExcludedHint,
  renderCheckMismatch,
  renderCheckResults,
  renderCheckTargetDetails,
  targetNote,
} from '../gallerySamples';
import { NoteSection } from '../NoteSection';
import { RenderCheck } from '../RenderCheck';
import { HeatmapCrop, RenderCheckHistory, RenderChecksContaining, RenderCheckTargetDetails } from '../RenderCheckTarget';
import { sampleImage } from '../../Lightbox/sample';
import { NodeDetails, type NodeDetailsChange, type NodeDetailsEvent, type NodeDetailsProps } from '.';

const changes: NodeDetailsChange[] = [
  { attribute: 'fills', from: { value: 'bg-primary', detail: '#FFFFFF' }, to: { value: 'bg-secondary', detail: '#F9FAFB' } },
  {
    attribute: 'effects',
    from: { value: 'shadow-sx', detail: '0 1 2 #0A0D120D' },
    to: { value: 'shadow-sm', detail: '0 1 3 #0A0D121A, 0 1 2 #0A0D120F' },
  },
];

const history: NodeDetailsEvent[] = [
  { id: 4, avatar: <Avatar size="lg" alt="devin" initials="DE" />, name: 'devin', time: '1 min ago', children: 'Claimed this node with 3 others (lease 15 min).' },
  { id: 3, avatar: <Avatar size="lg" alt="plugin" initials="PL" />, name: 'plugin', time: '12 min ago', children: 'Synced Team View — fills and effects changed.' },
  { id: 2, avatar: <Avatar size="lg" alt="claude-local" initials="CL" />, name: 'claude-local', time: '2 days ago', children: 'Cleared at 3f2a9c1 after implementing Table.' },
  { id: 1, avatar: <Avatar size="lg" alt="plugin" initials="PL" />, name: 'plugin', time: '3 days ago', children: 'First sync of Team View — node added.' },
];

const badges = (...labels: [string, NonNullable<Parameters<typeof Badge>[0]['color']>][]) =>
  labels.map(([label, color]) => (
    <Badge key={label} size="md" color={color}>
      {label}
    </Badge>
  ));

const close = <CloseButton size="md" aria-label="Close" />;

const claimed: Partial<NodeDetailsProps> = {
  claimDetails: [
    { label: 'Name', value: 'devin' },
    { label: 'Claim Time', value: '1m ago' },
    { label: 'Lease Expiration', value: '14 min' },
  ],
  claimAction: (
    <Button hierarchy="secondary" size="sm">
      Release claim
    </Button>
  ),
};

/** A node in the Team members table (`Context=Default`). */
const tableNode: Partial<NodeDetailsProps> = {
  ...claimed,
  title: 'Table',
  description: 'INSTANCE · 1:94997 → main 1:37155 Table / Team members',
  status: badges(['Dirty', 'warning'], ['Modified', 'brand'], ['color', 'indigo'], ['effects', 'blue-light']),
};

/** A screen whose last render check found a mismatch. */
const mismatchedScreen = (view: 'side-by-side' | 'heatmap'): Partial<NodeDetailsProps> => ({
  title: 'Node',
  description: 'COMPONENT · View=Nodes · screen',
  status: badges(['Dirty', 'warning'], ['Render mismatch', 'error'], ['render', 'indigo']),
  renderCheck: (
    <>
      <RenderCheck {...renderCheckMismatch(view)} />
      <RenderCheckTargetDetails excluded={false} onExcludedChange={() => {}} details={renderCheckTargetDetails} />
      <RenderCheckHistory results={renderCheckResults} onSelect={() => {}} />
    </>
  ),
});

const contexts = {
  Default: tableNode,
  'Excluded from render check': {
    ...claimed,
    title: 'Table',
    description: 'FRAME · 1:27905',
    status: badges(['Clean', 'success']),
    renderCheck: <RenderCheckTargetDetails excluded onExcludedChange={() => {}} hint={renderCheckExcludedHint} learnMoreHref="/docs" />,
  },
  'Node contained by mismatched target': {
    ...claimed,
    title: 'Table',
    description: 'INSTANCE · 1:94997 → main 1:37155 Table / Team members',
    status: badges(['Dirty', 'warning'], ['Requested', 'orange'], ['render', 'indigo']),
    renderCheck: <RenderChecksContaining onOpen={() => {}} targets={containingTargets} />,
  },
  'Render mismatch sbs': mismatchedScreen('side-by-side'),
  'Render mismatch heatmap': mismatchedScreen('heatmap'),
} satisfies Record<string, Partial<NodeDetailsProps>>;

const targetNoteSection = (
  <NoteSection
    title="Open notes (1)"
    badge={
      <Badge size="md" color="error">
        Render mismatch
      </Badge>
    }
    actions={
      <Button hierarchy="link-color" size="sm">
        Go to target
      </Button>
    }
    screenshots={<HeatmapCrop src={sampleImage('Heatmap')} width={320} height={200} region={{ x: 40, y: 0, width: 260, height: 24 }} alt="Region 1" />}
  >
    {targetNote}
  </NoteSection>
);

function Example({ context, ...props }: Partial<NodeDetailsProps> & { context: keyof typeof contexts }) {
  return (
    <NodeDetails
      title="Table"
      actions={close}
      changes={changes}
      changesDescription="2 days ago since it was last cleared at 3f2a9c1"
      changesMenu={
        <Menu label="Change list actions">
          <Menu.Item id="figma">Open in Figma</Menu.Item>
        </Menu>
      }
      history={history}
      addChange={addChangeForm}
      {...contexts[context]}
      {...props}
    />
  );
}

/** `Node Details Header` (`198:79445`): the header every Node Details variant places. */
function Header() {
  return (
    <SectionHeader>
      <SectionHeader.Title>Node</SectionHeader.Title>
      <SectionHeader.SupportingContent className="flex-col gap-xs">
        <div>COMPONENT · View=Nodes · screen</div>
        <div className="flex flex-wrap items-center gap-md py-xxs">{badges(['Dirty', 'warning'], ['Render mismatch', 'error'], ['render', 'indigo'])}</div>
      </SectionHeader.SupportingContent>
      <SectionHeader.Actions>{close}</SectionHeader.Actions>
    </SectionHeader>
  );
}

const themes = [
  ['Light', undefined],
  ['Dark', 'dark'],
] as const;

/** Each example once per theme: `Color Mode` is the `data-theme` it renders under, never a prop. */
const bothThemes = (examples: (Omit<GalleryExample, 'render'> & { render: (mode: string) => ReturnType<GalleryExample['render']> })[]) =>
  themes.flatMap(([mode, theme]) =>
    examples.map(({ figma, render, ...rest }): GalleryExample => ({
      ...rest,
      figma: `${figma} · Color Mode=${mode}`,
      render: () => (
        <div data-theme={theme} className="bg-primary">
          {render(mode)}
        </div>
      ),
    })),
  );

export default {
  component: 'NodeDetails',
  figma: 'Node Details',
  examples: bothThemes([
    { figma: 'State=Change List - No Note, Context=Default', render: mode => <Example context="Default" defaultState="change-list" paginationLabel={`Change list pages (1, ${mode})`} /> },
    {
      figma: 'State=Change List - No Note, Context=Excluded from render check',
      render: mode => <Example context="Excluded from render check" defaultState="change-list" paginationLabel={`Change list pages (2, ${mode})`} />,
    },
    {
      figma: 'State=Change List - Existing Note, Context=Default',
      render: mode => <Example context="Default" defaultState="change-list" notes={targetNoteSection} paginationLabel={`Change list pages (3, ${mode})`} />,
    },
    {
      figma: 'State=Change List - Existing Note, Context=Node contained by mismatched target',
      render: mode => <Example context="Node contained by mismatched target" defaultState="change-list" notes={targetNoteSection} paginationLabel={`Change list pages (4, ${mode})`} />,
    },
    { figma: 'State=Change List, Context=Render mismatch sbs', render: mode => <Example context="Render mismatch sbs" defaultState="change-list" paginationLabel={`Change list pages (5, ${mode})`} /> },
    {
      figma: 'State=Change List, Context=Render mismatch heatmap',
      render: mode => <Example context="Render mismatch heatmap" defaultState="change-list" paginationLabel={`Change list pages (6, ${mode})`} />,
    },
    {
      figma: 'State=Add Change, Context=Default',
      render: mode => <Example context="Default" defaultState="add-change" paginationLabel={`Change list pages (7, ${mode})`} />,
    },
    { figma: 'State=Change History, Context=Default', render: mode => <Example context="Default" defaultState="change-history" paginationLabel={`Change list pages (7, ${mode})`} /> },
    { figma: 'Node Details Header', set: 'Node Details Header', variant: '', render: () => <Header /> },
  ]),
} satisfies GalleryEntry;
