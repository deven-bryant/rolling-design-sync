import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Avatar } from '../../components/Avatar';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Feed, FeedItem } from '../../components/FeedItem';
import { Text } from '../../components/primitives';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import type { StreamState } from '../../api/useEventStream';
import { actorInitials, describeEvent, eventNodeIds, type ActivityEvent } from './events';
import { useNow } from '../../api/hooks/useNow';
import { minuteOf, relativeTime } from './time';
import { useActivityEvents } from './useActivityEvents';
import { useNoteList } from '../nodes';

export interface EventGroup {
  key: string;
  actor: string;
  /** The minute the group's events fall in. */
  minute: number;
  /** Newest first. */
  events: ActivityEvent[];
}

/** Consecutive events by the same actor within the same minute, newest first. */
export function groupByMinute(events: ActivityEvent[]): EventGroup[] {
  const groups: EventGroup[] = [];
  for (const event of events) {
    const actor = event.actor ?? 'system';
    const minute = event.createdAt ? minuteOf(event.createdAt) : 0;
    const last = groups.at(-1);
    if (last && last.actor === actor && last.minute === minute) last.events.push(event);
    else groups.push({ key: `${event.id ?? groups.length}`, actor, minute, events: [event] });
  }
  return groups;
}

const NODE_LINKS = 3;

const streamBadge: Record<StreamState, string> = {
  connecting: 'connecting',
  live: 'live',
  reconnecting: 'reconnecting',
  closed: 'offline',
};

export interface EventFeedProps {
  /** One file's events (its stream); all files when omitted. */
  fileKey?: string;
  /** Opens a node an event mentions. */
  onOpenNode?: (fileKey: string, nodeId: string) => void;
  /** Controlled pause; uncontrolled when omitted. */
  paused?: boolean;
  onPausedChange?: (paused: boolean) => void;
  /** Show the Pause live / Resume button in the card header (hide it when the page header has one). */
  pauseControl?: boolean;
  /** Most events shown. */
  max?: number;
  /** JSON page size for the initial (newest) page. */
  pageSize?: number;
  title?: ReactNode;
  description?: ReactNode;
  className?: string;
}

/** File names by key, from the JSON page (streamed events carry only the key). */
function fileNamesOf(events: ActivityEvent[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const event of events) if (event.fileKey && event.fileName) names.set(event.fileKey, event.fileName);
  return names;
}

function NoteBody({ fileKey, nodeId, noteId }: { fileKey: string; nodeId: string; noteId: string }) {
  const notes = useNoteList(fileKey, nodeId);
  const body = notes.data?.notes?.find(note => note.noteId === noteId)?.body;
  if (!body) return null;
  return (
    <Text as="span" color="tertiary" className="mt-xs block border-l-2 border-secondary pl-md whitespace-pre-wrap">
      {body}
    </Text>
  );
}

function EventLine({
  event,
  fileName,
  showFile,
  onOpenNode,
}: {
  event: ActivityEvent;
  fileName?: string;
  showFile: boolean;
  onOpenNode?: EventFeedProps['onOpenNode'];
}) {
  const fileKey = event.fileKey;
  const nodeIds = eventNodeIds(event);
  const summary = describeEvent(event);
  return (
    <span className="block">
      {event.type}
      {summary && ` — ${summary}`}
      {showFile && fileKey && (
        <>
          {' in '}
          <Link
            to={`/files/${encodeURIComponent(fileKey)}/nodes`}
            className="rounded-xs font-medium text-brand-secondary outline-focus-ring hover:text-brand-secondary_hover focus-visible:outline-2"
          >
            {fileName ?? fileKey}
          </Link>
        </>
      )}
      {onOpenNode && fileKey && nodeIds.length > 0 && (
        <span className="ml-md inline-flex flex-wrap items-center gap-md align-baseline">
          {nodeIds.slice(0, NODE_LINKS).map(nodeId => (
            <Button
              key={nodeId}
              hierarchy="link-color"
              size="sm"
              aria-label={`Open node ${nodeId}`}
              onPress={() => onOpenNode(fileKey, nodeId)}
            >
              {nodeId}
            </Button>
          ))}
          {nodeIds.length > NODE_LINKS && <span>+{nodeIds.length - NODE_LINKS}</span>}
        </span>
      )}
      {event.type === 'note.added' && fileKey && nodeIds[0] && typeof event.data?.noteId === 'string' && (
        <NoteBody fileKey={fileKey} nodeId={nodeIds[0]} noteId={event.data.noteId} />
      )}
    </span>
  );
}

/** `Live events`: the event log's latest page, then the stream, newest first and grouped by minute. */
export function EventFeed({
  fileKey,
  onOpenNode,
  paused: pausedProp,
  onPausedChange,
  pauseControl = true,
  max,
  pageSize,
  title = 'Live events',
  description = 'Every sync, claim, clear, and block, newest first',
  className,
}: EventFeedProps) {
  const [pausedState, setPausedState] = useState(false);
  const paused = pausedProp ?? pausedState;
  const setPaused = (next: boolean) => {
    if (pausedProp === undefined) setPausedState(next);
    onPausedChange?.(next);
  };
  const { events, buffered, isLoading, error, stream } = useActivityEvents({ fileKey, paused, max, pageSize });
  const now = useNow(30_000);
  const groups = groupByMinute(events);
  const fileNames = fileNamesOf(events);

  const actions =
    pauseControl || (paused && buffered > 0) ? (
      <>
        {paused && buffered > 0 && (
          <Button hierarchy="link-color" size="sm" onPress={() => setPaused(false)}>
            {buffered} new
          </Button>
        )}
        {pauseControl && (
          <Button hierarchy="secondary" size="sm" aria-pressed={paused} onPress={() => setPaused(!paused)}>
            {paused ? 'Resume live' : 'Pause live'}
          </Button>
        )}
      </>
    ) : undefined;

  return (
    <Card className={className}>
      <Card.Header
        title={title}
        badge={<Badge color={paused || stream !== 'live' ? 'gray' : 'brand'}>{paused ? 'paused' : streamBadge[stream]}</Badge>}
        description={description}
        actions={actions}
      />
      <Card.Body className="p-3xl">
        {isLoading ? (
          <LoadingIndicator size="md" label="Loading events…" />
        ) : error ? (
          <Text as="p" color="error-primary">
            Couldn’t load events: {error.message}
          </Text>
        ) : groups.length === 0 ? (
          <Text as="p" color="tertiary">
            No events yet. Syncs, claims, clears and blocks show up here as they happen.
          </Text>
        ) : (
          <Feed aria-label="Events">
            {groups.map(group => {
              const at = group.events[0]?.createdAt;
              return (
                <FeedItem
                  key={group.key}
                  avatar={<Avatar size="lg" alt={group.actor} initials={actorInitials(group.actor)} />}
                  name={group.actor}
                  time={relativeTime(at, now)}
                  dateTime={at}
                >
                  {group.events.map((event, i) => (
                    <EventLine
                      key={event.id ?? i}
                      event={event}
                      fileName={event.fileKey ? fileNames.get(event.fileKey) : undefined}
                      showFile={!fileKey}
                      onOpenNode={onOpenNode}
                    />
                  ))}
                </FeedItem>
              );
            })}
          </Feed>
        )}
      </Card.Body>
    </Card>
  );
}
