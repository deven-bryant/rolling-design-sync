import gallery from './StateBadge.gallery';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { StateBadge } from '.';

const classesOf = (el: Element | null) => el?.getAttribute('class')?.split(' ') ?? [];

describe('StateBadge', () => {
  it.each([
    ['dirty', 'Dirty', 'warning'],
    ['clean', 'Clean', 'success'],
    ['blocked', 'Blocked', 'error'],
  ] as const)('%s → %s in %s', async (state, label, color) => {
    const { container } = render(<StateBadge state={state} />);
    const badge = screen.getByText(label);
    expect(classesOf(badge)).toEqual(
      expect.arrayContaining([`bg-utility-${color}-50`, `text-utility-${color}-700`, `ring-utility-${color}-200`, 'rounded-full']),
    );
    expect(badge.querySelector('[data-slot]')).not.toBeNull();
    await expectNoAxeViolations(container);
  });

  it('accepts a custom label', () => {
    render(<StateBadge state="blocked">Blocked by devin</StateBadge>);
    expect(screen.getByText('Blocked by devin')).toBeTruthy();
  });
});

describe('StateBadge under the dark theme', () => {
  it('renders its gallery examples with no axe violations', async () => {
    const dark = gallery.examples.filter(e => e.figma.endsWith('Color Mode=Dark'));
    expect(dark.length).toBeGreaterThan(0);
    const { container } = render(<div>{dark.map(e => <section key={e.figma} aria-label={e.figma}>{e.render()}</section>)}</div>);
    expect(container.querySelectorAll('[data-theme="dark"]')).toHaveLength(dark.length);
    await expectNoAxeViolations(container);
  });
});
