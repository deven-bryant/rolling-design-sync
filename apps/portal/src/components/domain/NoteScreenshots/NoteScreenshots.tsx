import { useId, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { Button as AriaButton, DropZone, FileTrigger, type DropItem } from 'react-aria-components';
import { CloseButton } from '../../Button';
import { cx, Text } from '../../primitives';

/** The image types a note screenshot may be. */
export const SCREENSHOT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export interface NoteScreenshot {
  id: string;
  /** A preview URL (an object URL or an attachment's `thumbUrl`). */
  src: string;
  name: string;
  /** Under the thumbnail, e.g. `412 KB`. */
  detail?: ReactNode;
}

/** The files among dropped or pasted items. */
export async function filesFromDrop(items: readonly DropItem[]): Promise<File[]> {
  const files = items.filter(item => item.kind === 'file');
  return Promise.all(files.map(item => item.getFile()));
}

/** The files on a paste event's clipboard. */
export function filesFromClipboard(data: DataTransfer | null): File[] {
  return Array.from(data?.files ?? []);
}

export interface NoteScreenshotsProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onPaste'> {
  label?: ReactNode;
  screenshots: readonly NoteScreenshot[];
  /** Files dropped, pasted or browsed; the caller validates them. */
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  /** At most this many; the zone hides once full. */
  max?: number;
  /** The zone's second line. */
  hint?: ReactNode;
  /** A validation message under the zone. */
  error?: ReactNode;
  isDisabled?: boolean;
  ref?: Ref<HTMLDivElement>;
}

/**
 * Figma `Node Details - Notes Screenshots`: `Screenshots (optional)`, a dashed drop zone (drop, paste or click to
 * browse) and the attached screenshots as thumbnails, each with a remove button.
 */
export function NoteScreenshots({
  label = 'Screenshots (optional)',
  screenshots,
  onAdd,
  onRemove,
  max = 3,
  hint = 'PNG, JPG or WebP · up to 5 MB each · at most 3',
  error,
  isDisabled = false,
  className,
  ref,
  ...rest
}: NoteScreenshotsProps) {
  const labelId = useId();
  const hintId = useId();
  const full = screenshots.length >= max;
  return (
    <div ref={ref} role="group" aria-labelledby={labelId} {...rest} className={cx('flex flex-col gap-xl', className)}>
      <Text as="span" id={labelId} weight="medium" color="secondary">
        {label}
      </Text>
      {!full && (
        <DropZone
          aria-labelledby={labelId}
          isDisabled={isDisabled}
          getDropOperation={types => (SCREENSHOT_TYPES.some(t => types.has(t)) ? 'copy' : 'cancel')}
          onDrop={event => void filesFromDrop(event.items).then(files => files.length && onAdd(files))}
          className={cx(
            'flex flex-col items-center gap-xs rounded-xl border border-dashed border-secondary bg-secondary p-xl text-center outline-focus-ring',
            'data-drop-target:border-brand data-drop-target:bg-brand-primary data-focus-visible:outline-2',
          )}
        >
          <FileTrigger acceptedFileTypes={[...SCREENSHOT_TYPES]} allowsMultiple onSelect={list => list && onAdd(Array.from(list))}>
            <AriaButton
              isDisabled={isDisabled}
              aria-describedby={hintId}
              className="cursor-pointer rounded-sm text-sm font-semibold text-primary outline-focus-ring data-focus-visible:outline-2 data-disabled:cursor-not-allowed"
            >
              Drop, paste or click to add screenshots
            </AriaButton>
          </FileTrigger>
          <Text as="span" id={hintId} color="tertiary">
            {hint}
          </Text>
        </DropZone>
      )}
      {error != null && (
        <Text as="p" role="alert" color="error-primary">
          {error}
        </Text>
      )}
      {screenshots.length > 0 && (
        <ul aria-label="Attached screenshots" className="flex flex-wrap items-start justify-center gap-lg">
          {screenshots.map(shot => (
            <li key={shot.id} className="relative flex w-32 flex-col gap-sm">
              <div className="h-20 w-32 overflow-hidden rounded-md border border-secondary bg-secondary">
                <img src={shot.src} alt={shot.name} className="size-full object-cover object-top" />
              </div>
              <span className="truncate text-xs text-tertiary">
                {shot.name}
                {shot.detail != null && <> · {shot.detail}</>}
              </span>
              <CloseButton
                aria-label={`Remove ${shot.name}`}
                onPress={() => onRemove(shot.id)}
                className="absolute -top-lg -right-lg rounded-2xl bg-primary shadow-xs"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
