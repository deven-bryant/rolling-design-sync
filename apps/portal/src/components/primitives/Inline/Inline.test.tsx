import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { Inline } from '.';

describe('Inline', () => {
  it('renders a centered row by default', () => {
    render(<Inline data-testid="i">a</Inline>);
    expect(screen.getByTestId('i').className).toBe('flex min-w-0 flex-row gap-none items-center');
  });

  it('applies gap, wrap, alignment, element, className and ref', async () => {
    const ref = createRef<HTMLElement>();
    const { container } = render(
      <Inline as="nav" ref={ref} gap="lg" wrap align="baseline" justify="end" className="px-xl" aria-label="Tabs">
        <a href="#a">A</a>
      </Inline>,
    );
    const el = screen.getByRole('navigation', { name: 'Tabs' });
    expect(ref.current).toBe(el);
    for (const cls of ['gap-lg', 'flex-wrap', 'items-baseline', 'justify-end', 'px-xl']) expect(el.className).toContain(cls);
    await expectNoAxeViolations(container);
  });
});
