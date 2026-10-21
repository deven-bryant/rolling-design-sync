import { useId, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { Badge, type BadgeProps } from '../../Badge';
import { ImageThumbnail } from '../../Lightbox';
import { cx, Text } from '../../primitives';
import { Tabs } from '../../Tabs';
import { KvBadgeList } from '../KvBadge';

/**
 * A target's render-check state: the API's target `status`, `stale` when its last result is for an older design,
 * `not-mapped` when neither the gallery nor a route renders it, or `not-set-up`.
 */
export type RenderCheckStatus =
  | 'not-set-up'
  | 'not-mapped'
  | 'building'
  | 'ready'
  | 'waiting'
  | 'requested'
  | 'passed'
  | 'mismatch'
  | 'error'
  | 'stale';

export const renderCheckColors = {
  'not-set-up': 'gray',
  'not-mapped': 'gray',
  building: 'gray-blue',
  ready: 'brand',
  waiting: 'warning',
  requested: 'blue-light',
  passed: 'success',
  mismatch: 'error',
  error: 'error',
  stale: 'warning',
} as const satisfies Record<RenderCheckStatus, NonNullable<BadgeProps['color']>>;

export const renderCheckLabels: Record<RenderCheckStatus, string> = {
  'not-set-up': 'Not set up',
  'not-mapped': 'Not mapped',
  building: 'Building',
  ready: 'Ready',
  waiting: 'Waiting',
  requested: 'Requested',
  passed: 'Passed',
  mismatch: 'Render mismatch',
  error: 'Error',
  stale: 'Stale',
};

export interface RenderCheckBadgeProps extends Omit<BadgeProps, 'color' | 'children'> {
  status: RenderCheckStatus;
  children?: ReactNode;
}

/** A render-check status as a Badge: passed → success, mismatch / error → error, stale → warning. */
export function RenderCheckBadge({ status, children, ...rest }: RenderCheckBadgeProps) {
  return (
    <Badge {...rest} color={renderCheckColors[status]}>
      {children ?? renderCheckLabels[status]}
    </Badge>
  );
}

export interface RenderCheckImage {
  /** The thumbnail (an attachment's `thumbUrl`). */
  src: string;
  /** The full image for the lightbox (an attachment's `url`). */
  fullSrc?: string;
  /** Pixel size of the full image: the frame's aspect ratio; scales the region outlines. */
  width?: number;
  height?: number;
}

export interface RenderCheckRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type RenderCheckView = 'side-by-side' | 'heatmap';

export interface RenderCheckHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  /** The status badge after the title. */
  status?: ReactNode;
  /** `KV Badge`s: Checked · Commit · Source · Limit. */
  meta?: readonly { label: string; value: ReactNode }[];
  headingLevel?: 3 | 4;
  ref?: Ref<HTMLDivElement>;
}

/** Figma `Render Check Header` (Variant2): `Render check` (text-md semibold text-secondary) over a row of KV badges split by dividers. */
export function RenderCheckHeader({ title = 'Render check', status, meta = [], headingLevel = 3, className, ...rest }: RenderCheckHeaderProps) {
  return (
    <div {...rest} className={cx('flex flex-col gap-xxs', className)}>
      <div className="flex flex-wrap items-center gap-md">
        <Text as={`h${headingLevel}`} size="md" weight="semibold" color="secondary">
          {title}
        </Text>
        {status}
      </div>
      {meta.length > 0 && <KvBadgeList items={meta} />}
    </div>
  );
}

const pct = (n: number, of: number | undefined) => `${of ? Math.min(100, Math.max(0, (n / of) * 100)) : 0}%`;

function Regions({ regions, image }: { regions: readonly RenderCheckRegion[]; image: RenderCheckImage }) {
  if (!image.width || !image.height) return null;
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      {regions.map((r, i) => (
        <span
          key={i}
          data-region
          className="absolute rounded-xxs border-2 border-error bg-error-solid/15"
          style={{ left: pct(r.x, image.width), top: pct(r.y, image.height), width: pct(r.width, image.width), height: pct(r.height, image.height) }}
        />
      ))}
    </span>
  );
}

/** The tallest a side-by-side or heatmap image gets (px); it is shown whole, as wide as the panel allows. */
export const SHOT_MAX_HEIGHT = 224;

function Shot({ image, alt, caption, overlay }: { image: RenderCheckImage; alt: string; caption: string; overlay?: ReactNode }) {
  const aspect = image.width && image.height ? { width: image.width, height: image.height } : undefined;
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center">
      <ImageThumbnail
        src={image.src}
        fullSrc={image.fullSrc}
        alt={alt}
        caption={caption}
        aspect={aspect}
        maxHeight={SHOT_MAX_HEIGHT}
        className={aspect ? undefined : 'h-40 w-full'}
        overlay={overlay}
      />
    </div>
  );
}

export interface DiffStatusProps extends HTMLAttributes<HTMLDivElement> {
  /** `Pixel diff`: e.g. `3.4%`. */
  score: ReactNode;
  /** `Regions`: how many differ. */
  regions: ReactNode;
  /** Bullets under the values (what differs). */
  details?: readonly ReactNode[];
  headingLevel?: 3 | 4;
  ref?: Ref<HTMLDivElement>;
}

/**
 * Figma `Diff Status`: `Diff Status` (text-md semibold text-secondary), then `Pixel diff` / `Regions` labels (text-sm
 * tertiary) beside their values (semibold), then the differing regions as bullets; all `gap-xxs`.
 */
export function DiffStatus({ score, regions, details = [], headingLevel = 4, className, ...rest }: DiffStatusProps) {
  return (
    <div {...rest} className={cx('flex flex-col gap-xxs', className)}>
      <Text as={`h${headingLevel}`} size="md" weight="semibold" color="secondary">
        Diff Status
      </Text>
      <dl className="grid grid-cols-[auto_1fr] gap-x-md text-sm text-tertiary">
        <dt>Pixel diff</dt>
        <dd className="font-semibold">{score}</dd>
        <dt>Regions</dt>
        <dd className="font-semibold">{regions}</dd>
      </dl>
      {details.length > 0 && (
        <ul aria-label="Differing regions" className="flex list-inside list-disc flex-col text-sm text-tertiary">
          {details.map((detail, i) => (
            <li key={i}>{detail}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface RenderCheckProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  status: RenderCheckStatus;
  meta?: RenderCheckHeaderProps['meta'];
  /** Figma `Tabs`, controlled; pair with `onViewChange`. */
  view?: RenderCheckView;
  defaultView?: RenderCheckView;
  onViewChange?: (view: RenderCheckView) => void;
  /** `Design · Figma frame`: the reference image. */
  designed?: RenderCheckImage;
  /** `Built · <route>`: the submitted screenshot, with `regions` outlined on it. */
  implemented?: RenderCheckImage;
  heatmap?: RenderCheckImage;
  regions?: readonly RenderCheckRegion[];
  /** `Render Check Footer` › `Diff Status`: the score and region count of a scored result. */
  diff?: { score: ReactNode; regions: ReactNode };
  /** Bullets under the Diff Status values (what differs). */
  details?: readonly ReactNode[];
  /** Shown instead of the images when there is no result (not set up, building, requested, error). */
  message?: ReactNode;
  /** `Actions`: Check settings · Request check. */
  actions?: ReactNode;
  /** Under the footer: the settings form, an error. */
  children?: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

/**
 * Figma `Node Details - Render Check` (`Side by Side` · `Heatmap`): the header, underline tabs switching the designed and
 * implemented screenshots (differing regions outlined) or the heatmap, the score and regions, and the actions. Each image
 * opens in a lightbox.
 */
export function RenderCheck({
  status,
  meta,
  view,
  defaultView = 'side-by-side',
  onViewChange,
  designed,
  implemented,
  heatmap,
  regions = [],
  diff,
  details = [],
  message,
  actions,
  children,
  className,
  ref,
  ...rest
}: RenderCheckProps) {
  const titleId = useId();
  const hasImages = !!(designed || implemented || heatmap);
  return (
    <div ref={ref} role="group" aria-labelledby={titleId} {...rest} className={cx('flex flex-col gap-xl', className)}>
      <RenderCheckHeader id={titleId} status={<RenderCheckBadge status={status} />} meta={meta} />
      {hasImages && (
        <Tabs
          type="underline"
          size="md"
          fullWidth
          className="gap-xl"
          selectedKey={view}
          defaultSelectedKey={view ? undefined : defaultView}
          onSelectionChange={key => onViewChange?.(key as RenderCheckView)}
        >
          <Tabs.List aria-label="Render check view">
            <Tabs.Tab id="side-by-side">Side by side</Tabs.Tab>
            <Tabs.Tab id="heatmap">Heatmap</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel id="side-by-side" className="flex gap-xxs px-xl">
            {designed ? <Shot image={designed} alt="Designed" caption="Designed" /> : <Missing caption="Designed" />}
            {implemented ? (
              <Shot image={implemented} alt="Implemented" caption="Implemented" overlay={<Regions regions={regions} image={implemented} />} />
            ) : (
              <Missing caption="Implemented" />
            )}
          </Tabs.Panel>
          <Tabs.Panel id="heatmap" className="flex justify-center px-xl">
            {heatmap ? <Shot image={heatmap} alt="Heatmap" caption="Heatmap" /> : <Missing caption="Heatmap" />}
          </Tabs.Panel>
        </Tabs>
      )}
      {(message != null || diff != null || actions != null) && (
        <div className="flex flex-col gap-xl">
          {message != null && (
            <Text as="p" color="tertiary">
              {message}
            </Text>
          )}
          {diff != null && <DiffStatus score={diff.score} regions={diff.regions} details={details} />}
          {actions != null && <div className="flex flex-wrap items-center justify-end gap-lg px-3xl">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

function Missing({ caption }: { caption: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-sm">
      <div className="flex h-40 w-full items-center justify-center rounded-md border border-dashed border-secondary bg-secondary p-md text-center text-xs text-tertiary">
        No image
      </div>
      <span className="text-xs text-tertiary">{caption}</span>
    </div>
  );
}
