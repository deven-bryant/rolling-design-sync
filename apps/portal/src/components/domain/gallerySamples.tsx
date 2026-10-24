import { Button } from '../Button';
import { Textarea } from '../Input';
import { sampleImage } from '../Lightbox/sample';
import { Icon } from '../primitives';
import { NoteScreenshots } from './NoteScreenshots';
import type { RenderCheckProps } from './RenderCheck';
import type { ContainingTarget, RenderCheckResult } from './RenderCheckTarget';

/** Sample content the Portal file's render-check frames show, shared by the gallery examples that place them. */

export const renderCheckMeta = [
  { label: 'Checked', value: '2h ago' },
  { label: 'Commit', value: '4b11b44' },
  { label: 'Source', value: 'ci-playwright' },
  { label: 'Limit', value: '1%' },
];

export const diffDetails = ['Page header renders 12 px taller than the frame', 'Nodes table: the footer divider is missing'];

const image = (label: string) => ({ src: sampleImage(label), width: 320, height: 200 });

export const renderCheckMismatch = (view: RenderCheckProps['view']): RenderCheckProps => ({
  status: 'mismatch',
  meta: renderCheckMeta,
  defaultView: view,
  designed: image('Designed'),
  implemented: image('Implemented'),
  heatmap: image('Heatmap'),
  regions: [
    { x: 40, y: 0, width: 260, height: 24 },
    { x: 40, y: 170, width: 260, height: 18 },
  ],
  diff: { score: '3.4%', regions: 2 },
  details: diffDetails,
  actions: (
    <>
      <Button hierarchy="secondary" size="md">
        Check settings
      </Button>
      <Button hierarchy="primary" size="md">
        Request check
      </Button>
    </>
  ),
});

export const renderCheckTargetDetails = [
  { label: 'Level', value: 'Screen' },
  { label: 'Source', value: 'Auto · section “Screens”' },
  {
    label: 'Route',
    value: '/files/:fileKey/nodes',
    action: (
      <Button hierarchy="link-gray" size="sm" iconOnly iconLeading={<Icon name="edit-01" />}>
        Edit route
      </Button>
    ),
  },
  { label: 'Variants', value: 'Color Mode: Light · Dark (same route)' },
  { label: 'Theme', value: 'color-scheme' },
];

export const renderCheckExcludedHint =
  'This section isn’t set up for render checks. Choose Screens or Components for it in the plugin to check it automatically.';

export const renderCheckResults: RenderCheckResult[] = [
  { id: 'k5', status: 'mismatch', summary: '3.4% · 4b11b44', time: '2h ago', viewing: true },
  { id: 'k4', status: 'mismatch', summary: '5.1% · 9c03e2a', time: 'yesterday' },
  { id: 'k3', status: 'passed', summary: '0.4% · 71fd0b2', time: '3 days ago', baseline: true },
  { id: 'k2', status: 'passed', summary: '0.2% · 5e0a9d1', time: '5 days ago' },
  { id: 'k1', status: 'error', summary: 'No route · —', time: '6 days ago' },
];

export const containingTargets: ContainingTarget[] = [
  { id: '1:1', name: 'Portal / View=Nodes, Color Mode=Light', meta: 'Screen · checked 2h ago', status: 'mismatch' },
  { id: '1:2', name: 'Portal / View=Nodes, Color Mode=Dark', meta: 'Screen · checked 2h ago', status: 'passed' },
  { id: '1:3', name: 'Breadcrumbs / Default', meta: 'Component · checked 2h ago', status: 'passed' },
];

export const noteScreenshots = [
  { id: 'a', src: sampleImage('Work items'), name: 'built-work-items.png', detail: '412 KB' },
  { id: 'b', src: sampleImage('Dark', '#41474b'), name: 'built-dark.png', detail: '388 KB' },
];

export const targetNote =
  'Render check on Portal / View=Nodes, Color Mode=Light (4b11b44): this node renders 12 px taller than the frame. Region 1 of 2.';

const noop = () => undefined;

/** `Node Details - Note Section` (`Property 1=Edit`): the note form NodeDetails shows in place of the change list. */
export const addChangeForm = (
  <>
    <Textarea label="Description" required tooltip="What should change, and where" placeholder="Enter a description..." />
    <NoteScreenshots screenshots={noteScreenshots} onAdd={noop} onRemove={noop} />
    <div className="flex justify-end">
      <Button hierarchy="secondary" size="sm">
        Add change note
      </Button>
    </div>
  </>
);
