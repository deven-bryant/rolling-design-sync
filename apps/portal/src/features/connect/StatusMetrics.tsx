import { Metric, MetricChange } from '../../components/Metric';
import { cx } from '../../components/primitives';
import type { StreamState } from '../../api/useEventStream';
import { useNow } from '../../api/hooks/useNow';
import { relativeTime } from '../activity/time';
import { useServerStatus } from './useServerStatus';

const streamValue: Record<StreamState, string> = {
  connecting: 'Connecting',
  live: 'Live',
  reconnecting: 'Reconnecting',
  closed: 'Offline',
};

/** `plugin/0.10.0` → `0.10.0`. */
const clientVersion = (client: string | null | undefined) => client?.split('/').at(-1) ?? null;

/** Health metrics from `GET /v3/status`: server version, event delivery, plugin last seen. */
export function StatusMetrics({ className }: { className?: string }) {
  const { status, error, stream } = useServerStatus();
  const now = useNow(30_000);
  const lastSync = status?.plugin?.lastSyncAt;
  return (
    <div className={cx('grid grid-cols-1 gap-2xl md:grid-cols-3', className)}>
      <Metric
        heading="Server"
        value={status?.version ? `v${status.version}` : '—'}
        change={error ? undefined : status && <MetricChange trendLabel="">healthy</MetricChange>}
      />
      <Metric
        heading="Event stream"
        value={streamValue[stream]}
        change={
          status?.events && <MetricChange trendLabel="">{status.events === 'listening' ? 'LISTEN/NOTIFY' : 'polling'}</MetricChange>
        }
      />
      <Metric
        heading="Plugin"
        value={clientVersion(status?.plugin?.client) ?? '—'}
        change={
          status && (
            <MetricChange trendLabel="">{lastSync ? `synced ${relativeTime(lastSync, now).toLowerCase()}` : 'no sync yet'}</MetricChange>
          )
        }
      />
    </div>
  );
}
