import { inBothThemes, Icon, type GalleryEntry } from '../primitives';
import { Button, ButtonUtility, CloseButton } from '.';

const placeholder = <Icon name="placeholder" />;

export default {
  component: 'Button',
  examples: inBothThemes([
    {
      figma: 'Size=md, Hierarchy=Primary, State=Default, Icon only=False',
      render: () => (
        <Button size="md" hierarchy="primary" iconLeading={placeholder} iconTrailing={placeholder}>
          Button CTA
        </Button>
      ),
    },
    {
      figma: 'Size=md, Hierarchy=Secondary, State=Default, Icon only=False',
      render: () => (
        <Button size="md" hierarchy="secondary" iconLeading={placeholder} iconTrailing={placeholder}>
          Button CTA
        </Button>
      ),
    },
    {
      figma: 'Size=md, Hierarchy=Tertiary, State=Default, Icon only=False',
      render: () => (
        <Button size="md" hierarchy="tertiary" iconLeading={placeholder} iconTrailing={placeholder}>
          Button CTA
        </Button>
      ),
    },
    {
      figma: 'Size=sm, Hierarchy=Secondary, State=Default, Icon only=False',
      render: () => (
        <Button size="sm" hierarchy="secondary" iconLeading={placeholder} iconTrailing={placeholder}>
          Button CTA
        </Button>
      ),
    },
    {
      figma: 'Size=sm, Hierarchy=Link color, State=Default, Icon only=False',
      render: () => (
        <Button size="sm" hierarchy="link-color" iconLeading={placeholder} iconTrailing={placeholder}>
          Button CTA
        </Button>
      ),
    },
    {
      figma: 'Size=sm, Hierarchy=Link gray, State=Default, Icon only=False',
      render: () => (
        <Button size="sm" hierarchy="link-gray" iconLeading={placeholder} iconTrailing={placeholder}>
          Button CTA
        </Button>
      ),
    },
    {
      figma: 'Size=sm · md · lg · xl, Hierarchy=Primary',
      render: () => (
        <span className="flex items-center gap-md">
          {(['sm', 'md', 'lg', 'xl'] as const).map(size => (
            <Button key={size} size={size}>
              Button CTA
            </Button>
          ))}
        </span>
      ),
    },
    {
      figma: 'Icon only=True (sm · md · lg · xl)',
      render: () => (
        <span className="flex items-center gap-md">
          {(['sm', 'md', 'lg', 'xl'] as const).map(size => (
            <Button key={size} size={size} hierarchy="secondary" iconOnly iconLeading={placeholder}>
              Button CTA
            </Button>
          ))}
        </span>
      ),
    },
    {
      figma: 'Size=md, Hierarchy=Tertiary, State=Default, Icon only=True',
      render: () => (
        <Button size="md" hierarchy="tertiary" iconOnly iconLeading={placeholder}>
          Button CTA
        </Button>
      ),
    },
    {
      figma: 'State=Disabled · State=Loading (Loading text=True · False)',
      render: () => (
        <span className="flex items-center gap-md">
          <Button size="md" isDisabled>
            Button CTA
          </Button>
          <Button size="md" loading>
            Submitting...
          </Button>
          <Button size="md" hierarchy="secondary" loading loadingText={false}>
            Button CTA
          </Button>
        </span>
      ),
    },
    {
      figma: 'Button as link (href)',
      render: () => (
        <Button size="md" hierarchy="secondary" href="#gallery" iconTrailing={<Icon name="arrow-up-right" />}>
          Open link
        </Button>
      ),
    },
    {
      figma: 'Button utility · Size=xs, Hierarchy=Tertiary, State=Default',
      render: () => <ButtonUtility size="xs" hierarchy="tertiary" icon={placeholder} tooltip="Tooltip" />,
    },
    {
      figma: 'Button utility · Size=xs, Hierarchy=Tertiary, State=Hover',
      render: () => <ButtonUtility size="xs" hierarchy="tertiary" icon={placeholder} tooltip="Tooltip" />,
    },
    {
      figma: 'Button utility · Size=xs, Hierarchy=Secondary',
      render: () => <ButtonUtility size="xs" hierarchy="secondary" icon={placeholder} tooltip="Tooltip" />,
    },
    {
      figma: 'Button close X · Size=sm, Dark background=False, State=Default',
      render: () => <CloseButton size="sm" />,
    },
    {
      figma: 'Button close X · Size=md, Dark background=False, State=Default',
      render: () => <CloseButton size="md" />,
    },
  ]),
} satisfies GalleryEntry;
