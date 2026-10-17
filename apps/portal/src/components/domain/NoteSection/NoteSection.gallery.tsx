import { Badge } from '../../Badge';
import { Button } from '../../Button';
import { ImageThumbnail } from '../../Lightbox';
import { sampleImage } from '../../Lightbox/sample';
import { inBothThemes, type GalleryEntry } from '../../primitives';
import { NoteSection } from '.';

const actions = (
  <>
    {['Edit', 'Delete', 'Dismiss'].map(label => (
      <Button key={label} hierarchy="secondary" size="md">
        {label}
      </Button>
    ))}
  </>
);

export default {
  component: 'NoteSection',
  examples: inBothThemes([
    {
      figma: 'Property 1=Preview',
      render: () => (
        <NoteSection
          title="Open notes (1)"
          badge={
            <Badge size="md" color="orange">
              Requested
            </Badge>
          }
          actions={actions}
          screenshots={
            <>
              <ImageThumbnail src={sampleImage('Work items')} alt="Screenshot 1" className="h-11.25 w-18 rounded-sm" />
              <ImageThumbnail src={sampleImage('Dark', '#41474b')} alt="Screenshot 2" className="h-11.25 w-18 rounded-sm" />
            </>
          }
        >
          The gap between the filters and the table is wider on the built page than in the design — see the screenshots.
        </NoteSection>
      ),
    },
  ]),
} satisfies GalleryEntry;
