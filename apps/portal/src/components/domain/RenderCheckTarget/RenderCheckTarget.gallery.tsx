import { inBothThemes, type GalleryEntry } from '../../primitives';
import { containingTargets, renderCheckExcludedHint, renderCheckResults, renderCheckTargetDetails } from '../gallerySamples';
import { RenderCheckHistory, RenderChecksContaining, RenderCheckTargetDetails } from '.';

export default {
  component: 'RenderCheckTarget',
  figma: 'Render Check Target Details',
  examples: inBothThemes([
    {
      figma: 'Excluded=False',
      render: () => <RenderCheckTargetDetails excluded={false} onExcludedChange={() => {}} details={renderCheckTargetDetails} />,
    },
    {
      figma: 'Excluded=True',
      render: () => <RenderCheckTargetDetails excluded onExcludedChange={() => {}} hint={renderCheckExcludedHint} learnMoreHref="/docs" />,
    },
    {
      figma: 'Render Check History',
      set: 'Render Check History',
      variant: '',
      render: () => <RenderCheckHistory results={renderCheckResults} retention={5} onSelect={() => {}} />,
    },
    {
      // Figma spells the set "Contining".
      figma: 'Render Checks Contining Mismatch Targets',
      set: 'Render Checks Contining Mismatch Targets',
      variant: '',
      render: () => <RenderChecksContaining onOpen={() => {}} targets={containingTargets} />,
    },
  ]),
} satisfies GalleryEntry;
