import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { applyTheme, darkSchemeQuery, readSavedTheme, saveTheme, systemTheme, type Theme } from './theme';

export interface ThemeContextValue {
  /** The theme in effect. */
  theme: Theme;
  /** The saved choice; `null` while the portal follows the OS. */
  choice: Theme | null;
  /** Saves the choice (in memory only if storage is unavailable) and applies it. */
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Light/dark theme state: the saved choice (`localStorage['rds-theme']`) wins; without one
 * the theme follows `prefers-color-scheme`, live. Applies `data-theme` on `<html>`.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<Theme | null>(readSavedTheme);
  const [system, setSystem] = useState<Theme>(systemTheme);
  const theme = choice ?? system;

  useEffect(() => {
    const query = darkSchemeQuery();
    if (!query) return;
    const onChange = () => setSystem(query.matches ? 'dark' : 'light');
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    saveTheme(next);
    setChoice(next);
  }, []);

  const value = useMemo(() => ({ theme, choice, setTheme }), [theme, choice, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The current theme and its setter; must be used inside `ThemeProvider`. */
export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside <ThemeProvider>');
  return value;
}
