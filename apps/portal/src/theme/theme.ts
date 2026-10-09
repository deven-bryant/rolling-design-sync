export type Theme = 'light' | 'dark';

/** The `localStorage` key holding the user's saved choice. `index.html`'s no-flash script reads it too. */
export const THEME_STORAGE_KEY = 'rds-theme';

export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

export const isTheme = (value: unknown): value is Theme => value === 'light' || value === 'dark';

/** The saved choice, or `null` when there is none or storage is unavailable. */
export function readSavedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

/** Saves the choice; returns `false` when storage is unavailable (private mode, quota, disabled). */
export function saveTheme(theme: Theme): boolean {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    return true;
  } catch {
    return false;
  }
}

/** The OS color-scheme query, or `null` where `matchMedia` doesn't exist. */
export function darkSchemeQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(DARK_SCHEME_QUERY) : null;
}

export const systemTheme = (): Theme => (darkSchemeQuery()?.matches ? 'dark' : 'light');

/** Sets `data-theme` on `<html>`; `tokens.css` keys both modes off it. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
