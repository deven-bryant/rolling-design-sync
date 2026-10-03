import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { VisuallyHidden } from '.';

describe('VisuallyHidden', () => {
  it('keeps content in the accessibility tree', async () => {
    const { container } = render(
      <button type="button">
        <span aria-hidden="true">×</span>
        <VisuallyHidden>Close</VisuallyHidden>
      </button>,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toBeDefined();
    expect(screen.getByText('Close').className).toBe('sr-only');
    await expectNoAxeViolations(container);
  });

  it('can reveal itself on focus, and forwards element, className and ref', () => {
    const ref = createRef<HTMLElement>();
    render(
      <VisuallyHidden as="div" focusable ref={ref} className="p-md" data-testid="v">
        <a href="#main">Skip to content</a>
      </VisuallyHidden>,
    );
    const el = screen.getByTestId('v');
    expect(ref.current).toBe(el);
    expect(el.tagName).toBe('DIV');
    expect(el.className).toBe('sr-only focus-within:not-sr-only focus:not-sr-only p-md');
  });
});
