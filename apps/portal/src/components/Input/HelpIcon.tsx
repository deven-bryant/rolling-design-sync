import { cx, Icon, type IconProps } from '../primitives';

export interface HelpIconProps extends Omit<IconProps, 'name' | 'size' | 'label'> {
  /** The help copy, announced as the icon's accessible name. */
  label: string;
}

/** The `Help icon` beside a field label or inside a field: a 16px `help-circle` in `fg-quaternary`. */
export function HelpIcon({ label, className, ...rest }: HelpIconProps) {
  return <Icon name="help-circle" size="sm" label={label} {...rest} className={cx('text-fg-quaternary', className)} />;
}
