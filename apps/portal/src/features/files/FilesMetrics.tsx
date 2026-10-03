import type { HTMLAttributes } from 'react';
import { Metric, MetricChange } from '../../components/Metric';
import { cx } from '../../components/primitives';
import { useClaims } from '../../api/hooks/useClaims';
import { useClearedThisWeek, useFiles, useFilesLive } from './api';
import { formatCount, plural } from './format';
import { filesMetrics } from './metrics';

export type FilesMetricsProps = HTMLAttributes<HTMLDivElement>;

const shown = (value: number | undefined) => (value === undefined ? '—' : formatCount(value));

/** The Files metrics: dirty nodes, nodes cleared this week and active claims, live from `/v3/events`. */
export function FilesMetrics({ className, ...rest }: FilesMetricsProps) {
  useFilesLive();
  const files = useFiles();
  const claims = useClaims();
  const cleared = useClearedThisWeek();
  const values = filesMetrics(files.data ?? [], claims.data ?? []);
  return (
    <div {...rest} className={cx('grid grid-cols-3 gap-2xl', className)}>
      <Metric heading="Dirty nodes" value={shown(files.data && values.dirty)} />
      <Metric heading="Cleared this week" value={shown(cleared.data)} />
      <Metric
        heading="Active claims"
        value={shown(claims.data && values.claims)}
        change={values.workers > 0 ? <MetricChange trendLabel="Agents">{plural(values.workers, 'agent')}</MetricChange> : undefined}
      />
    </div>
  );
}
