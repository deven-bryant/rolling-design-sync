import type { Ref, SVGProps } from 'react';
import { variants, type VariantProps } from '../variants';
import { figmaIcons, type FigmaIcon, type IconName } from './figma';

export const iconStyles = variants({
  base: 'shrink-0',
  variants: {
    size: { xs: 'size-3', sm: 'size-4', md: 'size-5', lg: 'size-6' },
  },
  defaults: { size: 'lg' },
});

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'ref' | 'name'>, VariantProps<typeof iconStyles> {
  /** The Figma icon name, e.g. `arrow-right`. */
  name: IconName;
  /** Accessible name. Without it the icon is decorative and hidden from assistive tech. */
  label?: string;
  ref?: Ref<SVGSVGElement>;
}

/** An icon from the design file, drawn in `currentColor` with the design's 2px stroke on a 24px grid. */
export function Icon({ name, size, label, className, ref, ...rest }: IconProps) {
  const icon: FigmaIcon = figmaIcons[name];
  const Glyph = icon.component;
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const };
  return (
    <Glyph
      ref={ref}
      strokeWidth={2}
      data-icon={name}
      {...a11y}
      {...rest}
      className={iconStyles({ size, className: [icon.className, className].filter(Boolean).join(' ') || undefined })}
    />
  );
}
