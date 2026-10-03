import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from 'react-aria-components';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Tooltip, TooltipTrigger } from '.';

describe('Tooltip', () => {
  it('opens on focus with the design classes and closes on Escape', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <TooltipTrigger>
        <Button>Help</Button>
        <Tooltip className="max-w-60">This is a tooltip</Tooltip>
      </TooltipTrigger>,
    );
    expect(screen.queryByRole('tooltip')).toBeNull();
    await user.tab();
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip.textContent).toBe('This is a tooltip');
    for (const c of [
      'bg-primary-solid',
      'rounded-md',
      'px-lg',
      'py-md',
      'text-xs',
      'font-semibold',
      'text-white',
      'shadow-lg',
      'max-w-60',
    ]) {
      expect(tooltip.className).toContain(c);
    }
    expect(tooltip.className).not.toContain('max-w-80');
    expect(screen.getByRole('button', { name: 'Help' }).getAttribute('aria-describedby')).toBe(tooltip.id);
    await expectNoAxeViolations(container);
    await expectNoAxeViolations(tooltip);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('opens on hover after the delay', async () => {
    const user = userEvent.setup();
    render(
      <TooltipTrigger delay={0}>
        <Button>Help</Button>
        <Tooltip>Tip</Tooltip>
      </TooltipTrigger>,
    );
    await user.click(document.body);
    await act(() => user.hover(screen.getByRole('button')));
    expect((await screen.findByRole('tooltip')).textContent).toBe('Tip');
  });

  it('renders when controlled and forwards ref and DOM props', () => {
    let el: HTMLDivElement | null = null;
    render(
      <TooltipTrigger isOpen>
        <Button>Help</Button>
        <Tooltip ref={node => void (el = node)} data-testid="t">
          Tip
        </Tooltip>
      </TooltipTrigger>,
    );
    expect(el).toBe(screen.getByTestId('t'));
  });
});
