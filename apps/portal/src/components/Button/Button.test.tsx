import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Icon } from '../primitives';
import { Button, buttonStyles, ButtonUtility, CloseButton, figmaButton, figmaButtonUtility, figmaCloseButton } from '.';

const icon = <Icon name="placeholder" />;
const classesOf = (el: Element) => el.getAttribute('class')?.split(' ') ?? [];

describe('Button', () => {
  it('defaults to Size=sm, Hierarchy=Primary as a <button>', () => {
    render(<Button>Button CTA</Button>);
    const el = screen.getByRole('button', { name: 'Button CTA' });
    expect(el.tagName).toBe('BUTTON');
    expect(el.getAttribute('type')).toBe('button');
    expect(classesOf(el)).toEqual(expect.arrayContaining(['px-lg', 'py-md', 'text-sm', 'bg-brand-solid', 'text-white']));
  });

  it.each(Object.entries(figmaButton.variants))('renders %s', async (_name, { props }) => {
    const { container } = render(
      <Button {...props} iconLeading={icon} iconTrailing={icon}>
        Button CTA
      </Button>,
    );
    const el = screen.getByRole('button', { name: 'Button CTA' });
    for (const c of buttonStyles({ ...props }).split(' ')) expect(classesOf(el)).toContain(c);
    expect(container.querySelectorAll('[data-slot="icon"]')).toHaveLength('iconOnly' in props ? 1 : 2);
    await expectNoAxeViolations(container);
  });

  it('renders Size=md, Hierarchy=Tertiary, Icon only=True as a 40px transparent square with a hidden label', async () => {
    const { container } = render(
      <Button size="md" hierarchy="tertiary" iconOnly iconLeading={icon}>
        More actions
      </Button>,
    );
    const el = screen.getByRole('button', { name: 'More actions' });
    expect(classesOf(el)).toEqual(expect.arrayContaining(['p-2.5', 'rounded-md', 'text-tertiary', 'data-hovered:bg-primary_hover']));
    expect(classesOf(el)).not.toContain('px-3.5');
    expect(classesOf(el)).not.toContain('bg-primary');
    expect(classesOf(el)).not.toContain('ring-primary');
    expect(container.querySelector('[data-slot="text"]')).toBeNull();
    expect(classesOf(container.querySelector('[data-slot="icon"]')!)).toContain('size-5');
    await expectNoAxeViolations(container);
  });

  it.each([
    ['sm', ['gap-xs', 'px-lg', 'py-md', 'text-sm', 'rounded-md']],
    ['md', ['gap-xs', 'px-3.5', 'py-2.5', 'text-sm', 'rounded-md']],
    ['lg', ['gap-sm', 'px-xl', 'py-2.5', 'text-md']],
    ['xl', ['gap-sm', 'px-4.5', 'py-lg', 'text-md']],
  ] as const)('applies Size=%s', (size, expected) => {
    render(<Button size={size}>Go</Button>);
    expect(classesOf(screen.getByRole('button'))).toEqual(expect.arrayContaining([...expected]));
  });

  it.each([
    ['primary', ['bg-brand-solid', 'text-white', 'shadow-xs-skeumorphic']],
    ['secondary', ['bg-primary', 'text-secondary', 'ring-primary', 'shadow-xs']],
    ['tertiary', ['text-tertiary', 'data-hovered:bg-primary_hover']],
    ['link-color', ['text-brand-secondary', 'p-0']],
    ['link-gray', ['text-tertiary', 'p-0']],
  ] as const)('applies Hierarchy=%s', (hierarchy, expected) => {
    render(<Button hierarchy={hierarchy}>Go</Button>);
    const el = screen.getByRole('button');
    expect(classesOf(el)).toEqual(expect.arrayContaining([...expected]));
    const text = el.querySelector('[data-slot="text"]');
    expect(classesOf(text!).includes('px-xxs')).toBe(!hierarchy.startsWith('link'));
  });

  it('hides the leading/trailing icons unless given', () => {
    const { container } = render(<Button iconTrailing={icon}>Go</Button>);
    const slots = container.querySelectorAll('[data-slot]');
    expect([...slots].map(s => s.getAttribute('data-slot'))).toEqual(['text', 'icon']);
  });

  it.each([
    ['sm', 'p-md'],
    ['md', 'p-2.5'],
    ['lg', 'p-lg'],
    ['xl', 'p-3.5'],
  ] as const)('renders Icon only=True at %s with the label visually hidden', async (size, padding) => {
    const { container } = render(
      <Button size={size} hierarchy="secondary" iconOnly iconLeading={icon} iconTrailing={<Icon name="x-close" />}>
        Add item
      </Button>,
    );
    const el = screen.getByRole('button', { name: 'Add item' });
    expect(classesOf(el)).toContain(padding);
    expect(container.querySelectorAll('[data-slot="icon"]')).toHaveLength(1);
    expect(container.querySelector('[data-icon="placeholder"]')).not.toBeNull();
    expect(container.querySelector('.sr-only')?.textContent).toBe('Add item');
    await expectNoAxeViolations(container);
  });

  it('presses, and ignores presses while disabled', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    const { rerender } = render(<Button onPress={onPress}>Save</Button>);
    await user.click(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
    rerender(
      <Button onPress={onPress} isDisabled>
        Save
      </Button>,
    );
    const el = screen.getByRole('button');
    expect(el.hasAttribute('disabled')).toBe(true);
    expect(el.hasAttribute('data-disabled')).toBe(true);
    await user.click(el);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows a spinner and is busy while loading (State=Loading)', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    const { container } = render(
      <Button onPress={onPress} loading iconLeading={icon} iconTrailing={icon}>
        Submitting...
      </Button>,
    );
    const el = screen.getByRole('button', { name: /Submitting/ });
    expect(el.getAttribute('aria-busy')).toBe('true');
    expect(el.getAttribute('aria-disabled')).toBe('true');
    expect(el.hasAttribute('data-pending')).toBe(true);
    expect(container.querySelector('svg.animate-spin')).not.toBeNull();
    expect(container.querySelector('[data-icon="placeholder"]')).toBeNull();
    expect(classesOf(container.querySelector('[data-slot="text"]')!)).not.toContain('opacity-0');
    await user.click(el);
    expect(onPress).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('keeps the label for assistive tech but hides it when Loading text=False', () => {
    const { container } = render(
      <Button loading loadingText={false}>
        Save
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDefined();
    expect(classesOf(container.querySelector('[data-slot="text"]')!)).toContain('opacity-0');
    expect(classesOf(container.querySelector('svg.animate-spin')!)).toContain('absolute');
  });

  it('renders a link with href', async () => {
    const { container } = render(
      <Button href="/docs" hierarchy="link-color" iconTrailing={icon}>
        Docs
      </Button>,
    );
    const el = screen.getByRole('link', { name: 'Docs' });
    expect(el.tagName).toBe('A');
    expect(el.getAttribute('href')).toBe('/docs');
    expect(classesOf(el)).toContain('text-brand-secondary');
    await expectNoAxeViolations(container);
  });

  it('marks the focus ring on keyboard focus', async () => {
    const user = userEvent.setup();
    render(<Button>Go</Button>);
    await user.tab();
    const el = screen.getByRole('button');
    expect(el.hasAttribute('data-focus-visible')).toBe(true);
    expect(classesOf(el)).toEqual(expect.arrayContaining(['outline-focus-ring', 'data-focus-visible:outline-2']));
  });

  it('merges className last, forwards ref and DOM props', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button ref={ref} className="w-full px-xl" data-testid="b" type="submit">
        Go
      </Button>,
    );
    const el = screen.getByTestId('b');
    expect(ref.current).toBe(el);
    expect(el.getAttribute('type')).toBe('submit');
    expect(classesOf(el)).toEqual(expect.arrayContaining(['w-full', 'px-xl']));
    expect(classesOf(el)).not.toContain('px-lg');
  });

  it('forwards a ref to the link', () => {
    const ref = createRef<HTMLAnchorElement>();
    render(
      <Button ref={ref} href="/x">
        Go
      </Button>,
    );
    expect(ref.current).toBe(screen.getByRole('link'));
  });
});

describe('ButtonUtility', () => {
  it.each(Object.entries(figmaButtonUtility.variants))('renders %s', async (_name, { props }) => {
    const { container } = render(<ButtonUtility {...props} icon={icon} tooltip="Copy" />);
    const el = screen.getByRole('button', { name: 'Copy' });
    expect(classesOf(el)).toEqual(expect.arrayContaining(['p-sm', 'rounded-sm', 'text-fg-quaternary', 'data-hovered:bg-primary_hover']));
    expect(classesOf(el)).not.toContain('ring-primary');
    expect(classesOf(container.querySelector('[data-slot="icon"]')!)).toContain('size-5');
    await expectNoAxeViolations(container);
  });

  it('renders Size=xs as a 28px square: 6px padding, radius-sm, 16px icon', async () => {
    const { container } = render(<ButtonUtility size="xs" hierarchy="tertiary" icon={icon} tooltip="Copy" />);
    const el = screen.getByRole('button', { name: 'Copy' });
    expect(classesOf(el)).toEqual(expect.arrayContaining(['p-sm', 'rounded-sm', '*:data-[slot=icon]:size-4']));
    await expectNoAxeViolations(container);
  });

  it('defaults to Hierarchy=Secondary', () => {
    render(<ButtonUtility icon={icon} tooltip="Copy" />);
    expect(classesOf(screen.getByRole('button'))).toEqual(expect.arrayContaining(['bg-primary', 'ring-primary', 'shadow-xs']));
  });

  it('shows its tooltip on hover and focus, and presses', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    render(<ButtonUtility icon={icon} tooltip="Copy" onPress={onPress} />);
    await user.tab();
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip.textContent).toBe('Copy');
    await user.keyboard('{Enter}');
    expect(onPress).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    await user.click(document.body);
    await act(() => user.hover(screen.getByRole('button')));
    expect((await screen.findByRole('tooltip')).textContent).toBe('Copy');
  });

  it('forwards ref and className', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<ButtonUtility ref={ref} icon={icon} tooltip="Copy" className="p-md" />);
    expect(ref.current).toBe(screen.getByRole('button'));
    expect(classesOf(ref.current!)).toContain('p-md');
    expect(classesOf(ref.current!)).not.toContain('p-sm');
  });
});

describe('CloseButton', () => {
  it.each(Object.entries(figmaCloseButton.variants))('renders %s', async (_name, { props }) => {
    const { container } = render(<CloseButton {...props} />);
    const el = screen.getByRole('button', { name: 'Close' });
    expect(classesOf(el)).toEqual(
      expect.arrayContaining(['p-md', 'rounded-md', 'text-fg-quaternary', props.size === 'sm' ? 'size-9' : 'size-10']),
    );
    expect(el.querySelector('[data-icon="x-close"]')?.getAttribute('class')).toContain('size-5');
    await expectNoAxeViolations(container);
  });

  it('defaults to Size=sm, takes a label, presses and forwards ref', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    render(<CloseButton ref={ref} aria-label="Close drawer" onPress={onPress} />);
    const el = screen.getByRole('button', { name: 'Close drawer' });
    expect(ref.current).toBe(el);
    expect(classesOf(el)).toContain('size-9');
    await user.click(el);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
