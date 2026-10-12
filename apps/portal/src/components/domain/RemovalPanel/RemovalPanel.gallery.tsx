import { Button } from '../../Button';
import { inBothThemes, type GalleryEntry } from '../../primitives';
import { RemovalPanel } from '.';

const uses = [
  { componentId: '1:10', name: 'Button', livePlacements: 4 },
  { componentId: '1:11', name: 'Pricing card', livePlacements: 0 },
  { componentId: '1:12', name: 'Avatar', livePlacements: 12 },
];

export default {
  component: 'RemovalPanel',
  examples: inBothThemes([
    {
      figma: 'Removal panel (with a warning)',
      render: () => (
        <RemovalPanel
          className="w-120"
          name="Files"
          uses={uses}
          warnings={[{ code: 'main_removed_with_live_placements', componentId: '1:11', livePlacements: 2 }]}
          action={
            <Button hierarchy="secondary" size="sm">
              Copy removal prompt
            </Button>
          }
        />
      ),
    },
    { figma: 'Removal panel (no components)', render: () => <RemovalPanel className="w-120" name="Draft" uses={[]} /> },
  ]),
} satisfies GalleryEntry;
