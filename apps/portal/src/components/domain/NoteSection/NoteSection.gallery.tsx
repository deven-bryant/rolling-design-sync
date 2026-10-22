import { Badge } from '../../Badge';
import { Button } from '../../Button';
import { ImageThumbnail } from '../../Lightbox';
import { sampleImage } from '../../Lightbox/sample';
import { inBothThemes, type GalleryEntry } from '../../primitives';
import { addChangeForm, targetNote } from '../gallerySamples';
import { HeatmapCrop } from '../RenderCheckTarget';
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

/** The *Add note* row `NodeDetails` places above the change list (`Default`), and the note form under it (`Edit`). */
function AddNote({ editing }: { editing: boolean }) {
  return (
    <div className="flex flex-col gap-3xl">
      <div className="flex h-9 items-center justify-between gap-lg px-md">
        <Button hierarchy="secondary" size="md" aria-expanded={editing} isDisabled={editing}>
          Add note
        </Button>
        {editing && (
          <Button hierarchy="secondary" size="sm">
            Cancel
          </Button>
        )}
      </div>
      {editing && <div className="flex flex-col gap-3xl px-md">{addChangeForm}</div>}
    </div>
  );
}

export default {
  component: 'NoteSection',
  figma: 'Node Details - Note Section',
  examples: inBothThemes([
    { figma: 'Property 1=Default', render: () => <AddNote editing={false} /> },
    { figma: 'Property 1=Edit', render: () => <AddNote editing /> },
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
    {
      figma: 'Property 1=Preview Target Note Reference',
      render: () => (
        <NoteSection
          title="Open notes (1)"
          badge={
            <Badge size="md" color="error">
              Render mismatch
            </Badge>
          }
          actions={
            <Button hierarchy="link-color" size="sm">
              Go to target
            </Button>
          }
          screenshots={<HeatmapCrop src={sampleImage('Heatmap')} width={320} height={200} region={{ x: 40, y: 0, width: 260, height: 24 }} alt="Region 1" />}
        >
          {targetNote}
        </NoteSection>
      ),
    },
  ]),
} satisfies GalleryEntry;
