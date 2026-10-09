import gallery from './SectionHeader.gallery';
import { render, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Button } from '../Button';
import { Menu } from '../Menu';
import { Icon } from '../primitives';
import { SectionHeader } from '.';

describe('SectionHeader', () => {
  it('renders the main component: a title and a tertiary icon-only action, no divider', async () => {
    const { container } = render(
      <SectionHeader>
        <SectionHeader.Title>Table</SectionHeader.Title>
        <SectionHeader.Actions>
          <Button size="md" hierarchy="tertiary" iconOnly iconLeading={<Icon name="placeholder" />}>
            More
          </Button>
        </SectionHeader.Actions>
      </SectionHeader>,
    );
    const header = screen.getByRole('banner');
    expect(header.className).toBe('flex flex-col gap-2xl');
    const [content, ...rest] = Array.from(header.children);
    expect(rest).toHaveLength(0);
    expect(content?.className).toBe('flex items-start gap-xl');
    const [text, actions] = Array.from(content!.children);
    expect(text?.className).toBe('flex min-w-0 flex-1 flex-col justify-center gap-xxs self-stretch');
    const title = screen.getByRole('heading', { level: 2, name: 'Table' });
    expect(title.className.split(' ')).toEqual(expect.arrayContaining(['text-lg', 'font-semibold', 'text-primary']));
    expect(actions?.className).toBe('flex items-center gap-lg');
    expect(within(actions as HTMLElement).getByRole('button', { name: 'More' })).toBeDefined();
    await expectNoAxeViolations(container);
  });

  it('places slots in design order: text column, actions, dropdown, then the divider', async () => {
    const { container } = render(
      <SectionHeader divider>
        <SectionHeader.Dropdown>
          <Menu label="Section options">
            <Menu.Item id="refresh">Refresh</Menu.Item>
          </Menu>
        </SectionHeader.Dropdown>
        <SectionHeader.Actions>
          <Button size="md" hierarchy="secondary">
            Export
          </Button>
        </SectionHeader.Actions>
        <SectionHeader.Title as="h3">Nodes</SectionHeader.Title>
        <SectionHeader.SupportingContent>All nodes in the tree.</SectionHeader.SupportingContent>
      </SectionHeader>,
    );
    const header = screen.getByRole('banner');
    const [content, rule] = Array.from(header.children);
    const [text, actions, dropdown] = Array.from(content!.children);
    expect(text?.firstElementChild?.tagName).toBe('H3');
    expect(text?.lastElementChild?.textContent).toBe('All nodes in the tree.');
    expect(text?.lastElementChild?.className).toBe('flex text-sm text-tertiary');
    expect(actions?.textContent).toBe('Export');
    expect(within(dropdown as HTMLElement).getByRole('button', { name: 'Section options' })).toBeDefined();
    expect(rule?.tagName).toBe('HR');
    expect(rule?.className).toBe('border-secondary');
    await expectNoAxeViolations(container);
  });

  it('passes DOM props, className and ref through', () => {
    const ref = createRef<HTMLElement>();
    const slotRef = createRef<HTMLDivElement>();
    render(
      <SectionHeader ref={ref} className="px-3xl" data-testid="header" aria-label="Nodes section">
        <SectionHeader.Title className="truncate">Nodes</SectionHeader.Title>
        <SectionHeader.Actions ref={slotRef} className="ml-auto" />
      </SectionHeader>,
    );
    const header = screen.getByTestId('header');
    expect(ref.current).toBe(header);
    expect(header.className).toBe('flex flex-col gap-2xl px-3xl');
    expect(header.getAttribute('aria-label')).toBe('Nodes section');
    expect(screen.getByRole('heading').className).toContain('truncate');
    expect(slotRef.current?.className).toBe('flex items-center gap-lg ml-auto');
  });
});

describe('SectionHeader under the dark theme', () => {
  it('renders its gallery examples with no axe violations', async () => {
    const dark = gallery.examples.filter(e => e.figma.endsWith('Color Mode=Dark'));
    expect(dark.length).toBeGreaterThan(0);
    const { container } = render(<div>{dark.map(e => <section key={e.figma} aria-label={e.figma}>{e.render()}</section>)}</div>);
    expect(container.querySelectorAll('[data-theme="dark"]')).toHaveLength(dark.length);
    await expectNoAxeViolations(container);
  });
});
