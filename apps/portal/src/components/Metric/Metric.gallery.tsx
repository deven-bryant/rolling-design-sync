import { inBothThemes, Icon, type GalleryEntry } from '../primitives';
import { Metric, MetricChange } from './Metric';

export default {
  component: 'Metric',
  examples: inBothThemes([
    {
      figma: 'Metric item: Actions=False, Type=Simple, Breakpoint=Desktop',
      render: () => (
        <Metric
          className="w-97"
          heading="Views 24 hours"
          value="2,000"
          change={<MetricChange>100%</MetricChange>}
          menu={
            <button type="button" aria-label="More" className="text-fg-quaternary">
              <Icon name="dots-vertical" size="md" />
            </button>
          }
        />
      ),
    },
    { figma: '_Change: Type=03, Trend=Positive', render: () => <MetricChange>100%</MetricChange> },
  ]),
} satisfies GalleryEntry;
