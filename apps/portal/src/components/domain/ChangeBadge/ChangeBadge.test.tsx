import gallery from './ChangeBadge.gallery';
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

describe('ChangeBadge under the dark theme', () => {
  it('renders its gallery examples with no axe violations', async () => {
    const dark = gallery.examples.filter(e => e.figma.endsWith('Color Mode=Dark'));
    expect(dark.length).toBeGreaterThan(0);
    const { container } = render(<div>{dark.map(e => <section key={e.figma} aria-label={e.figma}>{e.render()}</section>)}</div>);
    expect(container.querySelectorAll('[data-theme="dark"]')).toHaveLength(dark.length);
    await expectNoAxeViolations(container);
  });
});
