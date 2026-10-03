import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { Icon, variants, type VariantProps } from '../primitives';

export const featuredIconStyles = variants({
  base: 'relative flex shrink-0 items-center justify-center',
  variants: {
    size: { md: 'size-10 rounded-md *:size-5' },
    color: { gray: 'text-fg-secondary' },
    type: { modern: 'bg-primary shadow-xs ring-1 ring-primary ring-inset' },
  },
  defaults: { size: 'md', color: 'gray', type: 'modern' },
});

export interface FeaturedIconProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'color'>, VariantProps<typeof featuredIconStyles> {
  /** Figma `🔀 Icon swap` (`check-circle` by default). Decorative. */
  icon?: ReactNode;
  ref?: Ref<HTMLSpanElement>;
}

/** Figma `Featured icon` (`Size=md, Color=Gray, Type=Modern`): an icon on a framed tile. */
export function FeaturedIcon({ icon, size, color, type, className, ref, ...rest }: FeaturedIconProps) {
  return (
    <span ref={ref} {...rest} className={featuredIconStyles({ size, color, type, className })}>
      <span aria-hidden="true" data-slot="icon" className="flex items-center justify-center [&>svg]:size-full">
        {icon ?? <Icon name="check-circle" />}
      </span>
    </span>
  );
}
