import { useState } from 'react';
import { Button } from '../../components/Button';
import { RenderCheck, type RenderCheckImage, type RenderCheckStatus } from '../../components/domain/RenderCheck';
import { Input, Textarea } from '../../components/Input';
import { Text } from '../../components/primitives';
import { showToast } from '../../components/Toast';
import { timeAgo } from './format';
import {
  formatScore,
  renderStatus,
  useConfigureScreen,
  useRenderCheck,
  useRequestCheck,
  useScreen,
  type Attachment,
  type ScreenSettings,
  type ScreenState,
} from './renderChecks';
import type { NodeDetail } from './types';

const SCREEN_TYPES = new Set(['FRAME', 'COMPONENT']);
const shortRef = (ref: string) => (/^[0-9a-f]{8,}$/i.test(ref) ? ref.slice(0, 7) : ref);

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

/**
 * A screen root's render check (Figma `Node Details - Render Check`): its status, the last result's images, score and
 * regions, *Request check* for anyone signed in and *Check settings* for agents. Shown on frames and components only.
 */
export function RenderCheckPanel({ fileKey, node, canAct, now }: { fileKey: string; node: NodeDetail; canAct: boolean; now: number }) {
  const nodeId = node.nodeId ?? '';
  const summary = node.screen;
  const candidate = !!summary || (SCREEN_TYPES.has(node.type ?? '') && canAct);
  const screenQuery = useScreen(fileKey, nodeId, { enabled: candidate });
  const screen = screenQuery.data;
  const check = useRenderCheck(fileKey, screen?.lastCheck?.checkId).data;
  const request = useRequestCheck(fileKey);
  const [editing, setEditing] = useState(false);
  if (!candidate || node.deleted) return null;

  const status = renderStatus(summary ?? screen);
  const configured = status !== 'not-set-up';
  const regions = (check?.regions ?? []).map(({ x = 0, y = 0, width = 0, height = 0 }) => ({ x, y, width, height }));
  const meta = check
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
      : [];
  const scored = check?.status === 'passed' || check?.status === 'mismatch';
  const message =
    status === 'not-set-up'
      ? canAct
        ? 'Not a screen yet. Set its route and viewport to compare the built page with this frame.'
        : 'Not set up for render checks. An agent sets its route and viewport.'
      : status === 'error'
        ? (check?.error ?? 'The last check failed.')
        : MESSAGES[status];
  return (
    <RenderCheck
      status={status}
      meta={meta}
      designed={image(check?.reference ?? screen?.reference)}
      implemented={image(check?.built)}
      heatmap={image(check?.heatmap)}
      regions={regions}
      message={scored && status !== 'stale' ? undefined : message}
      summary={
        scored ? `${formatScore(check?.score)} of pixels differ · ${regions.length} ${regions.length === 1 ? 'region' : 'regions'}` : undefined
      }
      details={regions.map(r => `${r.width} × ${r.height} px at ${r.x}, ${r.y}`)}
      actions={
        <>
          {canAct && (
            <Button hierarchy="secondary" size="md" isDisabled={editing} onPress={() => setEditing(true)}>
              {configured ? 'Check settings' : 'Set up check'}
            </Button>
          )}
          {configured && (
            <Button
              hierarchy="primary"
              size="md"
              isDisabled={status === 'requested'}
              loading={request.isPending}
              onPress={() => request.mutate(nodeId, { onSuccess: () => void showToast('Render check requested') })}
            >
              Request check
            </Button>
          )}
        </>
      }
    >
      {canAct && editing && !screenQuery.isPending && <SettingsForm fileKey={fileKey} nodeId={nodeId} screen={screen} onDone={() => setEditing(false)} />}
      {request.isError && <Text color="error-primary">{request.error.message}</Text>}
    </RenderCheck>
  );
}
