import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import gallery from './VerticalDivider.gallery';
import { VerticalDivider } from '.';

describe('VerticalDivider', () => {
  it('is a decorative 20px border-primary rule', async () => {
    const { container } = render(<VerticalDivider data-testid="d" />);
    const rule = container.firstElementChild as HTMLElement;
    expect(rule.getAttribute('aria-hidden')).toBe('true');
    expect(rule.className.split(' ')).toEqual(expect.arrayContaining(['h-5', 'w-px', 'border-l', 'border-primary']));
    await expectNoAxeViolations(container);
  });

  it('renders its gallery in both themes with no axe violations', async () => {
    const { container } = render(<div>{gallery.examples.map(e => <section key={e.figma} aria-label={e.figma}>{e.render()}</section>)}</div>);
    await expectNoAxeViolations(container);
  });
});
