import { useState } from 'react';
import { Button } from '../../components/Button';
import { RenderCheck, type RenderCheckImage, type RenderCheckStatus } from '../../components/domain/RenderCheck';
import { Input, Textarea } from '../../components/Input';
import { Text } from '../../components/primitives';
import { showToast } from '../../components/Toast';
import { timeAgo } from './format';
import { ButtonUtility } from '../../components/Button';
import { RenderCheckHistory, RenderChecksContaining, RenderCheckTargetDetails, type RenderCheckTargetDetail } from '../../components/domain/RenderCheckTarget';
import { Icon } from '../../components/primitives';
import {
  formatScore,
  renderStatus,
  targetStatus,
  useConfigureScreen,
  useContainingTargets,
  useRenderCheck,
  useRequestCheck,
  useScreen,
  useTargetChecks,
  useUpdateTarget,
  type Attachment,
  type CheckTarget,
  type ScreenSettings,
  type ScreenState,
  type TargetCheck,
} from './renderChecks';
import type { NodeDetail } from './types';

const SCREEN_TYPES = new Set(['FRAME', 'COMPONENT']);
export const shortRef = (ref: string) => (/^[0-9a-f]{8,}$/i.test(ref) ? ref.slice(0, 7) : ref);

const image = (a: Attachment | null | undefined): RenderCheckImage | undefined =>
  a?.url ? { src: a.thumbUrl ?? a.url, fullSrc: a.url, width: a.width, height: a.height } : undefined;

const MESSAGES: Partial<Record<RenderCheckStatus, string>> = {
  building: 'Nodes under this screen are still dirty; check it once they’re built.',
  ready: 'Built and not yet checked against this design.',
  requested: 'Waiting for an agent to render it and submit the result (rds-agent check).',
  stale: 'The last result is for an older design; request a new check.',
};

/** `x, y, width, height` per line → masks; null when a line doesn't parse. */
export function parseMasks(text: string): ScreenSettings['masks'] | null {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const masks = lines.map(line => line.split(/[\s,]+/).map(Number));
  if (masks.some(m => m.length !== 4 || m.some(n => !Number.isFinite(n) || n < 0))) return null;
  return masks.map(([x, y, width, height]) => ({ x: x!, y: y!, width: width!, height: height! }));
}

export function SettingsForm({
  fileKey,
  nodeId,
  screen,
  onDone,
}: {
  fileKey: string;
  nodeId: string;
  screen: ScreenState | null | undefined;
  onDone: () => void;
}) {
  const configure = useConfigureScreen(fileKey);
  const [route, setRoute] = useState(screen?.route ?? '');
  const [width, setWidth] = useState(String(screen?.viewport?.width ?? ''));
  const [height, setHeight] = useState(String(screen?.viewport?.height ?? ''));
  const [theme, setTheme] = useState(screen?.theme ?? '');
  const [query, setQuery] = useState(screen?.query ?? '');
  const [threshold, setThreshold] = useState(screen?.threshold == null ? '' : String(screen.threshold));
  const [masks, setMasks] = useState((screen?.masks ?? []).map(m => `${m.x}, ${m.y}, ${m.width}, ${m.height}`).join('\n'));
  const [submitted, setSubmitted] = useState(false);
  const routeError = route.trim().startsWith('/') ? null : 'Enter the built page’s path, e.g. /work.';
  const viewportError = (width || height) && !(Number(width) > 0 && Number(height) > 0) ? 'Enter both a width and a height in px.' : null;
  const thresholdError = threshold && !(Number(threshold) >= 0 && Number(threshold) <= 100) ? 'Enter 0–100 (% of pixels).' : null;
  const parsedMasks = parseMasks(masks);
  const masksError = parsedMasks ? null : 'One mask per line: x, y, width, height.';
  const invalid = !!(routeError || viewportError || thresholdError || masksError);
  const submit = () => {
    setSubmitted(true);
    if (invalid) return;
    const settings: ScreenSettings = {
      route: route.trim(),
      theme: theme.trim() || null,
      query: query.trim() || null,
      masks: parsedMasks ?? [],
      ...(width && height ? { viewport: { width: Number(width), height: Number(height) } } : {}),
      ...(threshold ? { threshold: Number(threshold) } : {}),
    };
    configure.mutate({ nodeId, settings }, { onSuccess: () => (void showToast('Check settings saved'), onDone()) });
  };
  return (
    <form
      noValidate
      aria-label="Check settings"
      className="flex flex-col gap-lg rounded-lg border border-secondary bg-secondary p-xl"
      onSubmit={event => {
        event.preventDefault();
        submit();
      }}
    >
      <Input label="Route" required placeholder="/work" value={route} onChange={setRoute} isInvalid={submitted && !!routeError} hint={submitted ? routeError : undefined} />
      <div className="grid grid-cols-2 gap-lg">
        <Input label="Viewport width" inputMode="numeric" placeholder="1440" value={width} onChange={setWidth} isInvalid={submitted && !!viewportError} />
        <Input
          label="Viewport height"
          inputMode="numeric"
          placeholder="900"
          value={height}
          onChange={setHeight}
          isInvalid={submitted && !!viewportError}
          hint={submitted ? viewportError : undefined}
        />
        <Input label="Theme" placeholder="dark" value={theme} onChange={setTheme} />
        <Input label="Query" placeholder="tab=frames" value={query} onChange={setQuery} />
      </div>
      <Input
        label="Threshold (%)"
        inputMode="decimal"
        placeholder="1"
        value={threshold}
        onChange={setThreshold}
        isInvalid={submitted && !!thresholdError}
        hint={submitted && thresholdError ? thresholdError : 'Pixels that may differ before the check fails.'}
      />
      <Textarea
        label="Masks"
        rows={3}
        placeholder="0, 0, 1440, 64"
        value={masks}
        onChange={setMasks}
        isInvalid={submitted && !!masksError}
        hint={submitted && masksError ? masksError : 'Rectangles the comparison skips, one per line: x, y, width, height.'}
      />
      {configure.isError && <Text color="error-primary">{configure.error.message}</Text>}
      <div className="flex justify-end gap-lg">
        <Button hierarchy="secondary" size="sm" onPress={onDone}>
          Cancel
        </Button>
        <Button hierarchy="primary" size="sm" type="submit" loading={configure.isPending}>
          Save settings
        </Button>
      </div>
    </form>
  );
}

/** Where the render-check docs explain targets, sections and exclusion. */
export const RENDER_CHECKS_DOCS = 'https://github.com/deven-bryant/rolling-design-sync/blob/dev/docs/ui-portal.md#render-checks';

export const EXCLUDED_HINT = 'Excluded from render checks: it isn’t checked, and it stays excluded when targets are detected again. Turn the toggle off to check it.';
export const NOT_TARGET_HINT =
  'This section isn’t set up for render checks. Choose Screens or Components for it in the plugin to check it automatically.';

const LEVELS: Record<string, string> = { COMPONENT: 'Component', COMPONENT_SET: 'Component', INSTANCE: 'Instance' };
/** `Screen`, `Component` or `Instance` for a target's node type. */
export const targetKind = (type: string | null | undefined) => LEVELS[type ?? ''] ?? 'Screen';

/** `Screen · checked 2h ago` / `Component · waiting on Breadcrumbs`. */
export function targetMeta(target: CheckTarget, now: number): string {
  const kind = targetKind(target.type);
  if (target.excluded) return `${kind} · excluded`;
  if (target.status === 'waiting' && target.waitingOn) return `${kind} · waiting on ${target.waitingOn.name ?? target.waitingOn.nodeId}`;
  const at = target.lastCheck?.submittedAt ?? target.lastCheck?.requestedAt;
  return at ? `${kind} · checked ${timeAgo(at, now)}` : `${kind} · not checked yet`;
}

function variantText(target: CheckTarget): string {
  const render = (target.render ?? {}) as { variant?: unknown; props?: unknown };
  if (typeof render.variant === 'string' && render.variant) return render.variant.split(',').map(p => p.trim().replace('=', ': ')).join(' · ');
  if (render.props && typeof render.props === 'object') {
    const entries = Object.entries(render.props as Record<string, unknown>);
    if (entries.length) return entries.map(([k, v]) => `${k}: ${String(v)}`).join(' · ');
  }
  return '—';
}

function RouteForm({ fileKey, target, onDone }: { fileKey: string; target: CheckTarget; onDone: () => void }) {
  const update = useUpdateTarget(fileKey);
  const [route, setRoute] = useState(target.route ?? '');
  const [submitted, setSubmitted] = useState(false);
  const error = route.trim().startsWith('/') ? null : 'Enter the built page’s path, e.g. /work.';
  return (
    <form
      noValidate
      aria-label="Edit route"
      className="mt-md flex flex-col gap-lg rounded-lg border border-secondary bg-secondary p-xl"
      onSubmit={event => {
        event.preventDefault();
        setSubmitted(true);
        if (error) return;
        update.mutate(
          { nodeId: target.nodeId ?? '', change: { route: route.trim() } },
          { onSuccess: () => (void showToast('Route saved'), onDone()) },
        );
      }}
    >
      <Input label="Route" required autoFocus placeholder="/work" value={route} onChange={setRoute} isInvalid={submitted && !!error} hint={submitted ? error : 'The app path it renders at when the gallery has no entry for it.'} />
      {update.isError && <Text color="error-primary">{update.error.message}</Text>}
      <div className="flex justify-end gap-lg">
        <Button hierarchy="secondary" size="sm" onPress={onDone}>
          Cancel
        </Button>
        <Button hierarchy="primary" size="sm" type="submit" loading={update.isPending}>
          Save route
        </Button>
      </div>
    </form>
  );
}

/** `Render Check Target Details`: source, route (editable by agents), variants and theme, and *Exclude from checks*. */
function TargetDetails({ fileKey, target, canAct, themeMode }: { fileKey: string; target: CheckTarget; canAct: boolean; themeMode: string }) {
  const update = useUpdateTarget(fileKey);
  const [editing, setEditing] = useState(false);
  const excluded = !!target.excluded;
  const details: RenderCheckTargetDetail[] = [
    { label: 'Source', value: target.source === 'manual' ? 'Manual · set up as a screen' : 'Auto · detected in a checked section' },
    {
      label: 'Route',
      value: target.route ?? (target.notMapped ? '—' : 'Gallery'),
      action: canAct && !editing && (
        <ButtonUtility hierarchy="tertiary" icon={<Icon name="edit-01" />} tooltip="Edit route" onPress={() => setEditing(true)} />
      ),
    },
    { label: 'Variants', value: variantText(target) },
    { label: 'Theme', value: target.theme ? `${target.theme} · ${themeMode}` : themeMode },
  ];
  return (
    <RenderCheckTargetDetails
      excluded={excluded}
      onExcludedChange={
        canAct && !update.isPending
          ? next =>
              update.mutate(
                { nodeId: target.nodeId ?? '', change: { excluded: next } },
                { onSuccess: () => void showToast(next ? 'Excluded from render checks' : 'Included in render checks') },
              )
          : undefined
      }
      details={details}
      hint={excluded ? EXCLUDED_HINT : undefined}
      learnMoreHref={excluded ? RENDER_CHECKS_DOCS : undefined}
      headingLevel="h4"
      footer={
        <>
          {canAct && editing && <RouteForm fileKey={fileKey} target={target} onDone={() => setEditing(false)} />}
          {update.isError && <Text color="error-primary">{update.error.message}</Text>}
        </>
      }
    />
  );
}

const checkSummary = (check: TargetCheck) =>
  [check.score != null ? formatScore(check.score) : null, check.commitRef ? shortRef(check.commitRef) : null].filter(Boolean).join(' · ') ||
  (check.status === 'requested' ? 'Requested' : '—');

interface PanelProps {
  fileKey: string;
  node: NodeDetail;
  canAct: boolean;
  now: number;
  /** Opens another node (a containing target) in the drawer. */
  onOpenNode?: (nodeId: string) => void;
  /** The file's `checkRetention` and `themeMode`. */
  retention?: number;
  themeMode?: string;
}

/**
 * A node's render checks (Figma `Node Details - Render Check`). A check target shows its status, the viewed
 * result's images, score and regions, its target details and its history; any other node lists the targets that
 * contain it. *Request check* is for anyone signed in; route, exclusion and *Set up check* are for agents.
 */
export function RenderCheckPanel({ fileKey, node, canAct, now, onOpenNode, retention = 5, themeMode = 'color-scheme' }: PanelProps) {
  const nodeId = node.nodeId ?? '';
  const containing = useContainingTargets(fileKey, nodeId, { enabled: !node.deleted });
  const targets = containing.data ?? [];
  const target = targets.find(t => t.nodeId === nodeId);
  const others = targets.filter(t => t.nodeId !== nodeId);
  if (node.deleted || containing.isPending) return null;
  if (target) return <TargetPanel fileKey={fileKey} target={target} canAct={canAct} now={now} retention={retention} themeMode={themeMode} others={others} onOpenNode={onOpenNode} />;
  const candidate = !!node.screen || SCREEN_TYPES.has(node.type ?? '');
  return (
    <>
      {others.length > 0 && (
        <RenderChecksContaining
          headingLevel="h4"
          targets={others.map(t => ({ id: t.nodeId ?? '', name: t.name ?? t.nodeId ?? '', meta: targetMeta(t, now), status: t.excluded ? 'not-set-up' : targetStatus(t) }))}
          onOpen={onOpenNode}
        />
      )}
      {candidate && <ScreenPanel fileKey={fileKey} node={node} canAct={canAct} now={now} />}
    </>
  );
}

function TargetPanel({
  fileKey,
  target,
  canAct,
  now,
  retention,
  themeMode,
  others,
  onOpenNode,
}: {
  fileKey: string;
  target: CheckTarget;
  canAct: boolean;
  now: number;
  retention: number;
  themeMode: string;
  others: readonly CheckTarget[];
  onOpenNode?: (nodeId: string) => void;
}) {
  const nodeId = target.nodeId ?? '';
  const history = useTargetChecks(fileKey, nodeId).data ?? [];
  const request = useRequestCheck(fileKey);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const check = history.find(c => c.checkId === viewingId) ?? history[0];
  const latest = history[0];
  const baseline = history.find(c => c.status === 'passed');
  const status: RenderCheckStatus = target.excluded ? 'not-set-up' : check && check !== latest ? (check.status as RenderCheckStatus) : targetStatus(target);
  const regions = (check?.regions ?? []).map(({ x = 0, y = 0, width = 0, height = 0 }) => ({ x, y, width, height }));
  const meta = check
    ? [
        { label: 'Checked', value: timeAgo(check.submittedAt ?? check.requestedAt, now) },
        { label: 'Commit', value: check.commitRef ? shortRef(check.commitRef) : '—' },
        { label: 'Source', value: check.source ?? '—' },
        { label: 'Limit', value: formatScore(check.threshold ?? target.threshold) },
      ]
    : [{ label: 'Limit', value: formatScore(target.threshold) }];
  const scored = !!check && (status === 'passed' || status === 'mismatch');
  const message = target.excluded
    ? 'Excluded from render checks.'
    : status === 'error'
      ? (check?.error ?? 'The last check failed.')
      : status === 'waiting'
        ? `Waiting: ${target.waitingOn?.name ?? 'a target inside it'} last failed; it’s checked once that passes.`
        : status === 'not-mapped'
          ? 'Not mapped: no gallery entry or route renders it. Set its route, or add it to the gallery.'
          : MESSAGES[status];
  return (
    <>
      <RenderCheck
        status={status}
        meta={meta}
        designed={image(check?.reference ?? target.reference)}
        implemented={image(check?.built)}
        heatmap={image(check?.heatmap)}
        regions={regions}
        message={scored && !target.excluded ? undefined : message}
        diff={scored ? { score: formatScore(check?.score), regions: regions.length } : undefined}
        details={regions.map(r => `${r.width} × ${r.height} px at ${r.x}, ${r.y}`)}
        actions={
          !target.excluded && (
            <Button
              hierarchy="primary"
              size="md"
              isDisabled={target.status === 'requested'}
              loading={request.isPending}
              onPress={() => request.mutate(nodeId, { onSuccess: () => void showToast('Render check requested') })}
            >
              Request check
            </Button>
          )
        }
      >
        {request.isError && <Text color="error-primary">{request.error.message}</Text>}
        <TargetDetails fileKey={fileKey} target={target} canAct={canAct} themeMode={themeMode} />
        {history.length > 0 && (
          <RenderCheckHistory
            headingLevel="h4"
            retention={retention}
            onSelect={setViewingId}
            results={history.map(c => ({
              id: c.checkId ?? '',
              status: c.status as RenderCheckStatus,
              summary: checkSummary(c),
              time: timeAgo(c.submittedAt ?? c.requestedAt, now),
              viewing: c === check,
              baseline: c === baseline,
            }))}
          />
        )}
      </RenderCheck>
      {others.length > 0 && (
        <RenderChecksContaining
          headingLevel="h4"
          targets={others.map(t => ({ id: t.nodeId ?? '', name: t.name ?? t.nodeId ?? '', meta: targetMeta(t, now), status: t.excluded ? 'not-set-up' : targetStatus(t) }))}
          onOpen={onOpenNode}
        />
      )}
    </>
  );
}

/** A frame, component or instance that isn't a check target: the not-a-target hint, and *Set up check* for agents. */
function ScreenPanel({ fileKey, node, canAct, now }: { fileKey: string; node: NodeDetail; canAct: boolean; now: number }) {
  const nodeId = node.nodeId ?? '';
  const summary = node.screen;
  const screenQuery = useScreen(fileKey, nodeId, { enabled: !!summary });
  const screen = screenQuery.data;
  const check = useRenderCheck(fileKey, screen?.lastCheck?.checkId).data;
  const request = useRequestCheck(fileKey);
  const [editing, setEditing] = useState(false);
  const status = renderStatus(summary ?? screen);
  if (status === 'not-set-up') {
    return (
      <RenderCheckTargetDetails
        title="Render check"
        excluded={false}
        hideExclude
        hint={NOT_TARGET_HINT}
        learnMoreHref={RENDER_CHECKS_DOCS}
        headingLevel="h4"
        footer={
          canAct && (
            <div className="flex flex-col gap-lg pt-lg">
              {editing ? (
                <SettingsForm fileKey={fileKey} nodeId={nodeId} screen={screen} onDone={() => setEditing(false)} />
              ) : (
                <div className="flex justify-end">
                  <Button hierarchy="secondary" size="md" onPress={() => setEditing(true)}>
                    Set up check
                  </Button>
                </div>
              )}
            </div>
          )
        }
      />
    );
  }
  const regions = (check?.regions ?? []).map(({ x = 0, y = 0, width = 0, height = 0 }) => ({ x, y, width, height }));
  const scored = check?.status === 'passed' || check?.status === 'mismatch';
  return (
    <RenderCheck
      status={status}
      meta={
        check
          ? [
              { label: 'Checked', value: timeAgo(check.submittedAt ?? check.requestedAt, now) },
              { label: 'Commit', value: check.commitRef ? shortRef(check.commitRef) : '—' },
              { label: 'Source', value: check.source ?? '—' },
              { label: 'Limit', value: formatScore(check.threshold ?? screen?.threshold) },
            ]
          : screen
            ? [
                { label: 'Route', value: screen.route ?? '—' },
                { label: 'Limit', value: formatScore(screen.threshold) },
              ]
            : []
      }
      designed={image(check?.reference ?? screen?.reference)}
      implemented={image(check?.built)}
      heatmap={image(check?.heatmap)}
      regions={regions}
      message={scored && status !== 'stale' ? undefined : status === 'error' ? (check?.error ?? 'The last check failed.') : MESSAGES[status]}
      diff={scored ? { score: formatScore(check?.score), regions: regions.length } : undefined}
      details={regions.map(r => `${r.width} × ${r.height} px at ${r.x}, ${r.y}`)}
      actions={
        <>
          {canAct && (
            <Button hierarchy="secondary" size="md" isDisabled={editing} onPress={() => setEditing(true)}>
              Check settings
            </Button>
          )}
          <Button
            hierarchy="primary"
            size="md"
            isDisabled={status === 'requested'}
            loading={request.isPending}
            onPress={() => request.mutate(nodeId, { onSuccess: () => void showToast('Render check requested') })}
          >
            Request check
          </Button>
        </>
      }
    >
      {canAct && editing && !screenQuery.isPending && <SettingsForm fileKey={fileKey} nodeId={nodeId} screen={screen} onDone={() => setEditing(false)} />}
      {request.isError && <Text color="error-primary">{request.error.message}</Text>}
    </RenderCheck>
  );
}
