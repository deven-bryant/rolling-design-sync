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
