import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { Stack } from '.';

describe('Stack', () => {
  it('renders a column with no gap by default', () => {
    render(<Stack data-testid="s">a</Stack>);
    const el = screen.getByTestId('s');
    expect(el.tagName).toBe('DIV');
    expect(el.className).toBe('flex min-w-0 flex-col gap-none');
  });

  it.each(['xxs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl'] as const)('applies gap %s', gap => {
    render(<Stack data-testid="s" gap={gap} />);
    expect(screen.getByTestId('s').className).toContain(`gap-${gap}`);
  });

  it('applies alignment, element, className and ref', async () => {
    const ref = createRef<HTMLElement>();
    const { container } = render(
      <Stack as="ul" ref={ref} align="center" justify="between" className="gap-xl p-md" aria-label="list" gap="sm">
        <li>one</li>
      </Stack>,
    );
    const el = screen.getByRole('list', { name: 'list' });
    expect(ref.current).toBe(el);
    expect(el.className).toContain('items-center');
    expect(el.className).toContain('justify-between');
    expect(el.className).toContain('gap-xl');
    expect(el.className).not.toContain('gap-sm');
    expect(el.className).toContain('p-md');
    await expectNoAxeViolations(container);
  });
});
