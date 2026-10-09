import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY } from './theme';
import { ThemeProvider, useTheme } from './ThemeProvider';

/** A controllable `prefers-color-scheme: dark` media query. */
function mockColorScheme(dark: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: dark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal('matchMedia', vi.fn(() => query));
  return {
    set(next: boolean) {
      query.matches = next;
      act(() => listeners.forEach(fn => fn()));
    },
    listeners,
  };
}

function Probe() {
  const { theme, choice, setTheme } = useTheme();
  return (
    <div>
      <output aria-label="theme">{theme}</output>
      <output aria-label="choice">{choice ?? 'none'}</output>
      <button type="button" onClick={() => setTheme('dark')}>Dark</button>
      <button type="button" onClick={() => setTheme('light')}>Light</button>
    </div>
  );
}

const renderProbe = () =>
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );

const shown = (label: string) => screen.getByLabelText(label).textContent;

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('follows the OS when nothing is saved', () => {
    mockColorScheme(true);
    renderProbe();
    expect(shown('theme')).toBe('dark');
    expect(shown('choice')).toBe('none');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('defaults to light without matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);
    renderProbe();
    expect(shown('theme')).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('lets a saved choice win over the OS', () => {
    mockColorScheme(true);
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    renderProbe();
    expect(shown('theme')).toBe('light');
    expect(shown('choice')).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('ignores an invalid saved value', () => {
    mockColorScheme(true);
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    renderProbe();
    expect(shown('theme')).toBe('dark');
    expect(shown('choice')).toBe('none');
  });

  it('follows OS changes live while nothing is saved', () => {
    const scheme = mockColorScheme(false);
    renderProbe();
    expect(shown('theme')).toBe('light');
    scheme.set(true);
    expect(shown('theme')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    scheme.set(false);
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('stops following the OS once a choice is saved', async () => {
    const scheme = mockColorScheme(false);
    renderProbe();
    await userEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(shown('choice')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    scheme.set(true);
    scheme.set(false);
    expect(shown('theme')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('removes its OS listener on unmount', () => {
    const scheme = mockColorScheme(false);
    const { unmount } = renderProbe();
    expect(scheme.listeners.size).toBe(1);
    unmount();
    expect(scheme.listeners.size).toBe(0);
  });

  it('keeps the choice in memory when storage throws', async () => {
    mockColorScheme(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    renderProbe();
    expect(shown('theme')).toBe('light');
    await userEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(shown('theme')).toBe('dark');
    expect(shown('choice')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('throws when useTheme is used outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/ThemeProvider/);
  });
});
