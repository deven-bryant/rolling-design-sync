import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Menu } from '.';

describe('Menu', () => {
  it('renders the dots-vertical icon trigger closed', async () => {
    const { container } = render(
      <Menu label="Card actions">
        <Menu.Item id="edit">Edit</Menu.Item>
      </Menu>,
    );
    const trigger = screen.getByRole('button', { name: 'Card actions' });
    expect(trigger.querySelector('[data-icon="dots-vertical"]')).not.toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.className).toContain('text-fg-quaternary');
    expect(screen.queryByRole('menu')).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('opens from the keyboard, focuses the first item and returns focus on Escape', async () => {
    const onAction = vi.fn();
    render(
      <Menu label="Card actions" onAction={onAction}>
        <Menu.Item id="view">View</Menu.Item>
        <Menu.Item id="edit">Edit</Menu.Item>
      </Menu>,
    );
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'Card actions' });
    await user.tab();
    expect(document.activeElement).toBe(trigger);
    await user.keyboard('{Enter}');
    const menu = screen.getByRole('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'View' }));
    await user.keyboard('{ArrowDown}');
    const edit = within(menu).getByRole('menuitem', { name: 'Edit' });
    expect(document.activeElement).toBe(edit);
    expect(edit.firstElementChild?.className).toContain('bg-primary_hover');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'View' })));
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onAction.mock.calls[0]?.[0]).toBe('edit');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('renders menu items with icon and shortcut', async () => {
    render(
      <Menu label="Account" defaultOpen>
        <Menu.Item id="profile" icon="placeholder" shortcut="⌘K->P">
          View profile
        </Menu.Item>
      </Menu>,
    );
    const item = screen.getByRole('menuitem', { name: /View profile/ });
    const inner = item.firstElementChild;
    expect(item.className).toContain('px-sm');
    expect(inner?.className).toContain('p-md');
    expect(inner?.className).toContain('gap-lg');
    expect(item.querySelector('[data-icon="placeholder"]')).not.toBeNull();
    expect(item.querySelector('kbd')?.textContent).toBe('⌘K->P');
    await expectNoAxeViolations(document.body);
  });

  it('renders sections, a separator and account items with the current one checked', async () => {
    render(
      <Menu label="Account" defaultOpen selectionMode="single" defaultSelectedKeys={['olivia']}>
        <Menu.Section aria-label="Actions">
          <Menu.Item id="settings">Settings</Menu.Item>
        </Menu.Section>
        <Menu.Separator />
        <Menu.Section title="Switch account">
          <Menu.Item id="olivia" type="account">
            Olivia Rhye
          </Menu.Item>
          <Menu.Item id="sienna" type="account">
            Sienna Hewitt
          </Menu.Item>
        </Menu.Section>
      </Menu>,
    );
    expect(screen.getAllByRole('group')).toHaveLength(2);
    expect(screen.getByRole('separator').className).toContain('border-secondary');
    expect(screen.getByText('Switch account').className).toContain('text-tertiary');
    const current = screen.getByRole('menuitemradio', { name: 'Olivia Rhye' });
    expect(current.getAttribute('aria-checked')).toBe('true');
    expect(current.firstElementChild?.className).toContain('px-md py-sm');
    expect(current.firstElementChild?.className).toContain('bg-primary_hover');
    expect(current.querySelector('.bg-brand-solid')).not.toBeNull();
    const other = screen.getByRole('menuitemradio', { name: 'Sienna Hewitt' });
    expect(other.getAttribute('aria-checked')).toBe('false');
    await userEvent.setup().click(other);
    expect(screen.queryByRole('menu')).toBeNull();
    await expectNoAxeViolations(document.body);
  });

  it('accepts a custom trigger and merges classNames', () => {
    render(
      <Menu
        label="Options"
        trigger={<button type="button">Open options</button>}
        defaultOpen
        className="py-xs"
        popoverClassName="w-80"
      >
        <Menu.Item id="a" className="mx-xs">
          A
        </Menu.Item>
      </Menu>,
    );
    expect(screen.getByRole('menu').className).toContain('py-xs');
    expect(screen.getByRole('menu').parentElement?.className).toContain('w-80');
    expect(screen.getByRole('menuitem').className).toContain('mx-xs');
  });
});
