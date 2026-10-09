import { Avatar } from '../../Avatar';
import { Badge } from '../../Badge';
import { Button } from '../../Button';
import { Menu } from '../../Menu';
import type { GalleryEntry, GalleryExample } from '../../primitives';
import { NodeDetails, type NodeDetailsChange, type NodeDetailsEvent, type NodeDetailsProps } from '.';

const changes: NodeDetailsChange[] = [
  { attribute: 'fills', from: { value: 'bg-primary', detail: '#FFFFFF' }, to: { value: 'bg-secondary', detail: '#F7FBFC' } },
  { attribute: 'strokes', from: { value: 'border-secondary', detail: '#E7EAEC' }, to: { value: 'border-primary', detail: '#D3D8DA' } },
  { attribute: 'itemSpacing', from: { value: 'spacing-md', detail: '8' }, to: { value: 'spacing-lg', detail: '12' } },
];

const history: NodeDetailsEvent[] = [
  { id: 3, avatar: <Avatar size="lg" alt="devin" initials="DE" />, name: 'devin', time: '2 min ago', children: 'Claimed it' },
  { id: 2, avatar: <Avatar size="lg" alt="cursor" initials="CU" />, name: 'cursor', time: '1 hour ago', children: 'Released the claim' },
  { id: 1, avatar: <Avatar size="lg" alt="figma" initials="FI" />, name: 'figma', time: '2 days ago', children: 'Changed fills' },
];

function Example(props: Pick<NodeDetailsProps, 'defaultState' | 'paginationLabel'>) {
  return (
    <NodeDetails
      {...props}
      title="Breadcrumbs"
      description="INSTANCE · 1:2345 → Breadcrumbs"
      status={
        <>
          <Badge size="md" color="warning">
            Dirty
          </Badge>
          <Badge size="md" color="brand">
            Changed
          </Badge>
          <Badge size="md" color="indigo">
            color
          </Badge>
          <Badge size="md" color="blue-light">
            effects
          </Badge>
        </>
      }
      claimSubtitle="devin · claimed 2 min ago · lease expires in 15 min"
      claimAction={
        <Button hierarchy="secondary" size="sm">
          Release claim
        </Button>
      }
      changes={changes}
      changesDescription="Since cleared at 3f2a9c1 (2 days ago)"
      changesMenu={
        <Menu label="Change list actions">
          <Menu.Item id="figma">Open in Figma</Menu.Item>
        </Menu>
      }
      history={history}
    />
  );
}


const themes = [
  ['Light', undefined],
  ['Dark', 'dark'],
] as const;

/** Each example once per theme: `Color Mode` is the `data-theme` it renders under, never a prop. */
const bothThemes = (examples: { figma: string; render: (mode: string) => ReturnType<GalleryExample['render']> }[]) =>
  themes.flatMap(([mode, theme]) =>
    examples.map(({ figma, render }): GalleryExample => ({
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
  examples: bothThemes([
    { figma: 'State=Change List', render: mode => <Example defaultState="change-list" paginationLabel={`Change list pages (${mode})`} /> },
    { figma: 'State=Change History', render: () => <Example defaultState="change-history" /> },
  ]),
} satisfies GalleryEntry;
