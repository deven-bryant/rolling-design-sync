import type { ReactNode, Ref } from 'react';
import {
  Button as AriaButton,
  Link as AriaLink,
  type ButtonProps as AriaButtonProps,
  type LinkProps as AriaLinkProps,
} from 'react-aria-components';
import { cx, variants, VisuallyHidden, type VariantProps } from '../primitives';

export const buttonStyles = variants({
  base: [
    'relative inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap font-semibold outline-focus-ring',
    'transition duration-100 ease-linear data-focus-visible:outline-2 data-focus-visible:outline-offset-2',
    'data-disabled:cursor-not-allowed data-pending:cursor-progress',
    '*:data-[slot=icon]:shrink-0 data-disabled:*:data-[slot=icon]:text-fg-disabled_subtle',
  ].join(' '),
  variants: {
    size: {
      sm: 'gap-xs rounded-md px-lg py-md text-sm',
      md: 'gap-xs rounded-md px-3.5 py-2.5 text-sm',
      lg: 'gap-sm rounded-md px-xl py-2.5 text-md',
      xl: 'gap-sm rounded-md px-4.5 py-lg text-md',
    },
    hierarchy: {
      primary: [
        'bg-brand-solid text-white shadow-xs-skeumorphic data-hovered:bg-brand-solid_hover',
        '*:data-[slot=icon]:text-button-primary-icon data-hovered:*:data-[slot=icon]:text-button-primary-icon_hover',
        'data-disabled:bg-disabled data-disabled:text-fg-disabled data-disabled:shadow-xs data-disabled:ring-1 data-disabled:ring-disabled_subtle data-disabled:ring-inset',
      ].join(' '),
      secondary: [
        'bg-primary text-secondary shadow-xs ring-1 ring-primary ring-inset data-hovered:bg-primary_hover data-hovered:text-secondary_hover',
        '*:data-[slot=icon]:text-fg-quaternary data-hovered:*:data-[slot=icon]:text-fg-quaternary_hover',
        'data-disabled:bg-primary data-disabled:text-fg-disabled data-disabled:ring-disabled_subtle',
      ].join(' '),
      tertiary: [
        'text-tertiary data-hovered:bg-primary_hover data-hovered:text-tertiary_hover',
        '*:data-[slot=icon]:text-fg-quaternary data-hovered:*:data-[slot=icon]:text-fg-quaternary_hover',
        'data-disabled:bg-transparent data-disabled:text-fg-disabled',
      ].join(' '),
      'link-color': [
        'rounded-xs p-0 text-brand-secondary data-hovered:text-brand-secondary_hover',
        '*:data-[slot=icon]:text-fg-brand-secondary_alt data-hovered:*:data-[slot=icon]:text-fg-brand-secondary_hover',
        'data-disabled:text-fg-disabled',
      ].join(' '),
      'link-gray': [
        'rounded-xs p-0 text-tertiary data-hovered:text-tertiary_hover',
        '*:data-[slot=icon]:text-fg-quaternary data-hovered:*:data-[slot=icon]:text-fg-quaternary_hover',
        'data-disabled:text-fg-disabled',
      ].join(' '),
    },
    iconOnly: { true: '', false: '' },
  },
  compound: [
    { iconOnly: true, size: 'sm', className: 'p-md' },
    { iconOnly: true, size: 'md', className: 'p-2.5' },
    { iconOnly: true, size: 'lg', className: 'p-lg' },
    { iconOnly: true, size: 'xl', className: 'p-3.5' },
    { iconOnly: true, hierarchy: 'link-color', className: 'p-0' },
    { iconOnly: true, hierarchy: 'link-gray', className: 'p-0' },
  ],
  defaults: { size: 'sm', hierarchy: 'primary', iconOnly: false },
});

type Hierarchy = keyof typeof buttonStyles.variants.hierarchy;

interface ButtonOwnProps extends VariantProps<typeof buttonStyles> {
  /** The label (Figma `Text`). Visually hidden, but still the accessible name, when `iconOnly`. */
  children: ReactNode;
  /** Figma `⬅️ Icon leading` + `🔀 Icon leading swap`; the icon of an `iconOnly` button. */
  iconLeading?: ReactNode;
  /** Figma `➡️ Icon trailing` + `🔀 Icon trailing swap`. */
  iconTrailing?: ReactNode;
  /** Figma `State=Loading`: a spinner replaces the leading icon, the button is busy and ignores presses. */
  loading?: boolean;
  /** Figma `Loading text`: keep the label visible while loading. */
  loadingText?: boolean;
  className?: string;
}

export type ButtonAsButtonProps = ButtonOwnProps &
  Omit<AriaButtonProps, 'children' | 'className' | 'style' | 'isPending'> & {
    href?: undefined;
    ref?: Ref<HTMLButtonElement>;
  };

export type ButtonAsLinkProps = ButtonOwnProps &
  Omit<AriaLinkProps, 'children' | 'className' | 'style'> & {
    href: string;
    ref?: Ref<HTMLAnchorElement>;
  };

export type ButtonProps = ButtonAsButtonProps | ButtonAsLinkProps;

const isLink = (hierarchy: Hierarchy | undefined) => hierarchy === 'link-color' || hierarchy === 'link-gray';

/** The design's loading spinner: a faint track with a turning arc, in `currentColor`. */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      data-slot="icon"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={cx('size-5 shrink-0 animate-spin motion-reduce:animate-none', className)}
    >
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2.5" className="opacity-30" />
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="12.5 50.3" />
    </svg>
  );
}

export function IconSlot({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span data-slot="icon" aria-hidden="true" className={cx('flex size-5 items-center justify-center [&>svg]:size-full', className)}>
      {children}
    </span>
  );
}

function ButtonContent({
  children,
  hierarchy,
  iconOnly = false,
  iconLeading,
  iconTrailing,
  loading = false,
  loadingText = true,
}: Omit<ButtonOwnProps, 'className' | 'size'>) {
  const hideLabel = loading && !loadingText;
  const leading = iconOnly ? (iconLeading ?? iconTrailing) : iconLeading;
  return (
    <>
      {loading ? <Spinner className={hideLabel && !iconOnly ? 'absolute' : undefined} /> : leading && <IconSlot>{leading}</IconSlot>}
      {iconOnly ? (
        <VisuallyHidden>{children}</VisuallyHidden>
      ) : (
        <span data-slot="text" className={cx(!isLink(hierarchy) && 'px-xxs', hideLabel && 'opacity-0')}>
          {children}
        </span>
      )}
      {!iconOnly && !loading && iconTrailing && <IconSlot>{iconTrailing}</IconSlot>}
    </>
  );
}

/**
 * Figma `Buttons/Button`. Renders a React Aria `Button`, or a React Aria `Link` (an `<a>`) when given `href`.
 */
export function Button(props: ButtonProps) {
  if (props.href !== undefined) {
    const { size, hierarchy, iconOnly, iconLeading, iconTrailing, loading, loadingText, children, className, ...rest } = props;
    return (
      <AriaLink {...rest} className={buttonStyles({ size, hierarchy, iconOnly, className })}>
        <ButtonContent
          {...{
            hierarchy,
            iconOnly,
            iconLeading,
            iconTrailing,
            loading,
            loadingText,
            children,
          }}
        />
      </AriaLink>
    );
  }
  const { size, hierarchy, iconOnly, iconLeading, iconTrailing, loading = false, loadingText, children, className, ...rest } = props;
  return (
    <AriaButton
      {...rest}
      isPending={loading}
      render={(domProps, { isPending }) => <button {...domProps} aria-busy={isPending || undefined} />}
      className={buttonStyles({ size, hierarchy, iconOnly, className })}
    >
      <ButtonContent
        {...{
          hierarchy,
          iconOnly,
          iconLeading,
          iconTrailing,
          loading,
          loadingText,
          children,
        }}
      />
    </AriaButton>
  );
}
