import type { HTMLAttributes, Ref } from 'react';
import { cx, Icon } from '../primitives';
import { Toggle } from '../Toggle';

export type ThemeToggleTheme = 'light' | 'dark';

export interface ThemeToggleProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  /** The theme in effect; Figma `State`. */
  theme: ThemeToggleTheme;
  /** Called with the theme the user switched to. */
  onChange: (theme: ThemeToggleTheme) => void;
  ref?: Ref<HTMLDivElement>;
}

/** Figma `Color Mode Toggle`: the theme in effect's icon, sun (light) or moon (dark), beside a "Dark mode" switch. */
export function ThemeToggle({ theme, onChange, className, ref, ...rest }: ThemeToggleProps) {
  const dark = theme === 'dark';
  return (
    <div ref={ref} {...rest} className={cx('flex items-center gap-xs bg-primary', className)}>
      <Icon name={dark ? 'moon-01' : 'sun'} className="text-fg-tertiary" />
      <Toggle size="md" aria-label="Dark mode" isSelected={dark} onChange={on => onChange(on ? 'dark' : 'light')} />
    </div>
  );
}
