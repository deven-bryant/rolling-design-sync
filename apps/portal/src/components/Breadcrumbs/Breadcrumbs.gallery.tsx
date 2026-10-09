import type { GalleryEntry, GalleryExample } from '../primitives';
import { Breadcrumbs } from './Breadcrumbs';


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
  component: 'Breadcrumbs',
  examples: bothThemes([
    {
      figma: 'Divider=Chevron, Type=Button, Breakpoint=Desktop',
      render: mode => (
        <Breadcrumbs label={`Breadcrumbs (${mode})`}>
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
      render: mode => (
        <Breadcrumbs label={`Breadcrumb buttons (${mode})`}>
          <Breadcrumbs.Item home href="#home">
            Home
          </Breadcrumbs.Item>
          <Breadcrumbs.Item href="#projects">Projects</Breadcrumbs.Item>
          <Breadcrumbs.Item>Projects</Breadcrumbs.Item>
        </Breadcrumbs>
      ),
    },
  ]),
} satisfies GalleryEntry;
