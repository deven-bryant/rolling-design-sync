import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Avatar, AvatarLabelGroup, figmaAvatar, figmaOnlineIndicator, OnlineIndicator } from '.';
import { describeGalleryInThemes } from '../../test/theme';
import gallery from './Avatar.gallery';

const classesOf = (el: Element | null) => el?.getAttribute('class')?.split(' ') ?? [];

describe('Avatar', () => {
  it.each(Object.entries(figmaAvatar.variants))('renders %s', async (_name, { props }) => {
    const { container } = render(<Avatar alt="Olivia Rhye" {...props} />);
    const avatar = screen.getByRole('img', { name: 'Olivia Rhye' });
    expect(avatar.querySelector('[data-slot="status"]') !== null).toBe('status' in props);
    if ('initials' in props) {
      expect(avatar.textContent).toBe('OR');
      expect(classesOf(avatar)).toEqual(expect.arrayContaining(['bg-tertiary', 'text-quaternary', 'font-semibold', 'ring-secondary']));
    } else {
      expect(avatar.querySelector('img')?.getAttribute('src')).toBe('photo');
      expect(classesOf(avatar)).toEqual(expect.arrayContaining(['bg-avatar-bg', 'outline-avatar-contrast-border']));
    }
    await expectNoAxeViolations(container);
  });

  it.each([
    ['xs', 'size-6', 'text-xs', 'size-1.5'],
    ['sm', 'size-8', 'text-sm', 'size-2'],
    ['md', 'size-10', 'text-md', 'size-2.5'],
    ['lg', 'size-12', 'text-lg', 'size-3'],
    ['xl', 'size-14', 'text-xl', 'size-3.5'],
    ['2xl', 'size-16', 'text-display-xs', 'size-4'],
  ] as const)('sizes %s (avatar, initials, indicator)', (size, box, text, dot) => {
    render(<Avatar size={size} alt="OR" initials="OR" status="online" />);
    const avatar = screen.getByRole('img');
    expect(classesOf(avatar)).toEqual(expect.arrayContaining([box, text, 'rounded-full']));
    expect(classesOf(avatar.querySelector('[data-slot="status"]'))).toContain(dot);
  });

  it('defaults to Size=xs, Status icon=False', () => {
    render(<Avatar alt="OR" initials="OR" />);
    const avatar = screen.getByRole('img');
    expect(classesOf(avatar)).toContain('size-6');
    expect(avatar.querySelector('[data-slot="status"]')).toBeNull();
  });

  it('falls back to initials when the photo fails, and retries a new src', () => {
    const { rerender } = render(<Avatar alt="Olivia Rhye" src="broken.png" initials="OR" />);
    fireEvent.error(screen.getByRole('img').querySelector('img')!);
    expect(screen.getByRole('img').querySelector('img')).toBeNull();
    expect(screen.getByRole('img').textContent).toBe('OR');
    rerender(<Avatar alt="Olivia Rhye" src="ok.png" initials="OR" />);
    expect(screen.getByRole('img').querySelector('img')?.getAttribute('src')).toBe('ok.png');
  });

  it('renders the placeholder state (Placeholder=True) and when nothing else is given', async () => {
    const { container, rerender } = render(<Avatar alt="Unknown" placeholder src="a.png" initials="OR" />);
    const avatar = screen.getByRole('img', { name: 'Unknown' });
    expect(avatar.querySelector('img')).toBeNull();
    expect(avatar.querySelector('[data-icon="placeholder"]')).not.toBeNull();
    expect(classesOf(avatar)).toEqual(expect.arrayContaining(['bg-tertiary', 'text-fg-quaternary']));
    await expectNoAxeViolations(container);
    rerender(<Avatar alt="Unknown" placeholderIcon={<svg data-testid="custom" />} />);
    expect(screen.getByTestId('custom')).toBeDefined();
  });

  it('merges className and forwards ref and DOM props', () => {
    const ref = createRef<HTMLSpanElement>();
    render(<Avatar ref={ref} alt="OR" initials="OR" className="size-20" data-testid="a" />);
    expect(ref.current).toBe(screen.getByTestId('a'));
    expect(classesOf(ref.current)).toContain('size-20');
    expect(classesOf(ref.current)).not.toContain('size-6');
  });
});

describe('OnlineIndicator', () => {
  it.each(Object.entries(figmaOnlineIndicator.variants))('renders %s', (_name, { props }) => {
    const ref = createRef<HTMLSpanElement>();
    render(<OnlineIndicator ref={ref} {...props} />);
    const expected = { sm: 'size-2', md: 'size-2.5', lg: 'size-3' }[props.size];
    expect(classesOf(ref.current)).toEqual(
      expect.arrayContaining([expected, 'rounded-full', 'bg-fg-success-secondary', 'ring-[1.5px]', 'ring-bg-primary']),
    );
  });
});

describe('AvatarLabelGroup', () => {
  it('renders Size=md, Status icon=Online indicator', async () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(
      <AvatarLabelGroup
        ref={ref}
        src="photo"
        status="online"
        label="Olivia Rhye"
        supportingText="olivia@untitledui.com"
        className="w-full"
      />,
    );
    expect(classesOf(ref.current)).toEqual(expect.arrayContaining(['flex', 'items-center', 'gap-md', 'w-full']));
    const avatar = screen.getByRole('img', { name: 'Olivia Rhye' });
    expect(classesOf(avatar)).toContain('size-10');
    expect(classesOf(avatar.querySelector('[data-slot="status"]'))).toContain('size-2.5');
    expect(classesOf(screen.getByText('Olivia Rhye'))).toEqual(expect.arrayContaining(['font-semibold', 'text-primary']));
    expect(classesOf(screen.getByText('olivia@untitledui.com'))).toContain('text-tertiary');
    await expectNoAxeViolations(container);
  });
});

describeGalleryInThemes(gallery);
