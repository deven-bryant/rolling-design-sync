import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Menu } from '../Menu';
import { SidebarNav } from '.';

function Example({ onNavigate, onDismiss }: { onNavigate?: (href: string) => void; onDismiss?: () => void }) {
  return (
    <SidebarNav onNavigate={onNavigate}>
      <SidebarNav.Header>
        <span>Logo</span>
        <SidebarNav.Search aria-label="Search">
          <input aria-label="Search" />
        </SidebarNav.Search>
      </SidebarNav.Header>
      <SidebarNav.Section aria-label="Primary">
        <SidebarNav.Item href="/dashboard" icon="bar-chart-square-02" current badge={<span>10</span>}>
          Dashboard
        </SidebarNav.Item>
        <SidebarNav.Item icon="home-line" items={<SidebarNav.Item href="/projects/all">All projects</SidebarNav.Item>}>
          Projects
        </SidebarNav.Item>
      </SidebarNav.Section>
      <SidebarNav.Footer data-testid="footer">
        <SidebarNav.Section aria-label="Secondary">
          <SidebarNav.Item href="/support" icon="help-circle">
            Support
          </SidebarNav.Item>
        </SidebarNav.Section>
        <SidebarNav.FeatureCard title="Used space" onDismiss={onDismiss}>
          Your team has used 80% of your available space.
        </SidebarNav.FeatureCard>
        <SidebarNav.Account menu={<Menu.Item id="sign-out">Sign out</Menu.Item>}>
          <span>Olivia Rhye</span>
        </SidebarNav.Account>
      </SidebarNav.Footer>
    </SidebarNav>
  );
}

describe('SidebarNav', () => {
  it('renders the Simple desktop sidebar as a labelled nav landmark', async () => {
    const { container } = render(<Example />);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(nav.className).toContain('w-74');
    expect(nav.className).toContain('border-r border-secondary bg-primary pt-3xl');
    expect(screen.getByRole('search')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Primary' }).className).toContain('px-xl');
    expect(screen.getByRole('list', { name: 'Secondary' }).className).not.toContain('px-xl');
    expect(screen.getByTestId('footer').className).toContain('mt-auto');
    await expectNoAxeViolations(container);
  });

  it('marks the current item with aria-current and the current style', () => {
    render(<Example />);
    const current = screen.getByRole('link', { name: /Dashboard/ });
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(current.className).toContain('bg-active');
    expect(current.querySelector('[data-icon="bar-chart-square-02"]')).not.toBeNull();
    expect(current.textContent).toBe('Dashboard10');
    const other = screen.getByRole('link', { name: 'Support' });
    expect(other.getAttribute('aria-current')).toBeNull();
    expect(other.className).toContain('bg-primary');
    expect(other.parentElement?.className).toBe('py-xxs');
  });

  it('routes item links through onNavigate', async () => {
    const onNavigate = vi.fn();
    render(<Example onNavigate={onNavigate} />);
    await userEvent.setup().click(screen.getByRole('link', { name: 'Support' }));
    expect(onNavigate.mock.calls[0]?.[0]).toBe('/support');
  });

  it('expands a dropdown item from the keyboard', async () => {
    const onNavigate = vi.fn();
    render(<Example onNavigate={onNavigate} />);
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'Projects' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.querySelector('[data-icon="chevron-down"]')).not.toBeNull();
    expect(screen.queryByRole('link', { name: 'All projects' })).toBeNull();
    await user.tab();
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(trigger);
    await user.keyboard('{Enter}');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    await user.tab();
    const sub = screen.getByRole('link', { name: 'All projects' });
    expect(document.activeElement).toBe(sub);
    await user.keyboard('{Enter}');
    expect(onNavigate.mock.calls[0]?.[0]).toBe('/projects/all');
  });

  it('renders the featured card and dismisses it', async () => {
    const onDismiss = vi.fn();
    render(<Example onDismiss={onDismiss} />);
    const title = screen.getByText('Used space');
    const card = title.closest('div.relative');
    expect(card?.className).toContain('rounded-xl bg-secondary p-xl');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('renders the account card with an account menu', async () => {
    render(<Example />);
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'Account menu' });
    expect(trigger.closest('div.relative')?.className).toContain('border-secondary bg-primary_alt p-lg');
    expect(trigger.querySelector('[data-icon="chevron-selector-vertical"]')).not.toBeNull();
    await user.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeTruthy();
  });

  it('forwards ref, aria-label and className', () => {
    const ref = createRef<HTMLElement>();
    render(<SidebarNav ref={ref} aria-label="Settings" className="w-auto" />);
    const nav = screen.getByRole('navigation', { name: 'Settings' });
    expect(ref.current).toBe(nav);
    expect(nav.className).toContain('w-auto');
    expect(nav.className).not.toContain('w-74');
  });
});
