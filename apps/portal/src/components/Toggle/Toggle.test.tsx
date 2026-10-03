import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Toggle, ToggleBase } from '.';

const track = (container: Element) => container.querySelector('[aria-hidden="true"]');
const classesOf = (el: Element | null | undefined) => (el?.getAttribute('class') ?? '').split(' ');

describe('ToggleBase', () => {
  it('draws Pressed=True, Size=sm as the 36×20 brand track with the thumb at the end', () => {
    const { container } = render(<ToggleBase pressed size="sm" />);
    const t = track(container);
    expect(classesOf(t)).toEqual(expect.arrayContaining(['h-5', 'w-9', 'rounded-full', 'p-xxs', 'bg-brand-solid']));
    expect(classesOf(t?.firstElementChild)).toEqual(
      expect.arrayContaining(['size-4', 'rounded-full', 'bg-fg-white', 'shadow-sm', 'translate-x-4']),
    );
  });

  it('draws Pressed=False with the thumb at the start', () => {
    const { container } = render(<ToggleBase />);
    expect(classesOf(track(container))).toContain('bg-tertiary');
    expect(classesOf(track(container)?.firstElementChild)).toContain('translate-x-0');
  });

  it('forwards ref and merges className', () => {
    const ref = createRef<HTMLSpanElement>();
    const { container } = render(<ToggleBase ref={ref} className="ml-xs" />);
    expect(ref.current).toBe(track(container));
    expect(classesOf(track(container))).toContain('ml-xs');
  });
});

describe('Toggle', () => {
  it('switches with Space and click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Toggle onChange={onChange}>Auto-clear</Toggle>);
    const sw = screen.getByRole('switch', { name: 'Auto-clear' }) as HTMLInputElement;
    await user.tab();
    expect(document.activeElement).toBe(sw);
    await user.keyboard(' ');
    expect(sw.checked).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByText('Auto-clear'));
    expect(sw.checked).toBe(false);
  });

  it('shows the focus ring only for keyboard focus', async () => {
    const user = userEvent.setup();
    const { container } = render(<Toggle aria-label="Live updates" />);
    await user.click(screen.getByRole('switch'));
    expect(classesOf(track(container))).not.toContain('outline-focus-ring');
    await user.tab();
    await user.tab({ shift: true });
    expect(classesOf(track(container))).toContain('outline-focus-ring');
  });

  it('renders text and supporting text in the design tokens', () => {
    render(
      <Toggle defaultSelected supportingText="Clear nodes once CI is green.">
        Auto-clear
      </Toggle>,
    );
    expect(classesOf(screen.getByText('Auto-clear'))).toEqual(expect.arrayContaining(['text-sm', 'font-medium', 'text-secondary']));
    expect(classesOf(screen.getByText('Clear nodes once CI is green.'))).toEqual(
      expect.arrayContaining(['text-sm', 'font-regular', 'text-tertiary']),
    );
    expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(true);
  });

  it('supports controlled use and does not switch when disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { unmount } = render(<Toggle aria-label="Live" isSelected={false} onChange={onChange} />);
    await user.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(false);
    unmount();
    const { container } = render(<Toggle aria-label="Locked" isDisabled />);
    await user.click(screen.getByRole('switch'));
    expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(false);
    expect(classesOf(track(container))).toContain('bg-disabled');
  });

  it('forwards ref and className to the label root', () => {
    const ref = createRef<HTMLLabelElement>();
    render(<Toggle ref={ref} className="w-full" aria-label="Live" />);
    expect(ref.current?.tagName).toBe('LABEL');
    expect(ref.current?.className).toContain('w-full');
    expect(Toggle.Base).toBe(ToggleBase);
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <div>
        <Toggle defaultSelected supportingText="Supporting">
          Label
        </Toggle>
        <Toggle aria-label="No text" />
      </div>,
    );
    await expectNoAxeViolations(container);
  });
});
