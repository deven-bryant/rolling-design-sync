import type { HTMLAttributes } from 'react';
import { Metric, MetricChange } from '../../components/Metric';
import { cx } from '../../components/primitives';
import { useClaims } from '../../api/hooks/useClaims';
import { useFiles, useFilesLive, useTrends } from './api';
import { formatCount, plural } from './format';
import { filesMetrics } from './metrics';

export type FilesMetricsProps = HTMLAttributes<HTMLDivElement>;

const shown = (value: number | undefined) => (value === undefined ? '—' : formatCount(value));

/** `+31`, `-12`, `0`. */
export const signed = (value: number) => (value > 0 ? `+${formatCount(value)}` : value < 0 ? `-${formatCount(-value)}` : '0');

const trend = (value: number) => (value < 0 ? 'negative' : 'positive');

/**
 * The Files metrics: dirty nodes, nodes cleared this week and active claims, live from `/v3/events`. Trend chips
 * (net dirty this week, cleared vs last week) show only when the event log holds both weeks (`complete`).
 */
export function FilesMetrics({ className, ...rest }: FilesMetricsProps) {
  useFilesLive();
  const files = useFiles();
  const claims = useClaims();
  const trends = useTrends();
  const values = filesMetrics(files.data ?? [], claims.data ?? []);
  const total = trends.data?.total;
  const week = trends.data?.complete ? total : undefined;
  const net = week?.netDirty;
  const pct = week?.clearedChangePct;
  return (
    <div {...rest} className={cx('grid grid-cols-3 gap-2xl', className)}>
      <Metric
        heading="Dirty nodes"
        value={shown(files.data && values.dirty)}
        change={
          net ? (
            <MetricChange trend={trend(net)} trendLabel="Net change this week">
              {signed(net)}
            </MetricChange>
          ) : undefined
        }
      />
      <Metric
        heading="Cleared this week"
        value={shown(total?.cleared)}
        change={
          pct !== undefined && pct !== null ? (
            <MetricChange trend={trend(pct)} trendLabel="Change vs last week">
              {`${signed(pct)}%`}
            </MetricChange>
          ) : undefined
        }
      />
      <Metric
        heading="Active claims"
        value={shown(claims.data && values.claims)}
        change={values.workers > 0 ? <MetricChange trendLabel="Agents">{plural(values.workers, 'agent')}</MetricChange> : undefined}
      />
    </div>
  );
}
