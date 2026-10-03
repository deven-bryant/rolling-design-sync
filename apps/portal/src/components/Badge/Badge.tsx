import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { cx, variants, type VariantProps } from '../primitives';
import { BadgeDot } from './BadgeDot';

const colors = {
  gray: 'bg-utility-gray-50 text-utility-gray-700 ring-utility-gray-200 *:data-[slot]:text-utility-gray-500',
  brand: 'bg-utility-brand-50 text-utility-brand-700 ring-utility-brand-200 *:data-[slot]:text-utility-brand-500',
  warning: 'bg-utility-warning-50 text-utility-warning-700 ring-utility-warning-200 *:data-[slot]:text-utility-warning-500',
  success: 'bg-utility-success-50 text-utility-success-700 ring-utility-success-200 *:data-[slot]:text-utility-success-500',
  error: 'bg-utility-error-50 text-utility-error-700 ring-utility-error-200 *:data-[slot]:text-utility-error-500',
  'blue-light':
    'bg-utility-blue-light-50 text-utility-blue-light-700 ring-utility-blue-light-200 *:data-[slot]:text-utility-blue-light-500',
  blue: 'bg-utility-blue-50 text-utility-blue-700 ring-utility-blue-200 *:data-[slot]:text-utility-blue-500',
  indigo: 'bg-utility-indigo-50 text-utility-indigo-700 ring-utility-indigo-200 *:data-[slot]:text-utility-indigo-500',
  pink: 'bg-utility-pink-50 text-utility-pink-700 ring-utility-pink-200 *:data-[slot]:text-utility-pink-500',
  orange: 'bg-utility-orange-50 text-utility-orange-700 ring-utility-orange-200 *:data-[slot]:text-utility-orange-500',
  'gray-blue': 'bg-utility-gray-blue-50 text-utility-gray-blue-700 ring-utility-gray-blue-200 *:data-[slot]:text-utility-gray-blue-500',
} as const;

export const badgeStyles = variants({
  base: 'inline-flex shrink-0 items-center whitespace-nowrap font-medium ring-1 ring-inset *:data-[slot=icon]:size-3',
  variants: {
    size: { sm: 'gap-xs px-md py-xxs text-xs', md: 'gap-sm px-2.5 py-xxs text-sm' },
    color: colors,
    type: {
      'pill-color': 'rounded-full',
      'badge-color': 'rounded-sm',
      'badge-modern': 'rounded-sm bg-primary text-secondary shadow-xs ring-primary',
    },
  },
  defaults: { size: 'sm', color: 'gray', type: 'pill-color' },
});

export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'color'>, VariantProps<typeof badgeStyles> {
  /** The label (Figma `Text`). */
  children: ReactNode;
  /** Figma `Icon=Dot`: a leading status dot in the badge color. */
  dot?: boolean;
  /** Figma `Icon=Icon leading` + `🔀 Icon leading swap`. */
  iconLeading?: ReactNode;
  /** Figma `Icon=Icon trailing` + `🔀 Icon trailing swap`. */
  iconTrailing?: ReactNode;
  ref?: Ref<HTMLSpanElement>;
}

const leadingPadding = { sm: 'pl-sm', md: 'pl-md' } as const;
const trailingPadding = { sm: 'pr-sm', md: 'pr-md' } as const;

function Slot({ children }: { children: ReactNode }) {
  return (
    <span data-slot="icon" aria-hidden="true" className="flex items-center justify-center [&>svg]:size-full">
      {children}
    </span>
  );
}

/** Figma `Badge`: a small status label. */
export function Badge({ size = 'sm', color, type, dot = false, iconLeading, iconTrailing, children, className, ref, ...rest }: BadgeProps) {
  const leading = dot || Boolean(iconLeading);
  return (
    <span
      ref={ref}
      {...rest}
      className={badgeStyles({
        size,
        color,
        type,
        className: cx(leading && leadingPadding[size], iconTrailing ? trailingPadding[size] : undefined, className),
      })}
    >
      {dot && <BadgeDot size="sm" />}
      {!dot && iconLeading && <Slot>{iconLeading}</Slot>}
      {children}
      {iconTrailing && <Slot>{iconTrailing}</Slot>}
    </span>
  );
}
