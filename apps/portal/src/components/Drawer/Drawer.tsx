import type { HTMLAttributes, ReactNode, Ref } from 'react';
import {
  Dialog,
  Heading,
  Modal,
  ModalOverlay,
  type ModalOverlayProps,
} from 'react-aria-components';
import { CloseButton } from '../Button';
import { FeaturedIcon } from '../Badge';
import { cx, Text, variants, type VariantProps } from '../primitives';

const overlayStyles = [
  'fixed inset-0 z-50 flex justify-end bg-overlay/70',
  'motion-safe:transition-opacity motion-safe:duration-300 motion-safe:ease-out',
  'data-entering:opacity-0 data-exiting:opacity-0',
].join(' ');

export const drawerPanelStyles = variants({
  base: [
    'flex h-full max-w-full flex-col bg-primary shadow-xl outline-none',
    'motion-safe:transition-[translate,width] motion-safe:duration-300 motion-safe:ease-out',
    'data-entering:translate-x-full data-exiting:translate-x-full',
  ].join(' '),
  variants: {
    /**
     * `default`: the 480px panel. The *Node drawer* frame: `narrow` (505px) and `wide` (1100px), both padded
     * `p-lg`; switching between them animates the width, the panel staying anchored to the right edge.
     */
    size: { default: 'w-120', narrow: 'w-126.25 p-lg', wide: 'w-275 p-lg' },
  },
  defaults: { size: 'default' },
});

export interface DrawerProps extends Omit<ModalOverlayProps, 'children' | 'className' | 'style'>, VariantProps<typeof drawerPanelStyles> {
  children: ReactNode;
  /** Names the dialog when it has no `Drawer.Header` title. */
  'aria-label'?: string;
  className?: string;
  ref?: Ref<HTMLDivElement>;
}

/**
 * Figma *Node drawer*: a modal panel that slides in from the right over a `bg-overlay` scrim.
 * Focus is trapped inside; Escape and a scrim click close it.
 */
function DrawerRoot({ children, 'aria-label': ariaLabel, size, className, ref, isDismissable = true, ...rest }: DrawerProps) {
  return (
    <ModalOverlay {...rest} isDismissable={isDismissable} className={overlayStyles}>
      <Modal ref={ref} className={drawerPanelStyles({ size, className })}>
        <Dialog aria-label={ariaLabel} className="flex h-full min-h-0 flex-col outline-none">
          {children}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

export interface DrawerHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  /** Figma `Supporting text`. */
  description?: ReactNode;
  /** Figma `Icon`: shown in a `FeaturedIcon` before the title. */
  icon?: ReactNode;
  /** Accessible name of the close button. */
  closeLabel?: string;
  ref?: Ref<HTMLDivElement>;
}

/** Figma `_Slide out menu header` (`Tabs=False, Breakpoint=Desktop`): title, supporting text and a close button. */
function DrawerHeader({ title, description, icon, closeLabel, className, ref, ...rest }: DrawerHeaderProps) {
  return (
    <div ref={ref} {...rest} className={cx('relative flex shrink-0 gap-md bg-primary p-3xl', className)}>
      <div className="flex min-w-0 flex-1 items-start gap-xl">
        {icon != null && <FeaturedIcon icon={icon} />}
        <div className="flex min-w-0 flex-1 flex-col gap-xxs">
          <Heading slot="title" className="text-lg font-semibold text-primary">
            {title}
          </Heading>
          {description != null && (
            <Text as="p" color="tertiary">
              {description}
            </Text>
          )}
        </div>
      </div>
      <CloseButton slot="close" size="md" aria-label={closeLabel} className="absolute top-lg right-lg" />
    </div>
  );
}

export interface DrawerBodyProps extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>;
}

/** The drawer's scrolling content: sections stacked with `gap-2xl`. */
function DrawerBody({ className, ref, ...rest }: DrawerBodyProps) {
  return (
    <div
      ref={ref}
      {...rest}
      className={cx('flex min-h-0 flex-1 flex-col gap-2xl overflow-y-auto px-3xl pb-3xl', className)}
    />
  );
}

export interface DrawerSectionProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  subtitle?: ReactNode;
  ref?: Ref<HTMLElement>;
}

/** A titled group inside `Drawer.Body`. */
function DrawerSection({ title, subtitle, children, className, ref, ...rest }: DrawerSectionProps) {
  return (
    <section ref={ref} {...rest} className={cx('flex flex-col gap-md', className)}>
      {title != null && (
        <Text as="h3" size="lg" weight="semibold">
          {title}
        </Text>
      )}
      {subtitle != null && (
        <Text as="p" color="tertiary">
          {subtitle}
        </Text>
      )}
      {children}
    </section>
  );
}

export interface DrawerFooterProps extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>;
}

/** The drawer's action bar, pinned below the body. */
function DrawerFooter({ className, ref, ...rest }: DrawerFooterProps) {
  return (
    <div
      ref={ref}
      {...rest}
      className={cx('flex shrink-0 items-center justify-end gap-lg border-t border-secondary px-3xl py-lg', className)}
    />
  );
}

export const Drawer = Object.assign(DrawerRoot, {
  Header: DrawerHeader,
  Body: DrawerBody,
  Section: DrawerSection,
  Footer: DrawerFooter,
});
