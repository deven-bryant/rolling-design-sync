import type { HTMLAttributes, ReactNode } from 'react';
import { Badge } from '../../components/Badge';
import { Card } from '../../components/Card';
import { Text } from '../../components/primitives';
import { BadgeCell, ProgressCell, Table, TextCell } from '../../components/Table';
import { AgentCell } from '../../components/domain/AgentCell';
import { NodeCell } from '../../components/domain/NodeCell';
import { useClaims } from '../../api/hooks/useClaims';
import { useNow } from '../../api/hooks/useNow';
import { useFileScopes, useFiles, useFilesLive, useLastSyncClient, type Claim, type TrackedFile } from './api';
import { formatCount, percent, plural, timeAgo } from './format';
import { fileAgents } from './metrics';

export interface FilesTableProps extends HTMLAttributes<HTMLDivElement> {
  /** A row was activated. */
  onOpenFile: (fileKey: string) => void;
  /** "Run the plugin on a frame" was pressed. */
  onOpenConnect: () => void;
}

const COLUMNS = ['File', 'Scopes', 'Dirty', 'Implemented', 'Last sync', 'Agents'] as const;
const SCOPE_NAMES = 2;

const connectLink =
  'cursor-pointer rounded-xs text-tertiary underline-offset-2 outline-focus-ring hover:underline focus-visible:outline-2 focus-visible:outline-offset-2';

function ScopesCell({ fileKey, onOpenConnect }: { fileKey: string; onOpenConnect: () => void }) {
  const scopes = useFileScopes(fileKey);
  if (!scopes.data) return <TextCell>{scopes.isError ? "Couldn't load scopes" : '—'}</TextCell>;
  if (scopes.data.length === 0) {
    return (
      <TextCell
        supportingText={
          <button type="button" className={connectLink} onClick={onOpenConnect}>
            Run the plugin on a frame
          </button>
        }
      >
        No scopes yet
      </TextCell>
    );
  }
  const names = scopes.data.map(scope => scope.name ?? scope.nodeId ?? '');
  const more = names.length - SCOPE_NAMES;
  const listed = [...names.slice(0, SCOPE_NAMES), ...(more > 0 ? [`+${more}`] : [])].join(', ');
  return <TextCell supportingText={listed}>{plural(scopes.data.length, 'scope')}</TextCell>;
}

function LastSyncCell({ file, now }: { file: TrackedFile; now: number }) {
  const client = useLastSyncClient(file.fileKey ?? '', file.lastSyncAt);
  if (!file.lastSyncAt) return <TextCell supportingText="—">Never</TextCell>;
  return <TextCell supportingText={client.data ?? '—'}>{timeAgo(file.lastSyncAt, now)}</TextCell>;
}

function AgentsCell({ agents, now }: { agents: Claim[]; now: number }) {
  const [first] = agents;
  return (
    <Table.Cell>
      {first?.worker ? (
        <AgentCell
          worker={first.worker}
          when={agents.length > 1 ? `+${plural(agents.length - 1, 'agent')}` : first.createdAt && `claimed ${timeAgo(first.createdAt, now, 'short')}`}
        />
      ) : (
        <AgentCell worker="—" avatar={false} when="no claims" />
      )}
    </Table.Cell>
  );
}

function FileRow({ file, claims, now, onOpenFile, onOpenConnect }: { file: TrackedFile; claims: readonly Claim[]; now: number } & Pick<FilesTableProps, 'onOpenFile' | 'onOpenConnect'>) {
  const fileKey = file.fileKey ?? '';
  const name = file.name ?? fileKey;
  const dirty = file.counts?.dirty ?? 0;
  const value = percent(file.counts?.clean ?? 0, file.counts?.total ?? 0);
  return (
    <Table.Row onAction={() => onOpenFile(fileKey)} aria-label={name}>
      <Table.Cell>
        <NodeCell name={name} meta={fileKey} />
      </Table.Cell>
      <ScopesCell fileKey={fileKey} onOpenConnect={onOpenConnect} />
      <BadgeCell>
        <Badge color={dirty > 0 ? 'warning' : 'gray'} aria-label={`${formatCount(dirty)} dirty`}>
          {formatCount(dirty)}
        </Badge>
      </BadgeCell>
      <ProgressCell value={value} label={`${name} implemented`} />
      <LastSyncCell file={file} now={now} />
      <AgentsCell agents={fileAgents(claims, fileKey)} now={now} />
    </Table.Row>
  );
}

function MessageRow({ children }: { children: ReactNode }) {
  return (
    <Table.Row>
      <Table.Cell colSpan={COLUMNS.length}>
        <Text color="tertiary">{children}</Text>
      </Table.Cell>
    </Table.Row>
  );
}

/** The Tracked files card: one row per `GET /v3/files` file, live from `/v3/events`. */
export function FilesTable({ onOpenFile, onOpenConnect, className, ...rest }: FilesTableProps) {
  useFilesLive();
  const files = useFiles();
  const claims = useClaims();
  const now = useNow();
  return (
    <Card {...rest} className={className}>
      <Card.Header
        title="Tracked files"
        badge={files.data && <Badge color="brand">{plural(files.data.length, 'file')}</Badge>}
        description="Open a file to see its synced scopes and node tree"
      />
      <Card.Body>
        <Table aria-label="Tracked files">
          <Table.Header>
            {COLUMNS.map(column => (
              <Table.HeaderCell key={column}>{column}</Table.HeaderCell>
            ))}
          </Table.Header>
          <Table.Body>
            {files.isPending && <MessageRow>Loading files…</MessageRow>}
            {files.isError && <MessageRow>Couldn&apos;t load files.</MessageRow>}
            {files.data?.length === 0 && (
              <MessageRow>
                No files yet.{' '}
                <button type="button" className={connectLink} onClick={onOpenConnect}>
                  Run the plugin on a frame
                </button>
              </MessageRow>
            )}
            {files.data?.map(file => (
              <FileRow
                key={file.fileKey}
                file={file}
                claims={claims.data ?? []}
                now={now}
                onOpenFile={onOpenFile}
                onOpenConnect={onOpenConnect}
              />
            ))}
          </Table.Body>
        </Table>
      </Card.Body>
    </Card>
  );
}
