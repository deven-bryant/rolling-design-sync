import { inBothThemes, type GalleryEntry } from '../primitives';
import { LoadingIndicator } from '.';

export default {
  component: 'LoadingIndicator',
  figma: 'Loading indicator',
  examples: inBothThemes([
    { figma: 'Type=Line simple, Size=sm', render: () => <LoadingIndicator size="sm" label="Loading nodes…" /> },
    { figma: 'Type=Line simple, Size=md', render: () => <LoadingIndicator size="md" label="Loading history…" /> },
  ]),
} satisfies GalleryEntry;
