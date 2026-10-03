import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { CategoryBadges } from '.';

const classesOf = (el: Element | null) => el?.getAttribute('class')?.split(' ') ?? [];

describe('CategoryBadges', () => {
  it('shows every category as a gray-blue badge by default', async () => {
    const { container } = render(<CategoryBadges categories={['color', 'layout']} />);
    for (const category of ['color', 'layout']) {
      expect(classesOf(screen.getByText(category))).toContain('bg-utility-gray-blue-50');
    }
    expect(screen.queryByText(/^\+/)).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('folds the overflow into a gray +N badge naming the hidden ones', () => {
    render(<CategoryBadges categories={['color', 'layout', 'typography', 'effects']} max={2} />);
    expect(screen.queryByText('typography')).toBeNull();
    const overflow = screen.getByText('+2');
    expect(classesOf(overflow)).toContain('bg-utility-gray-50');
    expect(overflow.getAttribute('title')).toBe('typography, effects');
  });

  it('renders nothing but the container for no categories', () => {
    const { container } = render(<CategoryBadges categories={[]} />);
    expect(container.firstElementChild?.children).toHaveLength(0);
  });
});
