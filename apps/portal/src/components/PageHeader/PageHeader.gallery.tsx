import { Breadcrumbs } from '../Breadcrumbs';
import type { GalleryEntry, GalleryExample } from '../primitives';
import { PageHeader } from './PageHeader';


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
  component: 'PageHeader',
  examples: bothThemes([
    {
      figma: 'Style=Simple, Breakpoint=Desktop · Breadcrumbs, Supporting text, Actions, Divider',
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
      figma: 'Style=Simple, Breakpoint=Desktop · title only',
      render: () => (
        <PageHeader>
          <PageHeader.Title>Files</PageHeader.Title>
        </PageHeader>
      ),
    },
  ]),
} satisfies GalleryEntry;
