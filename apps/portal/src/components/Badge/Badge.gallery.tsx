import { Icon, type GalleryEntry } from '../primitives';
import { Badge, BadgeDot, FeaturedIcon, figmaBadge } from '.';

export default {
  component: 'Badge',
  examples: [
    ...Object.entries(figmaBadge.variants).map(([figma, { props }]) => ({ figma, render: () => <Badge {...props}>Label</Badge> })),
    {
      figma: 'Type=Pill color · Badge color · Badge modern',
      render: () => (
        <span className="flex items-center gap-md">
          <Badge type="pill-color" color="brand">
            Label
          </Badge>
          <Badge type="badge-color" color="brand">
            Label
          </Badge>
          <Badge type="badge-modern" color="brand" dot>
            Label
          </Badge>
        </span>
      ),
    },
    {
      figma: 'Icon=Dot · Icon leading · Icon trailing',
      render: () => (
        <span className="flex items-center gap-md">
          <Badge color="success" dot>
            Label
          </Badge>
          <Badge size="md" color="brand" iconLeading={<Icon name="arrow-up-right" />}>
            Label
          </Badge>
          <Badge size="md" color="gray" iconTrailing={<Icon name="x-close" />}>
            Label
          </Badge>
        </span>
      ),
    },
    { figma: '_Dot · Size=md, Outline=False', render: () => <BadgeDot size="md" /> },
    { figma: 'Featured icon · Size=md, Color=Gray, Type=Modern', render: () => <FeaturedIcon /> },
  ],
} satisfies GalleryEntry;
