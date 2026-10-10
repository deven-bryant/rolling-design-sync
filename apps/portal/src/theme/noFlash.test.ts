import { afterEach, describe, expect, it, vi } from 'vitest';
import html from '../../index.html?raw';
import { THEME_STORAGE_KEY } from './theme';

/** The inline script in `index.html`'s `<head>` that sets `data-theme` before first paint. */
const script = (() => {
  const head = html.slice(0, html.indexOf('</head>'));
  const match = /<script>([\s\S]*?)<\/script>/.exec(head);
  if (!match) throw new Error('index.html has no inline <head> script');
  return match[1]!;
})();

const run = () => new Function(script)();

function stubColorScheme(dark: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: dark && query === '(prefers-color-scheme: dark)' }));
}

describe('index.html no-flash script', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('runs before the app module', () => {
    expect(html.indexOf(script)).toBeLessThan(html.indexOf('</head>'));
    expect(html.indexOf(script)).toBeLessThan(html.indexOf('src="/src/main.tsx"'));
  });

  it.each([
    [false, 'light'],
    [true, 'dark'],
  ] as const)('follows the OS when nothing is saved (dark OS: %s)', (dark, expected) => {
    stubColorScheme(dark);
    run();
    expect(document.documentElement.dataset.theme).toBe(expected);
  });

  it('applies the saved choice over the OS', () => {
    stubColorScheme(true);
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    run();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('ignores an invalid saved value', () => {
    stubColorScheme(true);
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    run();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('falls back to the OS when storage throws, and to light without matchMedia', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    stubColorScheme(true);
    run();
    expect(document.documentElement.dataset.theme).toBe('dark');
    vi.stubGlobal('matchMedia', undefined);
    run();
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
