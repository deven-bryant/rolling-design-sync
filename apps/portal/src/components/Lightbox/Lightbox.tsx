import type { ReactNode, Ref } from 'react';
import { Button as AriaButton, Dialog, DialogTrigger, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { CloseButton } from '../Button';
import { cx } from '../primitives';

const overlayStyles = [
  'fixed inset-0 z-60 flex items-center justify-center bg-overlay/70 p-4xl',
  'motion-safe:transition-opacity motion-safe:duration-200 data-entering:opacity-0 data-exiting:opacity-0',
].join(' ');

export interface ImageThumbnailProps {
  /** The thumbnail image (e.g. an attachment's `thumbUrl`). */
  src: string;
  /** The full image the lightbox shows (default: `src`). */
  fullSrc?: string;
  /** Names the image (and the lightbox). */
  alt: string;
  /** Under the thumbnail, e.g. `name · 412 KB`. */
  caption?: ReactNode;
  /** Sizes the thumbnail frame (default `h-20 w-32`, Figma `Thumbnail`). */
  className?: string;
  /** Over the image, e.g. differing-region outlines. */
  overlay?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * Figma `Thumbnail`: an image in a rounded `border-secondary` frame; pressing it opens the full image in a lightbox
 * (a modal dialog, closed with Escape, the close button or a click outside).
 */
export function ImageThumbnail({ src, fullSrc, alt, caption, className, overlay, ref }: ImageThumbnailProps) {
  return (
    <DialogTrigger>
      <figure className="flex min-w-0 flex-col items-center gap-sm">
        <AriaButton
          ref={ref}
          aria-label={`View ${alt}`}
          className={cx(
            'relative block cursor-zoom-in overflow-hidden rounded-md border border-secondary bg-secondary outline-focus-ring',
            'data-focus-visible:outline-2 data-focus-visible:outline-offset-2',
            className ?? 'h-20 w-32',
          )}
        >
          <img src={src} alt="" loading="lazy" className="size-full object-cover object-top" />
          {overlay}
        </AriaButton>
        {caption != null && <figcaption className="max-w-full truncate text-xs text-tertiary">{caption}</figcaption>}
      </figure>
      <Lightbox src={fullSrc ?? src} alt={alt} />
    </DialogTrigger>
  );
}

export interface LightboxProps {
  src: string;
  alt: string;
}

/** The full-size image in a modal over a scrim; use inside a `DialogTrigger` (as `ImageThumbnail` does). */
export function Lightbox({ src, alt }: LightboxProps) {
  return (
    <ModalOverlay isDismissable className={overlayStyles}>
      <Modal className="max-h-full max-w-full outline-none">
        <Dialog aria-label={alt} className="relative flex max-h-[calc(100vh-4rem)] flex-col gap-md rounded-xl bg-primary p-xl shadow-xl outline-none">
          <div className="flex items-center justify-between gap-lg">
            <Heading slot="title" className="truncate text-md font-semibold text-primary">
              {alt}
            </Heading>
            <CloseButton slot="close" aria-label="Close image" />
          </div>
          <img src={src} alt={alt} className="min-h-0 max-w-full flex-1 object-contain" />
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
