import { inBothThemes, type GalleryEntry } from '../../primitives';
import { diffDetails, renderCheckMeta as meta, renderCheckMismatch as mismatch } from '../gallerySamples';
import { DiffStatus, RenderCheck, RenderCheckHeader, type RenderCheckStatus } from '.';

const messages: [RenderCheckStatus, string][] = [
  ['not-set-up', 'This frame isn’t a screen yet. An agent sets its route and viewport.'],
  ['building', 'Nodes under it are still dirty; check it once they’re built.'],
  ['requested', 'Waiting for an agent to render it (rds-agent check).'],
];

export default {
  component: 'RenderCheck',
  figma: 'Node Details - Render Check',
  examples: inBothThemes([
    { figma: 'Property 1=Side by Side', render: () => <RenderCheck {...mismatch('side-by-side')} /> },
    { figma: 'Property 1=Heatmap', render: () => <RenderCheck {...mismatch('heatmap')} /> },
    ...messages.map(([status, message]) => ({ figma: `Status: ${status}`, render: () => <RenderCheck status={status} message={message} /> })),
    { figma: 'Render Check Header: Default', set: 'Render Check Header', variant: 'Property 1=Default', render: () => <RenderCheckHeader meta={meta} /> },
    { figma: 'Render Check Header: Variant2', set: 'Render Check Header', variant: 'Property 1=Variant2', render: () => <RenderCheckHeader meta={meta} /> },
    { figma: 'Diff Status', set: 'Diff Status', variant: '', render: () => <DiffStatus score="3.4%" regions={2} details={diffDetails} /> },
  ]),
} satisfies GalleryEntry;
