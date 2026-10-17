import { Button } from '../../Button';
import { sampleImage } from '../../Lightbox/sample';
import { inBothThemes, type GalleryEntry } from '../../primitives';
import { RenderCheck, RenderCheckHeader, type RenderCheckProps, type RenderCheckStatus } from '.';

const meta = [
  { label: 'Checked', value: '2h ago' },
  { label: 'Commit', value: '4b11b44' },
  { label: 'Source', value: 'ci-playwright' },
  { label: 'Limit', value: '1%' },
];

const image = (label: string) => ({ src: sampleImage(label), width: 320, height: 200 });

const mismatch = (view: RenderCheckProps['view']): RenderCheckProps => ({
  status: 'mismatch',
  meta,
  defaultView: view,
  designed: image('Designed'),
  implemented: image('Implemented'),
  heatmap: image('Heatmap'),
  regions: [
    { x: 40, y: 0, width: 260, height: 24 },
    { x: 40, y: 170, width: 260, height: 18 },
  ],
  summary: '3.4% of pixels differ · 2 regions',
  details: ['260 × 24 px at 40, 0', '260 × 18 px at 40, 170'],
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

const messages: [RenderCheckStatus, string][] = [
  ['not-set-up', 'This frame isn’t a screen yet. An agent sets its route and viewport.'],
  ['building', 'Nodes under it are still dirty; check it once they’re built.'],
  ['requested', 'Waiting for an agent to render it (rds-agent check).'],
];

export default {
  component: 'RenderCheck',
  examples: inBothThemes([
    { figma: 'Property 1=Side by Side', render: () => <RenderCheck {...mismatch('side-by-side')} /> },
    { figma: 'Property 1=Heatmap', render: () => <RenderCheck {...mismatch('heatmap')} /> },
    ...messages.map(([status, message]) => ({ figma: `Status=${status}`, render: () => <RenderCheck status={status} message={message} /> })),
    { figma: 'Render Check Header · Variant2', render: () => <RenderCheckHeader meta={meta} /> },
  ]),
} satisfies GalleryEntry;
