import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { ChangeBadge } from '.';

const classesOf = (el: Element | null) => el?.getAttribute('class')?.split(' ') ?? [];

describe('ChangeBadge', () => {
  it.each([
    ['added', 'Added', 'blue'],
    ['modified', 'Modified', 'brand'],
    ['deleted', 'Deleted', 'gray'],
  ] as const)('%s → %s in %s', async (change, label, color) => {
    const { container } = render(<ChangeBadge change={change} />);
    expect(classesOf(screen.getByText(label))).toEqual(
      expect.arrayContaining([`bg-utility-${color}-50`, `text-utility-${color}-700`, `ring-utility-${color}-200`]),
    );
    await expectNoAxeViolations(container);
  });
});
