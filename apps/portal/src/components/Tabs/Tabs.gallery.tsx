import type { GalleryEntry } from '../primitives';
import { Tabs } from './Tabs';

const labels = ['My details', 'Profile', 'Password', 'Team', 'Plan'];

export default {
  component: 'Tabs',
  examples: [
    {
      figma: 'Type=Underline, Size=md, Full width=False, Breakpoint=Desktop',
      render: () => (
        <Tabs type="underline" size="md">
          <Tabs.List aria-label="Underline tabs">
            {labels.map(label => (
              <Tabs.Tab key={label} id={label}>
                {label}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          {labels.map(label => (
            <Tabs.Panel key={label} id={label} className="pt-lg">
              {label}
            </Tabs.Panel>
          ))}
        </Tabs>
      ),
    },
    {
      figma: 'Type=Button gray, Size=md, Full width=False, Breakpoint=Desktop',
      render: () => (
        <Tabs type="button-gray" size="md">
          <Tabs.List aria-label="Button gray md tabs">
            {labels.map(label => (
              <Tabs.Tab key={label} id={label}>
                {label}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          {labels.map(label => (
            <Tabs.Panel key={label} id={label} className="pt-lg">
              {label}
            </Tabs.Panel>
          ))}
        </Tabs>
      ),
    },
    {
      figma: 'Type=Button gray, Size=sm, Full width=False, Breakpoint=Desktop',
      render: () => (
        <Tabs type="button-gray" size="sm">
          <Tabs.List aria-label="Button gray tabs">
            {labels.map(label => (
              <Tabs.Tab key={label} id={label}>
                {label}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          {labels.map(label => (
            <Tabs.Panel key={label} id={label} className="pt-lg">
              {label}
            </Tabs.Panel>
          ))}
        </Tabs>
      ),
    },
  ],
} satisfies GalleryEntry;
