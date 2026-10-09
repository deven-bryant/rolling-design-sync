import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { describeGalleryInThemes, themes, withDocumentTheme } from '../../test/theme';
import { ThemeToggle } from '.';
import gallery from './ThemeToggle.gallery';

const icon = (container: Element) => container.querySelector('svg[data-icon]');
const darkMode = () => screen.getByRole('switch', { name: 'Dark mode' }) as HTMLInputElement;

describe.each(themes)('ThemeToggle (%s document theme)', documentTheme => {
  withDocumentTheme(documentTheme);

  it('State=Light: shows the moon and an unchecked "Dark mode" switch', async () => {
    const { container } = render(<ThemeToggle theme="light" onChange={() => {}} />);
    expect(darkMode().checked).toBe(false);
    expect(screen.getByRole('switch', { name: 'Dark mode', checked: false })).toBe(darkMode());
    expect(icon(container)?.getAttribute('data-icon')).toBe('moon-01');
    expect(icon(container)?.getAttribute('aria-hidden')).toBe('true');
    await expectNoAxeViolations(container);
  });

  it('State=Dark: shows the sun and a checked switch', async () => {
    const { container } = render(<ThemeToggle theme="dark" onChange={() => {}} />);
    expect(darkMode().checked).toBe(true);
    expect(screen.getByRole('switch', { name: 'Dark mode', checked: true })).toBe(darkMode());
    expect(icon(container)?.getAttribute('data-icon')).toBe('sun');
    await expectNoAxeViolations(container);
  });
});

describe('ThemeToggle', () => {
  it('draws the design: 24px fg-tertiary icon, spacing-xs gap, md toggle', () => {
    const { container } = render(<ThemeToggle theme="light" onChange={() => {}} />);
    expect(container.firstElementChild?.className.split(' ')).toEqual(
      expect.arrayContaining(['flex', 'items-center', 'gap-xs', 'bg-primary']),
    );
    expect(icon(container)?.getAttribute('class')?.split(' ')).toEqual(expect.arrayContaining(['size-6', 'text-fg-tertiary']));
    expect(container.querySelector('span[aria-hidden="true"]')?.className.split(' ')).toEqual(
      expect.arrayContaining(['h-6', 'w-11']),
    );
  });

  it('toggles with the keyboard and reports the new theme', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<ThemeToggle theme="light" onChange={onChange} />);
    await user.tab();
    expect(document.activeElement).toBe(darkMode());
    await user.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith('dark');
    rerender(<ThemeToggle theme="dark" onChange={onChange} />);
    await user.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith('light');
  });

  it('is controlled by `theme` and switches on click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ThemeToggle theme="light" onChange={onChange} />);
    await user.click(darkMode());
    expect(onChange).toHaveBeenCalledWith('dark');
    expect(darkMode().checked).toBe(false);
  });

  it('forwards ref, className and DOM props', () => {
    const ref = createRef<HTMLDivElement>();
    render(<ThemeToggle ref={ref} theme="light" onChange={() => {}} className="ml-auto" data-testid="tt" />);
    expect(ref.current).toBe(screen.getByTestId('tt'));
    expect(ref.current?.className).toContain('ml-auto');
  });
});

describeGalleryInThemes(gallery);
