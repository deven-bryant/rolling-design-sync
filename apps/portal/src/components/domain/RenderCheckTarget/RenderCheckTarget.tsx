import { useId, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { Badge } from '../../Badge';
import { Button } from '../../Button';
import { cx, Text } from '../../primitives';
import { Toggle } from '../../Toggle';
import { RenderCheckBadge, renderCheckLabels, type RenderCheckStatus } from '../RenderCheck';

/** The short status labels of lists and table cells (`Mismatch` rather than the drawer badge's `Render mismatch`). */
export const renderCheckShortLabel = (status: RenderCheckStatus) => (status === 'mismatch' ? 'Mismatch' : renderCheckLabels[status]);

/** A status as a small dot badge with its short label. */
export function RenderCheckStatusBadge({ status }: { status: RenderCheckStatus }) {
  return (
    <RenderCheckBadge status={status} size="sm" dot>
      {renderCheckShortLabel(status)}
    </RenderCheckBadge>
  );
}

export interface RenderCheckTargetDetail {
  label: string;
  value: ReactNode;
  /** Beside the value, right-aligned (the route's edit button). */
  action?: ReactNode;
}

export interface RenderCheckTargetDetailsProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'children'> {
  title?: ReactNode;
  /** `Excluded`: the toggle's state. */
  excluded: boolean;
  /** Changes the exclusion; without it the toggle is read-only. */
  onExcludedChange?: (excluded: boolean) => void;
  /** Leaves out the toggle (nodes that aren't targets). */
  hideExclude?: boolean;
  /** Source · Route · Variants · Theme. */
  details?: readonly RenderCheckTargetDetail[];
  /** Shown instead of the details (`Excluded=True`, or a node that isn't a target). */
  hint?: ReactNode;
  /** The hint's `Learn more` link. */
  learnMoreHref?: string;
  /** Under the details: the route form, an error. */
  footer?: ReactNode;
  headingLevel?: 'h3' | 'h4';
  ref?: Ref<HTMLDivElement>;
}

/**
 * Figma `Render Check Target Details`: the title and the *Exclude from checks* toggle, then the target's source,
 * route, variants and theme as a two-column list (`Excluded=False`) or a hint card (`Excluded=True`).
 */
export function RenderCheckTargetDetails({
  title = 'Render Check Target Details',
  excluded,
  onExcludedChange,
  hideExclude = false,
  details = [],
  hint,
  learnMoreHref,
  footer,
  headingLevel = 'h3',
  className,
  ref,
  ...rest
}: RenderCheckTargetDetailsProps) {
  const titleId = useId();
  return (
    <div ref={ref} role="group" aria-labelledby={titleId} {...rest} className={cx('flex flex-col gap-xxs', className)}>
      <div className="flex flex-wrap items-center justify-between gap-md">
        <Text as={headingLevel} id={titleId} size="md" weight="semibold" color="secondary">
          {title}
        </Text>
        {!hideExclude && (
          <Toggle size="sm" isSelected={excluded} isDisabled={!onExcludedChange} onChange={onExcludedChange} supportingText="Exclude from checks" />
        )}
      </div>
      {hint != null ? (
        <div className="pt-xl">
          <div className="flex items-center gap-md rounded-md border border-secondary px-xl py-lg">
            <Text as="p" color="tertiary" className="min-w-0 flex-1">
              {hint}
            </Text>
            {learnMoreHref && (
              <Button hierarchy="link-color" size="sm" href={learnMoreHref} target="_blank" rel="noreferrer">
                Learn more
              </Button>
            )}
          </div>
        </div>
      ) : (
        details.length > 0 && (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-md text-sm text-tertiary">
            {details.map(d => (
              <div key={d.label} className="contents">
                <dt className="whitespace-nowrap font-regular">{d.label}</dt>
                <dd className="flex min-w-0 items-center justify-between gap-md font-semibold">
                  <span className="min-w-0 break-words">{d.value}</span>
                  {d.action}
                </dd>
              </div>
            ))}
          </dl>
        )
      )}
      {footer}
    </div>
  );
}

export interface RenderCheckResult {
  id: string;
  status: RenderCheckStatus;
  /** `3.4% · 4b11b44`: score and commit. */
  summary: ReactNode;
  time: ReactNode;
  /** The result shown above (`Viewing`). */
  viewing?: boolean;
  /** The last pass, always kept (`Baseline`). */
  baseline?: boolean;
}

export interface RenderCheckHistoryProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'onSelect' | 'results'> {
  results: readonly RenderCheckResult[];
  /** Results kept per target (the file's `checkRetention`). */
  retention?: number;
  /** Shows a result above; without it the rows aren't buttons. */
  onSelect?: (id: string) => void;
  empty?: ReactNode;
  headingLevel?: 'h3' | 'h4';
  ref?: Ref<HTMLDivElement>;
}

/** Figma `Render Check History`: a target's retained results, latest first — the one being viewed and the baseline marked. */
export function RenderCheckHistory({
  results,
  retention = 5,
  onSelect,
  empty = 'No results yet.',
  headingLevel = 'h3',
  className,
  ref,
  ...rest
}: RenderCheckHistoryProps) {
  const titleId = useId();
  return (
    <div ref={ref} role="group" aria-labelledby={titleId} {...rest} className={cx('flex flex-col gap-md', className)}>
      <Text as={headingLevel} id={titleId} size="md" weight="semibold" color="secondary">
        History
      </Text>
      <Text as="p" color="tertiary">
        Last {retention} results · the last pass is always kept as the baseline
      </Text>
      {results.length === 0 ? (
        <Text as="p" color="tertiary">
          {empty}
        </Text>
      ) : (
        <ul className="flex flex-col gap-xxs">
          {results.map(result => {
            const content = (
              <>
                <RenderCheckStatusBadge status={result.status} />
                <span className="min-w-0 flex-1 truncate text-left">{result.summary}</span>
                {result.viewing && <span>Viewing</span>}
                {result.baseline && (
                  <Badge type="badge-modern" size="sm">
                    Baseline
                  </Badge>
                )}
                <span className="whitespace-nowrap">{result.time}</span>
              </>
            );
            const rowClass = cx(
              'flex w-full items-center gap-lg rounded-md px-lg py-md text-sm text-tertiary',
              result.viewing && 'bg-secondary',
            );
            return (
              <li key={result.id} aria-current={result.viewing || undefined}>
                {onSelect && !result.viewing ? (
                  <AriaButton
                    className={cx(rowClass, 'cursor-pointer outline-focus-ring data-hovered:bg-primary_hover data-focus-visible:outline-2')}
                    onPress={() => onSelect(result.id)}
                  >
                    {content}
                  </AriaButton>
                ) : (
                  <div className={rowClass}>{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export interface ContainingTarget {
  id: string;
  name: ReactNode;
  /** `Screen · checked 2h ago`. */
  meta?: ReactNode;
  status: RenderCheckStatus;
}

export interface RenderChecksContainingProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  targets: readonly ContainingTarget[];
  /** *Open*: opens the target. */
  onOpen?: (id: string) => void;
  headingLevel?: 'h3' | 'h4';
  ref?: Ref<HTMLDivElement>;
}

/** Figma `Render Checks Containing Mismatch Targets`: the render checks that include a node, each with its status and *Open*. */
export function RenderChecksContaining({ targets, onOpen, headingLevel = 'h3', className, ref, ...rest }: RenderChecksContainingProps) {
  const titleId = useId();
  return (
    <div ref={ref} role="group" aria-labelledby={titleId} {...rest} className={cx('flex flex-col gap-md', className)}>
      <Text as={headingLevel} id={titleId} size="md" weight="semibold" color="secondary">
        Render checks
      </Text>
      <Text as="p" color="tertiary">
        Checks that include this node
      </Text>
      <ul className="flex flex-col">
        {targets.map(target => (
          <li key={target.id} className="flex items-center gap-lg border-b border-secondary py-2.5 text-sm text-tertiary">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="break-words font-semibold">{target.name}</span>
              {target.meta != null && <span>{target.meta}</span>}
            </div>
            <RenderCheckStatusBadge status={target.status} />
            {onOpen && (
              <Button hierarchy="link-color" size="sm" onPress={() => onOpen(target.id)} aria-label={`Open ${typeof target.name === 'string' ? target.name : 'target'}`}>
                Open
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface HeatmapCropProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  src: string;
  /** The full image's size, in the region's units (px). */
  width: number;
  height: number;
  /** The part to show; the whole image without it. */
  region?: { x: number; y: number; width: number; height: number };
  caption?: ReactNode;
  alt: string;
  ref?: Ref<HTMLElement>;
}

const CROP_BOX = 124;

/** A square crop of a render check's heatmap around a region, with its caption (`Cropped from the heatmap`). */
export function HeatmapCrop({ src, width, height, region, caption = 'Cropped from the heatmap', alt, className, ref, ...rest }: HeatmapCropProps) {
  const r = region ?? { x: 0, y: 0, width, height };
  const side = Math.max(r.width, r.height, 1);
  const scale = CROP_BOX / side;
  const left = -(r.x + r.width / 2 - side / 2) * scale;
  const top = -(r.y + r.height / 2 - side / 2) * scale;
  return (
    <figure ref={ref} {...rest} className={cx('flex flex-col items-end gap-md', className)}>
      <div className="relative size-31 overflow-hidden rounded-md border border-secondary bg-checkerboard">
        <img
          src={src}
          alt={alt}
          className="absolute max-w-none"
          style={{ left, top, width: width * scale, height: height * scale }}
        />
      </div>
      {caption != null && (
        <figcaption className="text-xs text-tertiary">{caption}</figcaption>
      )}
    </figure>
  );
}
