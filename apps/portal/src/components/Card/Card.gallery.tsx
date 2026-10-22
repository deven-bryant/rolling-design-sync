import { inBothThemes, Icon, type GalleryEntry } from '../primitives';
import { Badge } from '../Badge';
import { Button } from '../Button';
import { Card } from './Card';

const button = 'rounded-md border border-primary bg-primary px-3.5 py-2.5 text-sm font-semibold text-secondary shadow-xs';

export default {
  component: 'Card',
  figma: 'Card header',
  examples: inBothThemes([
    {
      figma: 'Card header',
      variant: '',
      render: () => (
        <Card.Header
          title="Team members"
          badge={<Badge color="brand">10/20 seats</Badge>}
          description="Manage your team members and their account permissions here."
          actions={
            <>
              <Button hierarchy="tertiary" size="md">
                Tertiary
              </Button>
              <Button hierarchy="secondary" size="md">
                Secondary
              </Button>
              <Button hierarchy="secondary" size="md">
                Secondary
              </Button>
              <Button hierarchy="primary" size="md">
                Primary
              </Button>
            </>
          }
          menu={
            <button type="button" aria-label="More" className="self-start text-fg-quaternary">
              <Icon name="dots-vertical" size="md" />
            </button>
          }
        />
      ),
    },
    {
      figma: 'Card header: Avatar=False, Breakpoint=Desktop', set: 'Card header', variant: 'Avatar=False, Breakpoint=Desktop',
      render: () => (
        <Card>
          <Card.Header
            title="Team members"
            badge={<Badge color="brand">100 users</Badge>}
            description="Manage your team members and their account permissions here."
            actions={
              <>
                <button type="button" className={button}>
                  Secondary
                </button>
                <button type="button" className={button}>
                  Primary
                </button>
              </>
            }
            menu={
              <button type="button" aria-label="More" className="self-start text-fg-quaternary">
                <Icon name="dots-vertical" size="md" />
              </button>
            }
          />
          <Card.Body className="p-3xl">Body</Card.Body>
          <Card.Footer>Footer</Card.Footer>
        </Card>
      ),
    },
    {
      figma: 'Card header without a divider or supporting text',
      render: () => (
        <Card>
          <Card.Header title="Team members" divider={false} />
          <Card.Body className="p-3xl">Body</Card.Body>
        </Card>
      ),
    },
  ]),
} satisfies GalleryEntry;
