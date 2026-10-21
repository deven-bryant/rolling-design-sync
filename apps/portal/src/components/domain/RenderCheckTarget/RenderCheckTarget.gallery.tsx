import { ButtonUtility } from '../../Button';
import { Icon, inBothThemes, type GalleryEntry } from '../../primitives';
import { RenderCheckHistory, RenderChecksContaining, RenderCheckTargetDetails } from '.';

const details = [
  { label: 'Source', value: 'Auto · section “Screens”' },
  { label: 'Route', value: '/files/:fileKey/nodes', action: <ButtonUtility hierarchy="tertiary" icon={<Icon name="edit-01" />} tooltip="Edit route" /> },
  { label: 'Variants', value: 'Color Mode: Light · Dark (same route)' },
  { label: 'Theme', value: 'color-scheme' },
];

export default {
  component: 'RenderCheckTarget',
  figma: 'Render Check Target Details · Render Check History · Render Checks Containing Mismatch Targets',
  examples: inBothThemes([
    { figma: 'Render Check Target Details / Excluded=False', render: () => <RenderCheckTargetDetails excluded={false} onExcludedChange={() => {}} details={details} /> },
    {
      figma: 'Render Check Target Details / Excluded=True',
      render: () => (
        <RenderCheckTargetDetails
          excluded
          onExcludedChange={() => {}}
          hint="Excluded from render checks. It stays excluded when targets are detected again; turn the toggle off to check it."
          learnMoreHref="/docs"
        />
      ),
    },
    {
      figma: 'Render Check History',
      render: () => (
        <RenderCheckHistory
          results={[
            { id: 'k3', status: 'mismatch', summary: '3.4% · 4b11b44', time: '2h ago', viewing: true },
            { id: 'k2', status: 'mismatch', summary: '5.1% · 9c03e2a', time: 'yesterday' },
            { id: 'k1', status: 'passed', summary: '0.4% · 71fd0b2', time: '3 days ago', baseline: true },
          ]}
          onSelect={() => {}}
        />
      ),
    },
    {
      figma: 'Render Checks Containing Mismatch Targets',
      render: () => (
        <RenderChecksContaining
          onOpen={() => {}}
          targets={[
            { id: '1:1', name: 'Portal / View=Nodes, Color Mode=Light', meta: 'Screen · checked 2h ago', status: 'mismatch' },
            { id: '1:2', name: 'Portal / View=Nodes, Color Mode=Dark', meta: 'Screen · checked 2h ago', status: 'passed' },
            { id: '1:3', name: 'Breadcrumbs / Default', meta: 'Component · waiting', status: 'waiting' },
          ]}
        />
      ),
    },
  ]),
} satisfies GalleryEntry;
