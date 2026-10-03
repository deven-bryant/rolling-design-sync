import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, useState } from 'react';
import type { Key } from 'react-aria-components';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Icon } from '../primitives';
import { Select, SelectItem, SelectSearch, type SelectProps, type SelectSearchProps } from '.';

const classesOf = (el: Element | null | undefined) => (el?.getAttribute('class') ?? '').split(' ');

interface Member {
  id: string;
  name: string;
  handle: string;
}

const team: Member[] = [
  { id: 'olivia', name: 'Olivia Rhye', handle: '@olivia' },
  { id: 'phoenix', name: 'Phoenix Baker', handle: '@phoenix' },
  { id: 'lana', name: 'Lana Steiner', handle: '@lana' },
];

function TeamSelect(props: Partial<SelectProps<Member>>) {
  return (
    <Select label="Team member" items={team} {...props}>
      {(item: Member) => <Select.Item supportingText={item.handle}>{item.name}</Select.Item>}
    </Select>
  );
}

describe('Select', () => {
  it('renders Size=sm, Type=Default, State=Default with every part', () => {
    render(
      <TeamSelect required tooltip="Who owns the claim" hint="This is a hint text to help user." defaultSelectedKey="olivia" />,
    );
    const trigger = screen.getByRole('button', { name: /Team member/ });
    expect(classesOf(trigger)).toEqual(
      expect.arrayContaining(['rounded-md', 'border', 'border-primary', 'bg-primary', 'shadow-xs', 'px-lg', 'py-md', 'gap-md']),
    );
    expect(within(trigger).getByText('Olivia Rhye')).toBeDefined();
    expect(classesOf(within(trigger).getByText('@olivia'))).toEqual(expect.arrayContaining(['text-md', 'text-tertiary']));
    expect(trigger.querySelector('[data-icon="chevron-down"]')).not.toBeNull();
    expect(screen.getByRole('img', { name: 'Who owns the claim' }).getAttribute('data-icon')).toBe('help-circle');
    expect(classesOf(screen.getByText('*'))).toContain('text-brand-tertiary');
    expect(screen.getByText('This is a hint text to help user.').id).not.toBe('');
  });

  it('shows the placeholder and a leading icon', () => {
    render(<TeamSelect placeholder="Select member" iconLeading={<Icon name="placeholder" size="md" />} />);
    const trigger = screen.getByRole('button', { name: /Team member/ });
    const value = within(trigger).getByText('Select member');
    expect(classesOf(value)).toContain('data-[placeholder]:text-placeholder');
    expect(value.hasAttribute('data-placeholder')).toBe(true);
    expect(trigger.querySelector('[data-icon="placeholder"]')).not.toBeNull();
  });

  it('opens with the keyboard, moves with arrows and selects with Enter', async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    render(<TeamSelect onSelectionChange={onSelectionChange} />);
    await user.tab();
    const trigger = screen.getByRole('button', { name: /Team member/ });
    expect(document.activeElement).toBe(trigger);
    expect(classesOf(trigger)).toContain('data-[focus-visible]:outline-2');
    expect(trigger.hasAttribute('data-focus-visible')).toBe(true);
    await user.keyboard('{ArrowDown}');
    const listbox = await screen.findByRole('listbox');
    expect(document.activeElement).toBe(within(listbox).getByRole('option', { name: /Olivia Rhye/ }));
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');
    expect(onSelectionChange).toHaveBeenLastCalledWith('phoenix');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(within(trigger).getByText('Phoenix Baker')).toBeDefined();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('closes with Escape without changing the value', async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    render(<TeamSelect defaultSelectedKey="lana" onSelectionChange={onSelectionChange} />);
    await user.click(screen.getByRole('button', { name: /Team member/ }));
    expect(await screen.findByRole('listbox')).toBeDefined();
    await user.keyboard('{ArrowUp}');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(within(screen.getByRole('button', { name: /Team member/ })).getByText('Lana Steiner')).toBeDefined();
  });

  it('supports controlled selection', async () => {
    const user = userEvent.setup();
    function Controlled() {
      const [key, setKey] = useState<Key | null>('olivia');
      return (
        <>
          <TeamSelect selectedKey={key} onSelectionChange={setKey} />
          <output>{String(key)}</output>
        </>
      );
    }
    render(<Controlled />);
    await user.click(screen.getByRole('button', { name: /Team member/ }));
    await user.click(await screen.findByRole('option', { name: /Lana Steiner/ }));
    expect(screen.getByRole('status').textContent).toBe('lana');
  });

  it('uses aria-label when there is no visible label', () => {
    render(
      <Select aria-label="Status">
        <Select.Item id="open">Open</Select.Item>
      </Select>,
    );
    expect(screen.getByRole('button', { name: /Status/ })).toBeDefined();
  });

  it('marks the selected option and does not open when disabled', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<TeamSelect defaultSelectedKey="olivia" />);
    await user.click(screen.getByRole('button', { name: /Team member/ }));
    const option = await screen.findByRole('option', { name: /Olivia Rhye/ });
    expect(option.getAttribute('aria-selected')).toBe('true');
    expect(classesOf(option)).toEqual(expect.arrayContaining(['data-[selected]:bg-active', 'data-[focused]:bg-primary_hover']));
    unmount();
    render(<TeamSelect isDisabled />);
    await user.click(screen.getByRole('button', { name: /Team member/ }));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('forwards ref and className to the root', () => {
    const ref = createRef<HTMLDivElement>();
    render(<TeamSelect ref={ref} className="max-w-xs" />);
    expect(ref.current?.className).toContain('max-w-xs');
    expect(Select.Item).toBe(SelectItem);
    expect(Select.Search).toBe(SelectSearch);
  });

  it('has no axe violations, closed and open', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <div>
        <TeamSelect required tooltip="Help" hint="Hint" defaultSelectedKey="olivia" />
        <Select aria-label="Status" placeholder="Select status">
          <Select.Item id="open">Open</Select.Item>
        </Select>
      </div>,
    );
    await expectNoAxeViolations(container);
    await user.click(screen.getByRole('button', { name: /Team member/ }));
    await screen.findByRole('listbox');
    await expectNoAxeViolations(document.body);
  });
});

describe('Select.Search', () => {
  function TeamSearch(props: Partial<SelectSearchProps<Member>>) {
    return (
      <SelectSearch label="Search" placeholder="Search" items={team} {...props}>
        {(item: Member) => <Select.Item supportingText={item.handle}>{item.name}</Select.Item>}
      </SelectSearch>
    );
  }

  it('renders Size=sm, Type=Search, State=Placeholder', () => {
    render(<TeamSearch required tooltip="Filter by name" shortcut="⌘K" hint="This is a hint text to help user." />);
    const input = screen.getByRole('combobox', { name: 'Search' }) as HTMLInputElement;
    expect(input.placeholder).toBe('Search');
    const frame = input.parentElement;
    expect(classesOf(frame)).toEqual(expect.arrayContaining(['rounded-md', 'border-primary', 'bg-primary', 'shadow-xs', 'px-lg', 'py-md']));
    expect(frame?.querySelector('[data-icon="search-lg"]')).not.toBeNull();
    expect(classesOf(screen.getByText('⌘K'))).toEqual(
      expect.arrayContaining(['rounded-xs', 'border-secondary', 'px-xs', 'text-xs', 'font-medium', 'text-quaternary']),
    );
    expect(input.getAttribute('aria-describedby')).toContain(screen.getByText('This is a hint text to help user.').id);
  });

  it('filters as you type, moves with arrows and selects with Enter', async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    const ref = createRef<HTMLInputElement>();
    render(<TeamSearch ref={ref} onSelectionChange={onSelectionChange} />);
    await user.tab();
    expect(document.activeElement).toBe(ref.current);
    await user.keyboard('la');
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getAllByRole('option').map(o => o.textContent)).toEqual(['Lana Steiner@lana']);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelectionChange).toHaveBeenLastCalledWith('lana');
    expect(ref.current?.value).toBe('Lana Steiner');
  });

  it('closes with Escape', async () => {
    const user = userEvent.setup();
    render(<TeamSearch />);
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('o');
    expect(await screen.findByRole('listbox')).toBeDefined();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('has no axe violations', async () => {
    const { container } = render(<TeamSearch required tooltip="Help" shortcut="⌘K" hint="Hint" />);
    await expectNoAxeViolations(container);
  });
});
