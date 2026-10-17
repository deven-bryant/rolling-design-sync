import { inBothThemes, type GalleryEntry } from '../primitives';
import { ImageThumbnail } from '.';
import { sampleImage } from './sample';

export default {
  component: 'ImageThumbnail',
  examples: inBothThemes([
    {
      figma: 'Thumbnail',
      render: theme => <ImageThumbnail src={sampleImage()} alt={`built-work-items.png (${theme})`} caption="built-work-items.png · 412 KB" />,
    },
  ]),
} satisfies GalleryEntry;
