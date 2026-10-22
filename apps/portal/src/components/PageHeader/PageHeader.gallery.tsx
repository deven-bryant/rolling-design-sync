import { Breadcrumbs } from '../Breadcrumbs';
import { Button, ButtonUtility } from '../Button';
import { Input } from '../Input';
import { Icon } from '../primitives';
import type { GalleryEntry, GalleryExample } from '../primitives';
import { PageHeader } from './PageHeader';


const themes = [
  ['Light', undefined],
  ['Dark', 'dark'],
] as const;

/** Each example once per theme: `Color Mode` is the `data-theme` it renders under, never a prop. */
const bothThemes = (examples: (Omit<GalleryExample, 'render'> & { render: (mode: string) => ReturnType<GalleryExample['render']> })[]) =>
  themes.flatMap(([mode, theme]) =>
    examples.map(({ figma, render, ...rest }): GalleryExample => ({
      ...rest,
      figma: `${figma} · Color Mode=${mode}`,
      render: () => (
        <div data-theme={theme} className="bg-primary">
          {render(mode)}
        </div>
      ),
    })),
  );

export default {
  component: 'PageHeader',
  figma: 'Page header',
  examples: bothThemes([
    {
      figma: 'Page header',
      variant: '',
      render: mode => (
        <PageHeader>
          <PageHeader.Breadcrumbs>
            <Breadcrumbs label={`Team breadcrumbs (${mode})`}>
              <Breadcrumbs.Item home href="#home">
                Home
              </Breadcrumbs.Item>
              <Breadcrumbs.Item href="#settings">Settings</Breadcrumbs.Item>
              <Breadcrumbs.Item>Team</Breadcrumbs.Item>
            </Breadcrumbs>
          </PageHeader.Breadcrumbs>
          <PageHeader.Title>Team members</PageHeader.Title>
          <PageHeader.Description>Manage your team members and their account permissions here.</PageHeader.Description>
          <PageHeader.Actions>
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
            <Input size="sm" aria-label="Search" placeholder="Search" />
          </PageHeader.Actions>
        </PageHeader>
      ),
    },
    {
      figma: 'Portal Page Header',
      set: 'Portal Page Header',
      variant: '',
      render: () => (
        <PageHeader divider className="bg-primary">
          <PageHeader.Title>File Name</PageHeader.Title>
          <PageHeader.Description>Section 1:95540 · synced 12 min ago by plugin/0.10.0 · 281 nodes, 37 components</PageHeader.Description>
          <PageHeader.Actions>
            <ButtonUtility size="md" icon={<Icon name="settings-01" />} tooltip="File settings" />
            <Button hierarchy="secondary" size="md">
              Copy agent prompt
            </Button>
            <Button hierarchy="primary" size="md">
              Open in Figma
            </Button>
          </PageHeader.Actions>
        </PageHeader>
      ),
    },
    {
      figma: 'Style=Simple, Breakpoint=Desktop',
      render: mode => (
        <PageHeader divider>
          <PageHeader.Breadcrumbs>
            <Breadcrumbs label={`Page header breadcrumbs (${mode})`}>
              <Breadcrumbs.Item home href="#home">
                Home
              </Breadcrumbs.Item>
              <Breadcrumbs.Item href="#settings">Settings</Breadcrumbs.Item>
              <Breadcrumbs.Item>Team</Breadcrumbs.Item>
            </Breadcrumbs>
          </PageHeader.Breadcrumbs>
          <PageHeader.Title>Team members</PageHeader.Title>
          <PageHeader.Description>Manage your team members and their account permissions here.</PageHeader.Description>
          <PageHeader.Actions>
            <span className="rounded-md border border-primary bg-primary px-lg py-md text-sm font-semibold text-secondary">
              Action slot
            </span>
          </PageHeader.Actions>
        </PageHeader>
      ),
    },
    {
      figma: 'Title only',
      render: () => (
        <PageHeader>
          <PageHeader.Title>Files</PageHeader.Title>
        </PageHeader>
      ),
    },
  ]),
} satisfies GalleryEntry;
