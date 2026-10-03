import { useState, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { cx, Icon, variants, type VariantProps } from '../primitives';

export const avatarStyles = variants({
  base: 'relative inline-flex shrink-0 items-center justify-center rounded-full',
  variants: {
    size: {
      xs: 'size-6 text-xs',
      sm: 'size-8 text-sm',
      md: 'size-10 text-md',
      lg: 'size-12 text-lg',
      xl: 'size-14 text-xl',
      '2xl': 'size-16 text-display-xs',
    },
    content: {
      image: 'bg-avatar-bg outline-1 -outline-offset-1 outline-avatar-contrast-border',
      text: 'bg-tertiary font-semibold text-quaternary ring-[0.75px] ring-secondary ring-inset',
      placeholder: 'bg-tertiary text-fg-quaternary ring-[0.75px] ring-secondary ring-inset',
    },
  },
  defaults: { size: 'xs', content: 'text' },
});

export const onlineIndicatorStyles = variants({
  base: 'absolute right-0 bottom-0 rounded-full bg-fg-success-secondary ring-[1.5px] ring-bg-primary',
  variants: {
    size: { xs: 'size-1.5', sm: 'size-2', md: 'size-2.5', lg: 'size-3', xl: 'size-3.5', '2xl': 'size-4' },
  },
  defaults: { size: 'xs' },
});

const placeholderIconSize = { xs: 'size-4', sm: 'size-5', md: 'size-6', lg: 'size-7', xl: 'size-8', '2xl': 'size-8' } as const;

type AvatarSize = keyof typeof avatarStyles.variants.size;

export interface OnlineIndicatorProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof onlineIndicatorStyles> {
  ref?: Ref<HTMLSpanElement>;
}

/** Figma `_Avatar online indicator` (`Online=True`): the green dot on an avatar's corner. */
export function OnlineIndicator({ size, className, ref, ...rest }: OnlineIndicatorProps) {
  return <span ref={ref} data-slot="status" {...rest} className={onlineIndicatorStyles({ size, className })} />;
}

export interface AvatarProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  size?: AvatarSize;
  /** Who the avatar shows; the accessible name. */
  alt: string;
  /** Photo URL. Falls back to `initials` (or the placeholder) when missing or it fails to load. */
  src?: string;
  /** Figma `Text=True`, e.g. "OR". */
  initials?: string;
  /** Figma `Placeholder=True`: an icon instead of a photo or initials. */
  placeholder?: boolean;
  /** Icon for the placeholder state. */
  placeholderIcon?: ReactNode;
  /** Figma `Status icon=Online indicator`. */
  status?: 'online';
  ref?: Ref<HTMLSpanElement>;
}

/** Figma `Avatar`: a round photo, initials or placeholder, optionally with an online indicator. */
export function Avatar({
  size = 'xs',
  alt,
  src,
  initials,
  placeholder = false,
  placeholderIcon,
  status,
  className,
  ref,
  ...rest
}: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string>();
  const showImage = !placeholder && src !== undefined && failedSrc !== src;
  const content = showImage ? 'image' : !placeholder && initials ? 'text' : 'placeholder';
  return (
    <span ref={ref} role="img" aria-label={alt} {...rest} className={avatarStyles({ size, content, className })}>
      {content === 'image' && <img src={src} alt="" onError={() => setFailedSrc(src)} className="size-full rounded-full object-cover" />}
      {content === 'text' && <span aria-hidden="true">{initials}</span>}
      {content === 'placeholder' && (
        <span
          aria-hidden="true"
          data-slot="icon"
          className={cx('flex items-center justify-center [&>svg]:size-full', placeholderIconSize[size])}
        >
          {placeholderIcon ?? <Icon name="placeholder" />}
        </span>
      )}
      {status === 'online' && <OnlineIndicator size={size} />}
    </span>
  );
}

export interface AvatarLabelGroupProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  size?: 'md';
  alt?: string;
  src?: string;
  initials?: string;
  status?: 'online';
  /** Figma `Text`, e.g. the person's name. */
  label: ReactNode;
  /** Figma `Supporting text`, e.g. their email. */
  supportingText?: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

/** Figma `Avatar label group` (`Size=md`): an avatar beside a name and supporting text. */
export function AvatarLabelGroup({
  size = 'md',
  alt,
  src,
  initials,
  status,
  label,
  supportingText,
  className,
  ref,
  ...rest
}: AvatarLabelGroupProps) {
  return (
    <div ref={ref} {...rest} className={cx('flex min-w-0 items-center gap-md', className)}>
      <Avatar size={size} alt={alt ?? (typeof label === 'string' ? label : '')} src={src} initials={initials} status={status} />
      <div className="flex min-w-0 flex-col text-sm">
        <span className="truncate font-semibold text-primary">{label}</span>
        {supportingText && <span className="truncate text-tertiary">{supportingText}</span>}
      </div>
    </div>
  );
}
