import gallery from './PageHeader.gallery';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Breadcrumbs } from '../Breadcrumbs';
import { PageHeader } from '.';

describe('PageHeader', () => {
  it('lays out breadcrumbs, text, actions and divider in the design order', async () => {
    const { container } = render(
      <PageHeader divider>
        <PageHeader.Actions>
          <button type="button">Invite</button>
        </PageHeader.Actions>
        <PageHeader.Title>Team members</PageHeader.Title>
        <PageHeader.Description>Manage your team.</PageHeader.Description>
        <PageHeader.Breadcrumbs>
          <Breadcrumbs>
            <Breadcrumbs.Item home href="/">
              Home
            </Breadcrumbs.Item>
            <Breadcrumbs.Item>Team</Breadcrumbs.Item>
          </Breadcrumbs>
        </PageHeader.Breadcrumbs>
      </PageHeader>,
    );
    const header = screen.getByRole('banner');
    expect(header.className).toBe('flex flex-col gap-xl');
    const [crumbs, content, rule] = Array.from(header.children);
    expect(crumbs?.querySelector('nav')).not.toBeNull();
    expect(content?.querySelector('h1')?.textContent).toBe('Team members');
    expect(content?.lastElementChild?.textContent).toBe('Invite');
    expect(rule?.tagName).toBe('HR');
    expect(rule?.className).toBe('border-secondary');
    await expectNoAxeViolations(container);
  });

  it('styles title and description with the design type styles', () => {
    render(
      <PageHeader>
        <PageHeader.Title>Files</PageHeader.Title>
        <PageHeader.Description>All synced files.</PageHeader.Description>
      </PageHeader>,
    );
    const title = screen.getByRole('heading', { level: 1, name: 'Files' });
    expect(title.className).toContain('text-display-xs');
    expect(title.className).toContain('font-semibold');
    expect(title.className).toContain('text-primary');
    const description = screen.getByText('All synced files.');
    expect(description.tagName).toBe('P');
    expect(description.className).toContain('text-md');
    expect(description.className).toContain('text-tertiary');
    expect(title.parentElement?.className).toContain('gap-xs');
  });

  it('omits the divider by default', () => {
    const { container } = render(
      <PageHeader>
        <PageHeader.Title>Files</PageHeader.Title>
      </PageHeader>,
    );
    expect(container.querySelector('hr')).toBeNull();
  });

  it('forwards ref, className and DOM props', () => {
    const ref = createRef<HTMLElement>();
    render(
      <PageHeader ref={ref} className="pb-xl" data-testid="ph">
        <PageHeader.Actions className="ml-auto" data-testid="actions" />
      </PageHeader>,
    );
    expect(ref.current).toBe(screen.getByTestId('ph'));
    expect(ref.current?.className).toContain('pb-xl');
    expect(screen.getByTestId('actions').className).toBe('flex items-center gap-lg ml-auto');
  });
});

describe('PageHeader under the dark theme', () => {
  it('renders its gallery examples with no axe violations', async () => {
    const dark = gallery.examples.filter(e => e.figma.endsWith('Color Mode=Dark'));
    expect(dark.length).toBeGreaterThan(0);
    const { container } = render(<div>{dark.map(e => <section key={e.figma} aria-label={e.figma}>{e.render()}</section>)}</div>);
    expect(container.querySelectorAll('[data-theme="dark"]')).toHaveLength(dark.length);
    await expectNoAxeViolations(container);
  });
});
