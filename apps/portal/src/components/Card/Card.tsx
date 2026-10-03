import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { cx, Surface, type SurfaceProps, Text } from '../primitives';

export type CardProps = Omit<SurfaceProps, 'background' | 'border' | 'radius' | 'shadow' | 'padding'>;

/** The card surface: bg-primary, border-secondary, radius-xl, shadow-xs. */
function CardRoot({ className, ...rest }: CardProps) {
  return (
    <Surface
      background="primary"
      border="secondary"
      radius="xl"
      shadow="xs"
      className={cx('flex flex-col overflow-hidden', className)}
      {...rest}
    />
  );
}

export interface CardHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** `Text`: the card title. */
  title: ReactNode;
  /** Heading level of the title. */
  headingLevel?: 2 | 3 | 4;
  /** `Badge` slot after the title. */
  badge?: ReactNode;
  /** `Supporting text` under the title. */
  description?: ReactNode;
  /** `Actions` slot (buttons). */
  actions?: ReactNode;
  /** `Dropdown icon` slot (the menu trigger). */
  menu?: ReactNode;
  /** `Divider` under the header. */
  divider?: boolean;
  ref?: Ref<HTMLElement>;
}

/** `Card header` (`Avatar=False, Breakpoint=Desktop`). */
function CardHeader({
  title,
  headingLevel = 2,
  badge,
  description,
  actions,
  menu,
  divider = true,
  className,
  ref,
  ...rest
}: CardHeaderProps) {
  return (
    <header
      ref={ref}
      className={cx('flex flex-col bg-primary', divider && 'border-b border-secondary pb-2xl', className)}
      {...rest}
    >
      <div className="flex gap-xl px-3xl pt-2xl">
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-xxs">
          <div className="flex items-center gap-md">
            <Text as={`h${headingLevel}`} size="lg" weight="semibold">
              {title}
            </Text>
            {badge}
          </div>
          {description != null && (
            <Text as="p" color="tertiary">
              {description}
            </Text>
          )}
        </div>
        {actions != null && <div className="flex items-center gap-lg">{actions}</div>}
        {menu}
      </div>
    </header>
  );
}

export interface CardSectionProps extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>;
}

/** The card's content; unpadded so tables and lists run edge to edge. */
function CardBody({ className, ref, ...rest }: CardSectionProps) {
  return <div ref={ref} className={cx('flex-1', className)} {...rest} />;
}

/** The card's footer row, divided from the body. */
function CardFooter({ className, ref, ...rest }: CardSectionProps) {
  return (
    <div
      ref={ref}
      className={cx('flex items-center gap-lg border-t border-secondary px-3xl pt-lg pb-xl', className)}
      {...rest}
    />
  );
}

export const Card = Object.assign(CardRoot, { Header: CardHeader, Body: CardBody, Footer: CardFooter });
