import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { ButtonGroup } from '.';

const classesOf = (el: Element) => el.getAttribute('class')?.split(' ') ?? [];

function Group(props: Partial<Parameters<typeof ButtonGroup>[0]>) {
  return (
    <ButtonGroup aria-label="Range" {...props}>
      <ButtonGroup.Item id="12m">12 months</ButtonGroup.Item>
      <ButtonGroup.Item id="30d">30 days</ButtonGroup.Item>
      <ButtonGroup.Item id="7d" isDisabled>
        7 days
      </ButtonGroup.Item>
    </ButtonGroup>
  );
}

describe('ButtonGroup', () => {
  it('renders Icon=False with the design classes', async () => {
    const { container } = render(<Group defaultSelectedKeys={['12m']} />);
    const group = screen.getByRole('radiogroup', { name: 'Range' });
    expect(classesOf(group)).toEqual(expect.arrayContaining(['inline-flex', 'rounded-md', 'shadow-xs']));
    const item = screen.getByRole('radio', { name: '30 days' });
    expect(classesOf(item)).toEqual(
      expect.arrayContaining(['min-h-10', 'px-xl', 'py-md', 'gap-sm', 'text-sm', 'font-semibold', 'text-secondary', 'bg-primary', 'ring-primary']),
    );
    await expectNoAxeViolations(container);
  });

  it('keeps a single current item and moves it on press', async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    render(<Group defaultSelectedKeys={['12m']} onSelectionChange={onSelectionChange} />);
    const first = screen.getByRole('radio', { name: '12 months' });
    const second = screen.getByRole('radio', { name: '30 days' });
    expect(first.getAttribute('aria-checked')).toBe('true');
    expect(first.hasAttribute('data-selected')).toBe(true);
    await user.click(second);
    expect(second.getAttribute('aria-checked')).toBe('true');
    expect(first.getAttribute('aria-checked')).toBe('false');
    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['30d']));
    await user.click(second);
    expect(second.getAttribute('aria-checked')).toBe('true');
  });

  it('skips disabled items', async () => {
    const user = userEvent.setup();
    render(<Group defaultSelectedKeys={['12m']} />);
    const disabled = screen.getByRole('radio', { name: '7 days' });
    expect(disabled.hasAttribute('disabled')).toBe(true);
    await user.click(disabled);
    expect(disabled.getAttribute('aria-checked')).toBe('false');
  });

  it('supports controlled selection and keyboard arrows', async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    render(<Group selectedKeys={['12m']} onSelectionChange={onSelectionChange} />);
    await user.tab();
    expect(screen.getByRole('radio', { name: '12 months' }).hasAttribute('data-focus-visible')).toBe(true);
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: '30 days' }));
    await user.keyboard(' ');
    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['30d']));
  });

  it('merges className and forwards refs and DOM props', () => {
    const groupRef = createRef<HTMLDivElement>();
    const itemRef = createRef<HTMLButtonElement>();
    render(
      <ButtonGroup ref={groupRef} aria-label="Range" className="w-full" data-testid="g">
        <ButtonGroup.Item ref={itemRef} id="a" className="flex-1">
          A
        </ButtonGroup.Item>
      </ButtonGroup>,
    );
    expect(groupRef.current).toBe(screen.getByTestId('g'));
    expect(classesOf(groupRef.current!)).toContain('w-full');
    expect(itemRef.current).toBe(screen.getByRole('radio'));
    expect(classesOf(itemRef.current!)).toContain('flex-1');
  });
});
