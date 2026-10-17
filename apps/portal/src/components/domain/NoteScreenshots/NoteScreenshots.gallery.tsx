import { sampleImage } from '../../Lightbox/sample';
import { inBothThemes, type GalleryEntry } from '../../primitives';
import { NoteScreenshots } from '.';

const shots = [
  { id: 'a', src: sampleImage('Work items'), name: 'built-work-items.png', detail: '412 KB' },
  { id: 'b', src: sampleImage('Dark', '#41474b'), name: 'built-dark.png', detail: '388 KB' },
];

const noop = () => undefined;

export default {
  component: 'NoteScreenshots',
  examples: inBothThemes([
    { figma: 'Node Details - Notes Screenshots', render: () => <NoteScreenshots screenshots={shots} onAdd={noop} onRemove={noop} /> },
    { figma: 'Empty', render: () => <NoteScreenshots screenshots={[]} onAdd={noop} onRemove={noop} /> },
    {
      figma: 'Error',
      render: () => <NoteScreenshots screenshots={[]} onAdd={noop} onRemove={noop} error="huge.png is over 5 MB." />,
    },
  ]),
} satisfies GalleryEntry;
