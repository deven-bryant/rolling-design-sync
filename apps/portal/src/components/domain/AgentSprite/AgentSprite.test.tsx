import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { AgentSprite, agentColor, agentInitials, agentSpriteDurations, agentSpritePalette, type AgentSpriteState } from '.';

const classesOf = (el: Element | null) => el?.getAttribute('class')?.split(' ') ?? [];

function mockReducedMotion(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('agentInitials', () => {
  it.each([
    ['claude-local', 'CL'],
    ['devin-7f3a', 'D7'],
    ['control', 'CO'],
    ['portal:viewer', 'PV'],
    ['--', '?'],
  ])('%s → %s', (worker, initials) => {
    expect(agentInitials(worker)).toBe(initials);
  });
});

describe('agentColor', () => {
  it('is deterministic and drawn from the utility palette', () => {
    for (const worker of ['claude-local', 'devin-7f3a', 'devin-a1b2', 'control']) {
      expect(agentColor(worker)).toBe(agentColor(worker));
      expect(Object.keys(agentSpritePalette)).toContain(agentColor(worker));
    }
    const colors = new Set(Array.from({ length: 40 }, (_, i) => agentColor(`devin-${i}`)));
    expect(colors.size).toBeGreaterThan(5);
  });
});

describe('AgentSprite', () => {
  it('renders a size-sm avatar with initials, a palette color and the worker as its name', async () => {
    const { container } = render(<AgentSprite worker="claude-local" />);
    const sprite = screen.getByRole('img', { name: 'claude-local' });
    expect(sprite.textContent).toBe('CL');
    const color = agentColor('claude-local');
    expect(classesOf(sprite)).toEqual(expect.arrayContaining(['size-8', ...agentSpritePalette[color].split(' ')]));
    expect(classesOf(sprite)).not.toContain('bg-tertiary');
    expect(classesOf(sprite)).not.toContain('text-quaternary');
    await expectNoAxeViolations(container);
  });

  it.each(['enter', 'idle', 'poof', 'fade'] as const)('animates %s only when motion is allowed', state => {
    render(<AgentSprite worker="devin" state={state} />);
    const sprite = screen.getByRole('img');
    expect(sprite.dataset.state).toBe(state);
    const animations = classesOf(sprite).filter(c => c.includes('animate-'));
    expect(animations).toEqual([expect.stringMatching(new RegExp(`^motion-safe:animate-\\[agent-sprite-${state}_`))]);
  });

  it('walks enter → idle → poof with fake timers, reporting each one-shot state once', () => {
    vi.useFakeTimers();
    const ended: AgentSpriteState[] = [];
    const { rerender } = render(<AgentSprite worker="devin" state="enter" onAnimationEnd={s => ended.push(s)} />);
    act(() => vi.advanceTimersByTime(agentSpriteDurations.enter - 1));
    expect(ended).toEqual([]);
    act(() => vi.advanceTimersByTime(1));
    expect(ended).toEqual(['enter']);

    rerender(<AgentSprite worker="devin" state="idle" onAnimationEnd={s => ended.push(s)} />);
    act(() => vi.advanceTimersByTime(10_000));
    expect(ended).toEqual(['enter']);

    rerender(<AgentSprite worker="devin" state="poof" onAnimationEnd={s => ended.push(s)} />);
    fireEvent.animationEnd(screen.getByRole('img'));
    act(() => vi.advanceTimersByTime(agentSpriteDurations.poof));
    expect(ended).toEqual(['enter', 'poof']);
  });

  it('fades out on expiry', () => {
    vi.useFakeTimers();
    const onAnimationEnd = vi.fn();
    render(<AgentSprite worker="devin" state="fade" onAnimationEnd={onAnimationEnd} />);
    act(() => vi.advanceTimersByTime(agentSpriteDurations.fade));
    expect(onAnimationEnd).toHaveBeenCalledExactlyOnceWith('fade');
  });

  it('under reduced motion skips the animation and ends one-shot states immediately', () => {
    mockReducedMotion(true);
    vi.useFakeTimers();
    const onAnimationEnd = vi.fn();
    render(<AgentSprite worker="devin" state="poof" onAnimationEnd={onAnimationEnd} />);
    act(() => vi.advanceTimersByTime(0));
    expect(onAnimationEnd).toHaveBeenCalledExactlyOnceWith('poof');
    expect(classesOf(screen.getByRole('img'))).toContain('motion-reduce:opacity-0');
  });
});
