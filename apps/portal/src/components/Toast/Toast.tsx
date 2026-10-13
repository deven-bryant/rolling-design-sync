import type { ReactNode, Ref } from 'react';
import {
  Text as AriaText,
  UNSTABLE_Toast as AriaToast,
  UNSTABLE_ToastContent as AriaToastContent,
  UNSTABLE_ToastQueue as ToastQueue,
  UNSTABLE_ToastRegion as AriaToastRegion,
} from 'react-aria-components';
import { CloseButton } from '../Button';
import { cx, Icon, variants, type VariantProps } from '../primitives';

export type ToastTone = 'success' | 'error';

/** What a queued toast shows. */
export interface ToastData {
  title: string;
  tone?: ToastTone;
}

/** How long a toast stays up (React Aria pauses the timer while it is hovered or focused). */
export const TOAST_TIMEOUT_MS = 5000;

export const toastStyles = variants({
  base: 'pointer-events-auto flex w-90 max-w-full items-center gap-lg rounded-xl bg-primary py-md pr-md pl-xl shadow-lg ring-1 ring-secondary ring-inset outline-focus-ring data-focus-visible:outline-2 data-focus-visible:outline-offset-2',
  variants: {
    tone: { success: '*:data-[slot=tone]:text-fg-success-primary', error: '*:data-[slot=tone]:text-fg-error-primary' },
  },
  defaults: { tone: 'success' },
});

export interface ToastCardProps extends VariantProps<typeof toastStyles> {
  /** The message. */
  children: ReactNode;
  /** The dismiss button (`<CloseButton slot="close" />` inside a region). */
  close?: ReactNode;
  className?: string;
  ref?: Ref<HTMLDivElement>;
}

/** A toast's look without the queue: a tone icon, the message and a close button. */
export function ToastCard({ tone, children, close, className, ref }: ToastCardProps) {
  return (
    <div ref={ref} className={toastStyles({ tone, className })}>
      <ToastBody tone={tone ?? 'success'} close={close}>
        {children}
      </ToastBody>
    </div>
  );
}

function ToastBody({ tone, children, close }: { tone: ToastTone; children: ReactNode; close?: ReactNode }) {
  return (
    <>
      <span data-slot="tone" className="flex shrink-0">
        <Icon name={tone === 'error' ? 'alert-circle' : 'check-circle'} size="md" />
      </span>
      {children}
      {close}
    </>
  );
}

/** The portal's toast queue; `ToastRegion` shows it. */
export const toastQueue = new ToastQueue<ToastData>({ maxVisibleToasts: 3 });

/** Queues a toast; returns its key (`toastQueue.close(key)` dismisses it). */
export function showToast(title: string, { tone = 'success', timeout = TOAST_TIMEOUT_MS }: { tone?: ToastTone; timeout?: number } = {}): string {
  return toastQueue.add({ title, tone }, { timeout });
}

export interface ToastRegionProps {
  /** Defaults to the portal's `toastQueue`. */
  queue?: ToastQueue<ToastData>;
  'aria-label'?: string;
  className?: string;
}

/**
 * The toasts in the bottom-right corner, newest at the bottom: a React Aria toast region (a landmark,
 * announced politely, kept out of modal focus traps). Mount it once.
 */
export function ToastRegion({ queue = toastQueue, 'aria-label': ariaLabel = 'Notifications', className }: ToastRegionProps) {
  return (
    <AriaToastRegion
      queue={queue}
      aria-label={ariaLabel}
      className={cx('pointer-events-none fixed right-4xl bottom-4xl z-60 flex flex-col items-end gap-lg outline-none', className)}
    >
      {({ toast }) => (
        <AriaToast toast={toast} className={toastStyles({ tone: toast.content.tone })}>
          <ToastBody tone={toast.content.tone ?? 'success'} close={<CloseButton slot="close" size="sm" aria-label="Dismiss" />}>
            <AriaToastContent className="flex min-w-0 flex-1">
              <AriaText slot="title" className="text-sm font-semibold text-primary">
                {toast.content.title}
              </AriaText>
            </AriaToastContent>
          </ToastBody>
        </AriaToast>
      )}
    </AriaToastRegion>
  );
}
