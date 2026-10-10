import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Icon } from '../primitives';
import { Badge, BadgeDot, FeaturedIcon, figmaBadge, figmaBadgeDot, figmaFeaturedIcon } from '.';
import { describeGalleryInThemes } from '../../test/theme';
import gallery from './Badge.gallery';

const classesOf = (el: Element | null) => el?.getAttribute('class')?.split(' ') ?? [];

describe('Badge', () => {
  it.each(Object.entries(figmaBadge.variants))('renders %s', async (_name, { props }) => {
    const { container } = render(<Badge {...props}>Label</Badge>);
    const badge = screen.getByText('Label');
    const { color } = props;
    expect(classesOf(badge)).toEqual(
      expect.arrayContaining([
        `bg-utility-${color}-50`,
        `ring-utility-${color}-200`,
        `text-utility-${color}-700`,
        'ring-1',
        'ring-inset',
        'rounded-full',
        'font-medium',
        'py-xxs',
        ...(props.size === 'sm' ? ['px-md', 'text-xs'] : ['px-2.5', 'text-sm']),
      ]),
    );
    await expectNoAxeViolations(container);
  });

  it('defaults to Size=sm, Type=Pill color, Color=Gray', () => {
    render(<Badge>Label</Badge>);
    expect(classesOf(screen.getByText('Label'))).toEqual(
      expect.arrayContaining(['px-md', 'text-xs', 'rounded-full', 'bg-utility-gray-50']),
    );
  });

  it.each([
    ['badge-color', ['rounded-sm', 'bg-utility-brand-50', 'text-utility-brand-700']],
    ['badge-modern', ['rounded-sm', 'bg-primary', 'text-secondary', 'ring-primary', 'shadow-xs']],
  ] as const)('renders Type=%s', (type, expected) => {
    render(
      <Badge type={type} color="brand">
        Label
      </Badge>,
    );
    const badge = screen.getByText('Label');
    expect(classesOf(badge)).toEqual(expect.arrayContaining([...expected]));
    if (type === 'badge-modern') expect(classesOf(badge)).not.toContain('bg-utility-brand-50');
  });

  it('renders a colored dot (Icon=Dot)', async () => {
    const { container } = render(
      <Badge color="success" dot>
        Active
      </Badge>,
    );
    const badge = screen.getByText('Active');
    const dot = badge.querySelector('[data-slot="dot"]');
    expect(dot?.getAttribute('aria-hidden')).toBe('true');
    expect(classesOf(badge)).toEqual(expect.arrayContaining(['pl-sm', '*:data-[slot]:text-utility-success-500']));
    await expectNoAxeViolations(container);
  });

  it('renders leading and trailing icon slots', () => {
    render(
      <Badge size="md" iconLeading={<Icon name="arrow-up-right" />} iconTrailing={<Icon name="x-close" />}>
        Label
      </Badge>,
    );
    const badge = screen.getByText('Label');
    const icons = badge.querySelectorAll('[data-slot="icon"]');
    expect(icons).toHaveLength(2);
    expect(icons.item(0).querySelector('[data-icon="arrow-up-right"]')).not.toBeNull();
    expect(icons.item(1).querySelector('[data-icon="x-close"]')).not.toBeNull();
    expect(classesOf(badge)).toEqual(expect.arrayContaining(['pl-md', 'pr-md', 'gap-sm', '*:data-[slot=icon]:size-3']));
  });

  it('merges className and forwards ref and DOM props', () => {
    const ref = createRef<HTMLSpanElement>();
    render(
      <Badge ref={ref} className="px-lg" data-testid="b">
        Label
      </Badge>,
    );
    expect(ref.current).toBe(screen.getByTestId('b'));
    expect(classesOf(ref.current)).toContain('px-lg');
    expect(classesOf(ref.current)).not.toContain('px-md');
  });
});

describe('BadgeDot', () => {
  it.each(Object.entries(figmaBadgeDot.variants))('renders %s', (_name, { props }) => {
    const ref = createRef<HTMLSpanElement>();
    render(<BadgeDot ref={ref} {...props} className="text-fg-brand-primary" />);
    expect(classesOf(ref.current)).toEqual(expect.arrayContaining(['size-2.5', '*:size-2', 'text-fg-brand-primary']));
    expect(classesOf(ref.current)).not.toContain('text-fg-success-secondary');
    expect(classesOf(ref.current?.firstElementChild ?? null)).toEqual(expect.arrayContaining(['rounded-full', 'bg-current']));
  });

  it('defaults to Size=sm in the success color', () => {
    const ref = createRef<HTMLSpanElement>();
    render(<BadgeDot ref={ref} />);
    expect(classesOf(ref.current)).toEqual(expect.arrayContaining(['size-2', 'text-fg-success-secondary']));
  });
});

describe('FeaturedIcon', () => {
  it.each(Object.entries(figmaFeaturedIcon.variants))('renders %s', async (_name, { props }) => {
    const ref = createRef<HTMLSpanElement>();
    const { container } = render(<FeaturedIcon ref={ref} {...props} />);
    expect(classesOf(ref.current)).toEqual(
      expect.arrayContaining(['size-10', 'rounded-md', 'bg-primary', 'ring-primary', 'shadow-xs', 'text-fg-secondary']),
    );
    expect(container.querySelector('[data-icon="check-circle"]')).not.toBeNull();
    await expectNoAxeViolations(container);
  });

  it('swaps the icon and merges className', () => {
    const ref = createRef<HTMLSpanElement>();
    const { container } = render(<FeaturedIcon ref={ref} icon={<Icon name="mail-01" />} className="shadow-sm" />);
    expect(container.querySelector('[data-icon="mail-01"]')).not.toBeNull();
    expect(classesOf(ref.current)).toContain('shadow-sm');
    expect(classesOf(ref.current)).not.toContain('shadow-xs');
  });
});

describeGalleryInThemes(gallery);
