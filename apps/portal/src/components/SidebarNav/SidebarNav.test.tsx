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
      <SidebarNav.Header actions={<button type="button">Toggle theme</button>}>
        <span>Logo</span>
        <SidebarNav.Search aria-label="Search">
          <input aria-label="Search" />
        </SidebarNav.Search>
      </SidebarNav.Header>
      <SidebarNav.Section aria-label="Primary">
        <SidebarNav.Item href="/dashboard" icon="bar-chart-square-02" current badge={<span>10</span>}>
          Dashboard
        </SidebarNav.Item>
        <SidebarNav.Item href="/projects" icon="home-line">
          Projects
        </SidebarNav.Item>
      </SidebarNav.Section>
      <SidebarNav.Footer data-testid="footer">
        <SidebarNav.Section aria-label="Secondary">
          <SidebarNav.Item href="/support" icon="help-circle">
            Support
          </SidebarNav.Item>
        </SidebarNav.Section>
        <SidebarNav.FeatureCard title="API connected" onDismiss={onDismiss}>
          Agents read this server through rds-mcp.
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

  it('renders nav items as plain links, without chevrons or expand behavior', () => {
    const { container } = render(<Example />);
    const item = screen.getByRole('link', { name: 'Projects' });
    expect(item.getAttribute('aria-expanded')).toBeNull();
    expect(container.querySelector('[data-icon="chevron-down"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Projects' })).toBeNull();
  });

  it('puts header actions right of the product name', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    render(
      <SidebarNav>
        <SidebarNav.Header data-testid="header" actions={<button type="button" onClick={onPress}>Toggle theme</button>}>
          <span>Rolling Design Sync</span>
        </SidebarNav.Header>
      </SidebarNav>,
    );
    const header = screen.getByTestId('header');
    expect(header.className).toContain('flex items-start gap-lg px-2xl');
    const [name, actions] = Array.from(header.children);
    expect(name?.textContent).toBe('Rolling Design Sync');
    expect(actions?.className).toContain('h-8 shrink-0 items-center');
    await user.click(screen.getByRole('button', { name: 'Toggle theme' }));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('renders no actions wrapper without actions', () => {
    render(
      <SidebarNav>
        <SidebarNav.Header data-testid="header">
          <span>Logo</span>
        </SidebarNav.Header>
      </SidebarNav>,
    );
    expect(screen.getByTestId('header').children).toHaveLength(1);
  });

  it('renders the featured card and dismisses it', async () => {
    const onDismiss = vi.fn();
    render(<Example onDismiss={onDismiss} />);
    const title = screen.getByText('API connected');
    const card = title.closest('div.relative');
    expect(card?.className).toContain('rounded-xl bg-secondary p-xl');
    expect(card?.querySelector('[role="progressbar"]')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('renders the account card with an account menu', async () => {
    render(<Example />);
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'Account menu' });
    expect(trigger.closest('div.relative')?.className).toContain('border-secondary bg-primary_alt p-lg pr-5xl');
    expect(trigger.className).toContain('absolute top-md right-md');
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

  it('renders under the dark theme with no axe violations', async () => {
    const { container } = render(
      <div data-theme="dark">
        <Example />
      </div>,
    );
    expect(screen.getByRole('navigation', { name: 'Main' }).className).toContain('bg-primary');
    await expectNoAxeViolations(container);
  });
});
