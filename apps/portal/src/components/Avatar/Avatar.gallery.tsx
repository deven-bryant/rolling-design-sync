import { inBothThemes, type GalleryEntry } from '../primitives';
import { Avatar, AvatarLabelGroup } from '.';

const photo =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#d6bbfb"/></svg>');

export default {
  component: 'Avatar',
  examples: inBothThemes([
    {
      figma: 'Size=sm, Placeholder=False, Text=True, Status icon=Online indicator',
      render: () => <Avatar size="sm" alt="Olivia Rhye" initials="OR" status="online" />,
    },
    {
      figma: 'Size=md, Placeholder=False, Text=False, Status icon=False',
      render: () => <Avatar size="md" alt="Olivia Rhye" src={photo} />,
    },
    {
      figma: 'Size=md, Placeholder=False, Text=False, Status icon=Online indicator',
      render: () => <Avatar size="md" alt="Olivia Rhye" src={photo} status="online" />,
    },
    {
      figma: 'Size=lg, Placeholder=False, Text=False, Status icon=Online indicator',
      render: () => <Avatar size="lg" alt="Olivia Rhye" src={photo} status="online" />,
    },
    {
      figma: 'Sizes (xs · sm · md · lg · xl · 2xl), Text=True',
      render: () => (
        <span className="flex items-center gap-md">
          {(['xs', 'sm', 'md', 'lg', 'xl', '2xl'] as const).map(size => (
            <Avatar key={size} size={size} alt="Olivia Rhye" initials="OR" status="online" />
          ))}
        </span>
      ),
    },
    {
      figma: 'Placeholder=True',
      render: () => <Avatar size="md" alt="Unknown user" placeholder />,
    },
    {
      figma: 'Avatar label group · Size=md, Status icon=Online indicator',
      render: () => <AvatarLabelGroup src={photo} status="online" label="Olivia Rhye" supportingText="olivia@untitledui.com" />,
    },
  ]),
} satisfies GalleryEntry;
