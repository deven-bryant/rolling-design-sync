import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { cx, Text } from '../../primitives';

export interface NoteSectionProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** `Title`, e.g. `Open notes (1)`. */
  title: ReactNode;
  /** The title's heading level. */
  headingLevel?: 'h3' | 'h4';
  /** `Author`: a badge beside the title (`Requested`, `Render mismatch`). */
  badge?: ReactNode;
  /** `Frame 18`: the note's buttons (Edit · Delete · Dismiss), right-aligned. */
  actions?: ReactNode;
  /** Under the body: who wrote it and when. */
  meta?: ReactNode;
  /** `Note / reviewer / Subtitle`: the note's text (or its edit form). */
  children?: ReactNode;
  /** `Screenshots`: the note's thumbnails, right-aligned. */
  screenshots?: ReactNode;
  /** Under the note: a confirmation or an error. */
  footer?: ReactNode;
  ref?: Ref<HTMLElement>;
}

/**
 * Figma `Node Details - Note Section`, `Property 1=Preview`: an open note — a title row (title, badge, and the
 * note's secondary buttons on the right) over the note's text and its screenshots, right-aligned.
 */
export function NoteSection({
  title,
  headingLevel = 'h3',
  badge,
  actions,
  meta,
  children,
  screenshots,
  footer,
  className,
  ref,
  ...rest
}: NoteSectionProps) {
  return (
    <article ref={ref} {...rest} className={cx('flex flex-col gap-md', className)}>
      <div className="flex flex-wrap items-center justify-between gap-md">
        <div className="flex min-w-0 items-center gap-md">
          <Text as={headingLevel} size="md" weight="semibold" color="primary">
            {title}
          </Text>
          {badge}
        </div>
        {actions != null && <div className="ml-auto flex items-center justify-end gap-lg p-2.5">{actions}</div>}
      </div>
      <div className="flex flex-col gap-md rounded-md p-lg">
        {children != null && <div className="text-sm text-tertiary">{children}</div>}
        {meta != null && (
          <Text as="p" size="xs" color="tertiary">
            {meta}
          </Text>
        )}
        {screenshots != null && <div className="flex flex-wrap items-center justify-end gap-md">{screenshots}</div>}
      </div>
      {footer}
    </article>
  );
}
