import { createContext, use, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { cx, Text, VisuallyHidden } from '../primitives';

export type FeedDivider = 'connector' | 'none';

const FeedContext = createContext<{ connector: boolean }>({ connector: false });

export interface FeedProps extends HTMLAttributes<HTMLUListElement> {
  /** `Divider`: `connector` joins the avatars with a line; `none` spaces the items apart. */
  divider?: FeedDivider;
  ref?: Ref<HTMLUListElement>;
}

/** `Activity feed` (`Type=Notifications`): a list of `FeedItem`s. */
export function Feed({ divider = 'connector', className, ref, ...rest }: FeedProps) {
  return (
    <FeedContext value={{ connector: divider === 'connector' }}>
      <ul ref={ref} className={cx('flex flex-col', divider === 'none' && 'gap-4xl', className)} {...rest} />
    </FeedContext>
  );
}

export interface FeedItemProps extends HTMLAttributes<HTMLLIElement> {
  /** `Avatar` slot (`size="lg"`). */
  avatar: ReactNode;
  /** `Text`: who acted. */
  name: ReactNode;
  /** `Subtext`: when. */
  time: ReactNode;
  /** Machine-readable `time`, rendered as `<time dateTime>`. */
  dateTime?: string;
  /** `Supporting text`: what happened; mark names with `<FeedItem.Highlight>`. */
  children?: ReactNode;
  /** `Supporting item` slot: `<FeedItem.File>` or `<FeedItem.Message>`. */
  supportingItem?: ReactNode;
  /** `New dot`. */
  unread?: boolean;
  /** Accessible text of the unread dot. */
  unreadLabel?: string;
  /** `Connector`: the line to the next item. Defaults to the `Feed`'s divider; the last item never has one. */
  connector?: boolean;
  ref?: Ref<HTMLLIElement>;
}

/** `_Feed item base` (`Size=md`). */
function FeedItemRoot({
  avatar,
  name,
  time,
  dateTime,
  children,
  supportingItem,
  unread = false,
  unreadLabel = 'Unread',
  connector,
  className,
  ref,
  ...rest
}: FeedItemProps) {
  const feed = use(FeedContext);
  const hasConnector = connector ?? feed.connector;
  return (
    <li ref={ref} className={cx('group/feed-item relative flex gap-lg', className)} {...rest}>
      {hasConnector ? (
        <div className="flex shrink-0 flex-col items-center gap-sm pb-sm group-last/feed-item:pb-0">
          {avatar}
          <span aria-hidden className="w-0.5 flex-1 bg-border-primary group-last/feed-item:hidden" />
        </div>
      ) : (
        <div className="shrink-0">{avatar}</div>
      )}
      <div className={cx('flex min-w-0 flex-1 flex-col gap-lg', hasConnector && 'pb-4xl group-last/feed-item:pb-0')}>
        <div className="flex flex-col">
          <div className="flex items-center gap-md pr-2xl">
            <Text weight="medium" color="secondary" className="truncate">
              {name}
            </Text>
            <Text as="span" size="xs" color="tertiary" className="shrink-0">
              {dateTime ? <time dateTime={dateTime}>{time}</time> : time}
            </Text>
          </div>
          {children != null && (
            <Text as="p" color="tertiary">
              {children}
            </Text>
          )}
        </div>
        {supportingItem}
      </div>
      {unread && (
        <span className="absolute top-0 right-0 flex size-2.5 items-center justify-center">
          <span aria-hidden className="size-md rounded-full bg-fg-success-secondary" />
          <VisuallyHidden>{unreadLabel}</VisuallyHidden>
        </span>
      )}
    </li>
  );
}

export interface FeedItemHighlightProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'color'> {
  ref?: Ref<HTMLSpanElement>;
}

/** A name inside the supporting text (Text sm/Medium, text-brand-secondary). */
function FeedItemHighlight({ className, ref, ...rest }: FeedItemHighlightProps) {
  return <Text ref={ref} weight="medium" color="brand-secondary" className={className} {...rest} />;
}

export interface FileTypeIconProps extends HTMLAttributes<HTMLSpanElement> {
  /** `File type`: `pdf` (Document / PDF) or `empty` (Simple / Empty, a bare page). */
  type?: 'pdf' | 'empty';
  ref?: Ref<HTMLSpanElement>;
}

const fileTypeLabels = { pdf: 'PDF', empty: null } as const;

/** `File type icon` (`Type=Default`): a page with the file type's label. */
export function FileTypeIcon({ type = 'pdf', className, ref, ...rest }: FileTypeIconProps) {
  return (
    <span ref={ref} aria-hidden className={cx('relative inline-flex size-5xl shrink-0 justify-center', className)} {...rest}>
      <svg viewBox="0 0 32 40" fill="none" className="h-5xl w-4xl">
        <path
          d="M4 .75h16c.2 0 .39.08.53.22l10.5 10.5c.14.14.22.33.22.53V36A3.25 3.25 0 0 1 28 39.25H4A3.25 3.25 0 0 1 .75 36V4A3.25 3.25 0 0 1 4 .75Z"
          className={cx('stroke-border-primary', type === 'empty' ? 'fill-none' : 'fill-bg-primary')}
          strokeWidth={1.5}
        />
        <path d="M20 .5V8a4 4 0 0 0 4 4h7.5" className="stroke-border-primary" strokeWidth={1.5} />
      </svg>
      {fileTypeLabels[type] && (
        <span className="absolute bottom-1.5 left-0.5 rounded-xxs bg-error-600 px-0.75 py-xxs text-[0.625rem] leading-none font-bold text-fg-white">
          {fileTypeLabels[type]}
        </span>
      )}
    </span>
  );
}

export interface FeedItemFileProps extends HTMLAttributes<HTMLDivElement> {
  /** File name. */
  name: ReactNode;
  /** File size, e.g. `720 KB`. */
  size: ReactNode;
  /** `File type icon` slot; defaults to the PDF icon. */
  icon?: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

/** `Supporting item=File`. */
function FeedItemFile({ name, size, icon = <FileTypeIcon />, className, ref, ...rest }: FeedItemFileProps) {
  return (
    <div ref={ref} className={cx('flex gap-lg', className)} {...rest}>
      {icon}
      <div className="flex min-w-0 flex-1 flex-col">
        <Text weight="medium" color="secondary" className="truncate">
          {name}
        </Text>
        <Text color="tertiary">{size}</Text>
      </div>
    </div>
  );
}

export interface FeedItemMessageProps extends HTMLAttributes<HTMLQuoteElement> {
  ref?: Ref<HTMLQuoteElement>;
}

/** `Supporting item=Text`: the message bubble. */
function FeedItemMessage({ className, children, ref, ...rest }: FeedItemMessageProps) {
  return (
    <blockquote
      ref={ref}
      className={cx('rounded-tr-md rounded-b-md border border-secondary bg-primary_alt px-lg py-2.5', className)}
      {...rest}
    >
      <Text as="p" color="secondary">
        {children}
      </Text>
    </blockquote>
  );
}

export const FeedItem = Object.assign(FeedItemRoot, {
  Highlight: FeedItemHighlight,
  File: FeedItemFile,
  Message: FeedItemMessage,
});
