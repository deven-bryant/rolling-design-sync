import { useEffect, useEffectEvent, useRef, type AnimationEvent } from 'react';
import { Avatar, type AvatarProps } from '../../Avatar';
import { cx } from '../../primitives';
import './AgentSprite.css';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

export type AgentSpriteState = 'enter' | 'idle' | 'poof' | 'fade';

/** Utility palette the sprite colors are drawn from (50 background, 700 text, 200 ring). */
export const agentSpritePalette = {
  brand: 'bg-utility-brand-50 text-utility-brand-700 ring-utility-brand-200',
  blue: 'bg-utility-blue-50 text-utility-blue-700 ring-utility-blue-200',
  'blue-light': 'bg-utility-blue-light-50 text-utility-blue-light-700 ring-utility-blue-light-200',
  'blue-dark': 'bg-utility-blue-dark-50 text-utility-blue-dark-700 ring-utility-blue-dark-200',
  indigo: 'bg-utility-indigo-50 text-utility-indigo-700 ring-utility-indigo-200',
  purple: 'bg-utility-purple-50 text-utility-purple-700 ring-utility-purple-200',
  fuchsia: 'bg-utility-fuchsia-50 text-utility-fuchsia-700 ring-utility-fuchsia-200',
  pink: 'bg-utility-pink-50 text-utility-pink-700 ring-utility-pink-200',
  error: 'bg-utility-error-50 text-utility-error-700 ring-utility-error-200',
  'orange-dark': 'bg-utility-orange-dark-50 text-utility-orange-dark-700 ring-utility-orange-dark-200',
  orange: 'bg-utility-orange-50 text-utility-orange-700 ring-utility-orange-200',
  yellow: 'bg-utility-yellow-50 text-utility-yellow-700 ring-utility-yellow-200',
  green: 'bg-utility-green-50 text-utility-green-700 ring-utility-green-200',
  'gray-blue': 'bg-utility-gray-blue-50 text-utility-gray-blue-700 ring-utility-gray-blue-200',
} as const;

export type AgentSpriteColor = keyof typeof agentSpritePalette;

const paletteNames = Object.keys(agentSpritePalette) as AgentSpriteColor[];

/** Milliseconds each one-shot state animates for. */
export const agentSpriteDurations = { enter: 300, poof: 400, fade: 600 } as const;

const stateStyles: Record<AgentSpriteState, string> = {
  enter: 'motion-safe:animate-[agent-sprite-enter_300ms_ease-out_both]',
  idle: 'motion-safe:animate-[agent-sprite-idle_2400ms_ease-in-out_infinite]',
  poof: 'motion-safe:animate-[agent-sprite-poof_400ms_ease-in_both] motion-reduce:opacity-0',
  fade: 'motion-safe:animate-[agent-sprite-fade_600ms_ease-out_both] motion-reduce:opacity-0',
};

/** Up to two initials: the first letters of the first two words (`claude-local` → `CL`), or a single word's first two. */
export function agentInitials(worker: string): string {
  const [first, second] = worker.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (first == null) return '?';
  return (second == null ? first.slice(0, 2) : first.charAt(0) + second.charAt(0)).toUpperCase();
}

/** A stable palette color for a worker name (FNV-1a hash). */
export function agentColor(worker: string): AgentSpriteColor {
  let hash = 0x811c9dc5;
  for (const char of worker) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return paletteNames[(hash >>> 0) % paletteNames.length] ?? 'brand';
}

export interface AgentSpriteProps extends Omit<AvatarProps, 'alt' | 'initials' | 'src' | 'placeholder' | 'onAnimationEnd'> {
  /** Accessible name; defaults to `worker`. */
  alt?: string;
  /** The worker id; drives the initials and color. */
  worker: string;
  /** `enter` pops in, `idle` bobs while the lease runs, `poof` bursts away on clear, `fade` fades on expiry. */
  state?: AgentSpriteState;
  /** Called once when a one-shot state (`enter`, `poof`, `fade`) finishes — immediately under reduced motion. */
  onAnimationEnd?: (state: AgentSpriteState) => void;
}

/** An agent's avatar: deterministic initials and color from its worker name, animated through its lifecycle. */
export function AgentSprite({ worker, state = 'idle', onAnimationEnd, size = 'sm', alt, className, ...rest }: AgentSpriteProps) {
  const reducedMotion = usePrefersReducedMotion();
  const done = useRef(false);

  const complete = () => {
    if (done.current || state === 'idle') return;
    done.current = true;
    onAnimationEnd?.(state);
  };
  const completeFromTimer = useEffectEvent(complete);

  useEffect(() => {
    done.current = false;
  }, [state]);

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(completeFromTimer, reducedMotion ? 0 : agentSpriteDurations[state]);
    return () => clearTimeout(timer);
  }, [state, reducedMotion]);

  const handleAnimationEnd = (event: AnimationEvent<HTMLSpanElement>) => {
    if (event.target === event.currentTarget) complete();
  };

  return (
    <Avatar
      {...rest}
      size={size}
      alt={alt ?? worker}
      initials={agentInitials(worker)}
      data-state={state}
      onAnimationEnd={handleAnimationEnd}
      className={cx(agentSpritePalette[agentColor(worker)], stateStyles[state], className)}
    />
  );
}
