import { inBothThemes, Icon, type GalleryEntry } from '../primitives';
import { Avatar } from '../Avatar';
import { Badge } from '../Badge';
import { ButtonUtility } from '../Button';
import { ActionsCell, AvatarCell, BadgeCell, BadgesCell, LeadAction, ProgressCell, Table, TextCell } from './Table';

const photo =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#d6bbfb"/></svg>');

const badges = [
  <Badge key="design" color="brand">Design</Badge>,
  <Badge key="product" color="blue">Product</Badge>,
  <Badge key="marketing" color="indigo">Marketing</Badge>,
  <Badge key="pink" color="pink">Pink</Badge>,
  <Badge key="orange" color="orange">Orange</Badge>,
  <Badge key="gray" color="gray">Gray</Badge>,
];

function Example({ selected }: { selected?: boolean }) {
  return (
    <Table>
      <Table.Header>
        <Table.HeaderCell className="w-80">Name</Table.HeaderCell>
        <Table.HeaderCell>Status</Table.HeaderCell>
        <Table.HeaderCell>Teams</Table.HeaderCell>
        <Table.HeaderCell className="w-70">Progress</Table.HeaderCell>
      </Table.Header>
      <Table.Body>
        <Table.Row selected={selected}>
          <TextCell supportingText="olivia@untitledui.com" leadAction={<LeadAction aria-label="Select Olivia Rhye" />}>
            Olivia Rhye
          </TextCell>
          <BadgeCell>
            <Badge color="success">Active</Badge>
          </BadgeCell>
          <BadgesCell badges={badges} max={3} />
          <ProgressCell value={60} label="Onboarding" />
        </Table.Row>
      </Table.Body>
    </Table>
  );
}

function AvatarActionsExample() {
  return (
    <Table>
      <Table.Header>
        <Table.HeaderCell>Name</Table.HeaderCell>
        <Table.HeaderCell text={false}>Actions</Table.HeaderCell>
      </Table.Header>
      <Table.Body>
        <Table.Row>
          <AvatarCell
            avatar={<Avatar size="md" alt="Olivia Rhye" src={photo} />}
            supportingText="olivia@untitledui.com"
            leadAction={<LeadAction aria-label="Select Olivia Rhye" />}
          >
            Olivia Rhye
          </AvatarCell>
          <ActionsCell>
            {['Copy', 'Edit', 'Share', 'Delete'].map(label => (
              <ButtonUtility key={label} size="xs" hierarchy="tertiary" icon={<Icon name="placeholder" />} tooltip={label} />
            ))}
          </ActionsCell>
        </Table.Row>
      </Table.Body>
    </Table>
  );
}

export default {
  component: 'Table',
  examples: inBothThemes([
    { figma: 'State=Default (Type=Text · Badge · Badges multiple · Progress bar) · Table header cell', render: () => <Example /> },
    { figma: 'State=Hover/selected', render: () => <Example selected /> },
    { figma: 'Type=Avatar · Type=Action icons · Table header cell Text=False', render: () => <AvatarActionsExample /> },
  ]),
} satisfies GalleryEntry;
