import gallery from './NodeCell.gallery';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { Badge } from '../../Badge';
import { Table } from '../../Table';
import { NodeCell, figmaNodeCell } from '.';

const classesOf = (el: Element | null) => el?.getAttribute('class')?.split(' ') ?? [];

describe('NodeCell', () => {
  it('renders the Figma default inside Table.Cell', async () => {
    const { name, meta } = figmaNodeCell.defaults;
    const { container } = render(
      <Table>
        <Table.Body>
          <Table.Row>
            <Table.Cell>
              <NodeCell name={name} meta={meta} expandable expanded />
            </Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table>,
    );
    expect(classesOf(screen.getByText(name))).toEqual(expect.arrayContaining(['text-sm', 'font-medium', 'text-primary']));
    expect(classesOf(screen.getByText(meta))).toEqual(expect.arrayContaining(['text-sm', 'font-regular', 'text-tertiary']));
    expect(classesOf(screen.getByText(name).parentElement?.parentElement ?? null)).toEqual(
      expect.arrayContaining(['flex', 'items-center', 'gap-md']),
    );
    expect(screen.getByRole('button', { name: 'Collapse' }).getAttribute('aria-expanded')).toBe('true');
    await expectNoAxeViolations(container);
  });

  it.each([0, 1, 3])('indents depth %i by depth × spacing-2xl', depth => {
    const { container } = render(<NodeCell name="Team View" depth={depth} />);
    const indent = container.querySelector<HTMLElement>('[data-slot=indent]');
    expect(indent?.style.width).toBe(`calc(var(--spacing-2xl) * ${depth})`);
  });

  it('places badges after the name, outside its truncation', async () => {
    const { container } = render(<NodeCell name="Files" meta="FRAME · 12:345" badges={<Badge color="error">Removed</Badge>} />);
    const badge = screen.getByText('Removed');
    expect(badge.previousElementSibling?.textContent).toBe('Files');
    expect(classesOf(badge.parentElement)).toEqual(expect.arrayContaining(['flex', 'items-center', 'gap-md', 'min-w-0']));
    expect(classesOf(screen.getByText('Files'))).toContain('truncate');
    await expectNoAxeViolations(container);
  });

  it('shows the chevron only when expandable', () => {
    const { rerender } = render(<NodeCell name="Leaf" />);
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<NodeCell name="Branch" expandable />);
    const toggle = screen.getByRole('button', { name: 'Expand' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.querySelector('svg')).not.toBeNull();
  });

  it('calls onToggle with the next expanded state', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { rerender } = render(<NodeCell name="Branch" expandable onToggle={onToggle} toggleLabel="Toggle Branch" />);
    await user.click(screen.getByRole('button', { name: 'Toggle Branch' }));
    expect(onToggle).toHaveBeenLastCalledWith(true);
    rerender(<NodeCell name="Branch" expandable expanded onToggle={onToggle} toggleLabel="Toggle Branch" />);
    await user.keyboard('{Enter}');
    expect(onToggle).toHaveBeenLastCalledWith(false);
  });
});

describe('NodeCell under the dark theme', () => {
  it('renders its gallery examples with no axe violations', async () => {
    const dark = gallery.examples.filter(e => e.figma.endsWith('Color Mode=Dark'));
    expect(dark.length).toBeGreaterThan(0);
    const { container } = render(<div>{dark.map(e => <section key={e.figma} aria-label={e.figma}>{e.render()}</section>)}</div>);
    expect(container.querySelectorAll('[data-theme="dark"]')).toHaveLength(dark.length);
    await expectNoAxeViolations(container);
  });
});
