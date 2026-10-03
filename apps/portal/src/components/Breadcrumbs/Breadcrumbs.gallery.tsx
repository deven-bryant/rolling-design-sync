import type { GalleryEntry } from '../primitives';
import { Breadcrumbs } from './Breadcrumbs';

export default {
  component: 'Breadcrumbs',
  examples: [
    {
      figma: 'Divider=Chevron, Type=Button, Breakpoint=Desktop',
      render: () => (
        <Breadcrumbs>
          <Breadcrumbs.Item home href="#home">
            Home
          </Breadcrumbs.Item>
          <Breadcrumbs.Item href="#settings">Settings</Breadcrumbs.Item>
          <Breadcrumbs.Item href="#team">Team</Breadcrumbs.Item>
          <Breadcrumbs.Item>Members</Breadcrumbs.Item>
        </Breadcrumbs>
      ),
    },
    {
      figma: '_Breadcrumb button base · Current=False / Current=True / Icon=True',
      render: () => (
        <Breadcrumbs label="Breadcrumb buttons">
          <Breadcrumbs.Item home href="#home">
            Home
          </Breadcrumbs.Item>
          <Breadcrumbs.Item href="#projects">Projects</Breadcrumbs.Item>
          <Breadcrumbs.Item>Projects</Breadcrumbs.Item>
        </Breadcrumbs>
      ),
    },
  ],
} satisfies GalleryEntry;
