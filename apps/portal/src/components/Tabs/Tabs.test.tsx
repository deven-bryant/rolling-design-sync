import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Tabs, type TabsProps } from '.';

function Example(props: Omit<TabsProps, 'children'>) {
  return (
    <Tabs {...props}>
      <Tabs.List aria-label="Sections">
        <Tabs.Tab id="details">My details</Tabs.Tab>
        <Tabs.Tab id="profile" badge={<span>2</span>}>
          Profile
        </Tabs.Tab>
        <Tabs.Tab id="team">Team</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel id="details">Details panel</Tabs.Panel>
      <Tabs.Panel id="profile">Profile panel</Tabs.Panel>
      <Tabs.Panel id="team">Team panel</Tabs.Panel>
    </Tabs>
  );
}

describe('Tabs', () => {
  it('renders the underline md variant by default', async () => {
    const { container } = render(<Example />);
    const list = screen.getByRole('tablist', { name: 'Sections' });
    expect(list.className).toContain('border-b border-secondary');
    expect(list.className).toContain('gap-lg');
    const selected = screen.getByRole('tab', { name: 'My details' });
    expect(selected.getAttribute('aria-selected')).toBe('true');
    expect(selected.className).toContain('text-md');
    expect(selected.className).toContain('data-selected:border-fg-brand-primary_alt');
    expect(screen.getByRole('tabpanel').textContent).toBe('Details panel');
    await expectNoAxeViolations(container);
  });

  it('renders the button-gray sm variant', async () => {
    const { container } = render(<Example type="button-gray" size="sm" />);
    expect(screen.getByRole('tablist').className).toContain('gap-xs');
    const tab = screen.getByRole('tab', { name: 'My details' });
    expect(tab.className).toContain('text-sm');
    expect(tab.className).toContain('rounded-sm px-lg py-md');
    expect(tab.className).toContain('data-selected:bg-active');
    await expectNoAxeViolations(container);
  });

  it('renders the button-gray md variant: 44px tabs, current on bg-active, others quaternary', async () => {
    const { container } = render(<Example type="button-gray" size="md" />);
    expect(screen.getByRole('tablist').className).toContain('gap-xs');
    const current = screen.getByRole('tab', { name: 'My details' });
    const other = screen.getByRole('tab', { name: 'Team' });
    expect(current.getAttribute('aria-selected')).toBe('true');
    expect(other.getAttribute('aria-selected')).toBe('false');
    for (const tab of [current, other]) {
      const classes = tab.className.split(' ');
      expect(classes).toEqual(expect.arrayContaining(['h-11', 'text-md', 'font-semibold', 'gap-md', 'rounded-sm', 'px-lg', 'py-md']));
      expect(classes).not.toContain('h-9');
      expect(classes).toEqual(expect.arrayContaining(['text-quaternary', 'data-selected:bg-active', 'data-selected:text-secondary']));
    }
    expect(current.hasAttribute('data-selected')).toBe(true);
    expect(other.hasAttribute('data-selected')).toBe(false);
    await expectNoAxeViolations(container);
  });

  it('keeps sm button-gray and underline tabs 36px', () => {
    const { unmount } = render(<Example type="button-gray" size="sm" />);
    expect(screen.getByRole('tab', { name: 'My details' }).className).toContain('h-9');
    unmount();
    render(<Example />);
    expect(screen.getByRole('tab', { name: 'My details' }).className).toContain('h-9');
  });

  it('renders a tab badge after the label', () => {
    render(<Example />);
    expect(screen.getByRole('tab', { name: /^Profile/ }).lastElementChild?.textContent).toBe('2');
  });

  it('moves focus and selection with the arrow keys', async () => {
    render(<Example />);
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'My details' }));
    await user.keyboard('{ArrowRight}');
    const profile = screen.getByRole('tab', { name: /^Profile/ });
    expect(document.activeElement).toBe(profile);
    expect(profile.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('Profile panel');
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Team' }).getAttribute('aria-selected')).toBe('true');
  });

  it('supports controlled (URL-driven) selection', async () => {
    const onChange = vi.fn();
    function Controlled() {
      const [key, setKey] = useState<string>('team');
      return (
        <Example
          selectedKey={key}
          onSelectionChange={k => {
            onChange(k);
            setKey(String(k));
          }}
        />
      );
    }
    render(<Controlled />);
    expect(screen.getByRole('tab', { name: 'Team' }).getAttribute('aria-selected')).toBe('true');
    await userEvent.setup().click(screen.getByRole('tab', { name: 'My details' }));
    expect(onChange).toHaveBeenCalledWith('details');
    expect(screen.getByRole('tab', { name: 'My details' }).getAttribute('aria-selected')).toBe('true');
  });

  it('merges className on every part', () => {
    render(
      <Tabs className="gap-xl" data-testid="tabs">
        <Tabs.List aria-label="L" className="px-xl">
          <Tabs.Tab id="a" className="flex-1">
            A
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel id="a" className="pt-xl">
          Panel
        </Tabs.Panel>
      </Tabs>,
    );
    expect(screen.getByTestId('tabs').className).toBe('flex flex-col gap-xl');
    expect(screen.getByRole('tablist').className).toContain('px-xl');
    expect(screen.getByRole('tab').className).toContain('flex-1');
    expect(screen.getByRole('tabpanel').className).toContain('pt-xl');
  });
});
