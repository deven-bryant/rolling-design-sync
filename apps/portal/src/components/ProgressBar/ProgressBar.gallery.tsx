import { inBothThemes, type GalleryEntry } from '../primitives';
import { ProgressBar } from '.';

export default {
  component: 'ProgressBar',
  examples: inBothThemes([
    { figma: 'Progress=60%, Label=Right', render: () => <ProgressBar aria-label="Upload" value={60} label="right" className="w-80" /> },
    { figma: 'Progress=80%, Label=False', render: () => <ProgressBar aria-label="Upload" value={80} className="w-80" /> },
    { figma: 'Progress=40%, Label=Bottom', render: () => <ProgressBar aria-label="Upload" value={40} label="bottom" className="w-80" /> },
  ]),
} satisfies GalleryEntry;
