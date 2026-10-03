import { Breadcrumbs } from '../Breadcrumbs';
import type { GalleryEntry } from '../primitives';
import { PageHeader } from './PageHeader';

export default {
  component: 'PageHeader',
  examples: [
    {
      figma: 'Style=Simple, Breakpoint=Desktop · Breadcrumbs, Supporting text, Actions, Divider',
      render: () => (
        <PageHeader divider>
          <PageHeader.Breadcrumbs>
            <Breadcrumbs label="Page header breadcrumbs">
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
  ],
} satisfies GalleryEntry;
