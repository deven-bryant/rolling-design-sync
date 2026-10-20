import { Button } from '../../Button';
import { inBothThemes, type GalleryEntry } from '../../primitives';
import { ClaimHolder } from '.';

export default {
  component: 'ClaimHolder',
  figma: 'Node Details - Claim Holder',
  examples: inBothThemes([
    {
      figma: 'Property 1=Claimed',
      render: () => (
        <ClaimHolder
          details={[
            { label: 'Name', value: 'devin' },
            { label: 'Claim Time', value: '1m ago' },
            { label: 'Lease Expiration', value: '14 min' },
          ]}
          action={
            <Button hierarchy="secondary" size="sm">
              Release claim
            </Button>
          }
        />
      ),
    },
    { figma: 'Property 1=Unclaimed', render: () => <ClaimHolder /> },
  ]),
} satisfies GalleryEntry;
