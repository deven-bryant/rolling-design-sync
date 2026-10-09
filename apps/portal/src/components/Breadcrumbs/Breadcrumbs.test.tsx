import gallery from './Breadcrumbs.gallery';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Breadcrumbs } from '.';

function Trail(props: { onNavigate?: (href: string) => void }) {
  return (
    <Breadcrumbs {...props}>
      <Breadcrumbs.Item home href="/">
        Home
      </Breadcrumbs.Item>
      <Breadcrumbs.Item href="/settings">Settings</Breadcrumbs.Item>
      <Breadcrumbs.Item>Team</Breadcrumbs.Item>
    </Breadcrumbs>
  );
}

describe('Breadcrumbs', () => {
  it('renders a labelled nav with an ordered trail and chevron separators', async () => {
    const { container } = render(<Trail />);
    const nav = screen.getByRole('navigation', { name: 'Breadcrumbs' });
    expect(nav.querySelector('ol')?.className).toContain('gap-xs');
    expect(nav.querySelectorAll('li')).toHaveLength(3);
    expect(nav.querySelectorAll('[data-icon="chevron-right"]')).toHaveLength(2);
    await expectNoAxeViolations(container);
  });

  it('renders the home item icon-only with an accessible name', () => {
    render(<Trail />);
    const home = screen.getByRole('link', { name: 'Home' });
    expect(home.querySelector('[data-icon="home-line"]')).not.toBeNull();
    expect(home.className).toContain('p-xs');
  });

  it('marks the last item as the current page', () => {
    render(<Trail />);
    const current = screen.getByText('Team');
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(current.className).toContain('bg-primary_hover');
    expect(current.className).toContain('text-tertiary_hover');
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('aria-current')).toBeNull();
  });

  it('is keyboard reachable and navigates through onNavigate', async () => {
    const onNavigate = vi.fn();
    render(<Trail onNavigate={onNavigate} />);
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Home' }));
    await user.tab();
    const settings = screen.getByRole('link', { name: 'Settings' });
    expect(document.activeElement).toBe(settings);
    expect(settings.getAttribute('data-focus-visible')).toBe('true');
    await user.keyboard('{Enter}');
    expect(onNavigate).toHaveBeenCalledWith('/settings', undefined);
  });

  it('applies the breadcrumb button variants', () => {
    render(<Trail />);
    const settings = screen.getByRole('link', { name: 'Settings' });
    expect(settings.className).toContain('px-md py-xs');
    expect(settings.className).toContain('text-quaternary');
  });

  it('forwards ref and className to the nav', () => {
    const ref = createRef<HTMLElement>();
    render(
      <Breadcrumbs ref={ref} className="mb-xl" label="Path">
        <Breadcrumbs.Item>Only</Breadcrumbs.Item>
      </Breadcrumbs>,
    );
    const nav = screen.getByRole('navigation', { name: 'Path' });
    expect(ref.current).toBe(nav);
    expect(nav.className).toBe('mb-xl');
  });
});

describe('Breadcrumbs under the dark theme', () => {
  it('renders its gallery examples with no axe violations', async () => {
    const dark = gallery.examples.filter(e => e.figma.endsWith('Color Mode=Dark'));
    expect(dark.length).toBeGreaterThan(0);
    const { container } = render(<div>{dark.map(e => <section key={e.figma} aria-label={e.figma}>{e.render()}</section>)}</div>);
    expect(container.querySelectorAll('[data-theme="dark"]')).toHaveLength(dark.length);
    await expectNoAxeViolations(container);
  });
});
