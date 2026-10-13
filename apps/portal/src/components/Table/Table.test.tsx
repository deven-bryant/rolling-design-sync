import { fireEvent, render, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Avatar } from '../Avatar';
import { Badge } from '../Badge';
import { ButtonUtility } from '../Button';
import { Icon } from '../primitives';
import {
  ActionsCell,
  AvatarCell,
  BadgeCell,
  BadgesCell,
  FileTypeCell,
  LeadAction,
  LeadActionCell,
  ProgressCell,
  Table,
  TextCell,
} from '.';
import { describeGalleryInThemes } from '../../test/theme';
import gallery from './Table.gallery';

function renderTable(row: React.ReactNode, header: React.ReactNode = <Table.HeaderCell>Name</Table.HeaderCell>) {
  return render(
    <Table aria-label="Members">
      <Table.Header>{header}</Table.Header>
      <Table.Body>{row}</Table.Body>
    </Table>,
  );
}

describe('Table', () => {
  it('renders a semantic table with header and body', async () => {
    const tableRef = createRef<HTMLTableElement>();
    const { container } = render(
      <Table ref={tableRef} aria-label="Members" className="table-fixed">
        <Table.Header>
          <Table.HeaderCell className="w-80">Name</Table.HeaderCell>
          <Table.HeaderCell>Status</Table.HeaderCell>
        </Table.Header>
        <Table.Body>
          <Table.Row>
            <TextCell supportingText="olivia@untitledui.com">Olivia Rhye</TextCell>
            <BadgeCell>
              <Badge color="success">Active</Badge>
            </BadgeCell>
          </Table.Row>
        </Table.Body>
      </Table>,
    );
    const table = screen.getByRole('table', { name: 'Members' });
    expect(tableRef.current).toBe(table);
    expect(table.className).toContain('table-fixed');
    const headers = screen.getAllByRole('columnheader');
    expect(headers.map(h => h.textContent)).toEqual(['Name', 'Status']);
    expect(headers[0]?.className).toContain('w-80');
    expect(headers[0]?.className).toContain('h-11');
    const cells = screen.getAllByRole('cell');
    expect(cells[0]?.textContent).toBe('Olivia Rhyeolivia@untitledui.com');
    expect(cells[0]?.className).toContain('px-3xl');
    expect(within(cells[1]!).getByText('Active')).toBeDefined();
    await expectNoAxeViolations(container);
  });

  it('header cell: checkbox slot, sort button, arrow slot and aria-sort', async () => {
    const onSort = vi.fn();
    const { container } = renderTable(
      <Table.Row>
        <TextCell>Olivia Rhye</TextCell>
      </Table.Row>,
      <Table.HeaderCell
        checkbox={<LeadAction aria-label="Select all" />}
        sortDirection="ascending"
        onSort={onSort}
        arrow={<span data-testid="arrow" />}
      >
        Name
      </Table.HeaderCell>,
    );
    const header = screen.getByRole('columnheader');
    expect(header.getAttribute('aria-sort')).toBe('ascending');
    expect(within(header).getByRole('checkbox', { name: 'Select all' })).toBeDefined();
    fireEvent.click(within(header).getByRole('button', { name: 'Name' }));
    expect(onSort).toHaveBeenCalledOnce();
    expect(within(header).getByTestId('arrow')).toBeDefined();
    await expectNoAxeViolations(container);
  });

  it('row: selected state (State=Hover/selected) and hover fill', () => {
    renderTable(
      <Table.Row selected data-testid="row">
        <TextCell>Olivia Rhye</TextCell>
      </Table.Row>,
    );
    const row = screen.getByTestId('row');
    expect(row.getAttribute('aria-selected')).toBe('true');
    expect(row.hasAttribute('data-selected')).toBe(true);
    expect(row.className).toContain('hover:bg-secondary');
    expect(row.className).toContain('data-[selected]:bg-secondary');
  });

  it('row: onAction on click and Enter / Space, not on inner controls', () => {
    const onAction = vi.fn();
    const rowRef = createRef<HTMLTableRowElement>();
    renderTable(
      <Table.Row ref={rowRef} onAction={onAction}>
        <TextCell leadAction={<LeadAction aria-label="Select Olivia Rhye" />}>Olivia Rhye</TextCell>
      </Table.Row>,
    );
    const row = rowRef.current!;
    expect(row.tabIndex).toBe(0);
    fireEvent.click(screen.getByText('Olivia Rhye'));
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    expect(onAction).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Olivia Rhye' }));
    expect(onAction).toHaveBeenCalledTimes(3);
  });

  it('lead action: toggles its checkbox', () => {
    const onChange = vi.fn();
    renderTable(
      <Table.Row>
        <LeadActionCell>
          <LeadAction aria-label="Select row" onChange={onChange} />
        </LeadActionCell>
      </Table.Row>,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select row' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('Type=Badges multiple: folds the rest into a +N badge', async () => {
    const badges = ['Design', 'Product', 'Marketing', 'Sales', 'Ops'].map(b => <Badge key={b}>{b}</Badge>);
    const { container } = renderTable(
      <Table.Row>
        <BadgesCell badges={badges} max={3} />
      </Table.Row>,
    );
    const cell = screen.getByRole('cell');
    expect(within(cell).queryByText('Sales')).toBeNull();
    expect(within(cell).getByText('+2')).toBeDefined();
    await expectNoAxeViolations(container);
  });

  it('Type=Badges multiple: shows every badge without max', () => {
    renderTable(
      <Table.Row>
        <BadgesCell badges={['A', 'B'].map(b => <Badge key={b}>{b}</Badge>)} overflowLabel={n => `${n} more`} />
      </Table.Row>,
    );
    expect(screen.getByRole('cell').textContent).toBe('AB');
  });

  it('Type=Progress bar: a labelled progress bar with its percentage', async () => {
    const { container } = renderTable(
      <Table.Row>
        <ProgressCell value={60} label="Onboarding" />
      </Table.Row>,
    );
    const bar = screen.getByRole('progressbar', { name: 'Onboarding' });
    expect(bar.getAttribute('aria-valuenow')).toBe('60');
    expect(screen.getByText('60%')).toBeDefined();
    await expectNoAxeViolations(container);
  });

  it('avatar and actions cells', async () => {
    const { container } = renderTable(
      <Table.Row>
        <AvatarCell avatar={<span role="img" aria-label="Olivia Rhye avatar" />} supportingText="@olivia">
          Olivia Rhye
        </AvatarCell>
        <ActionsCell>
          <button type="button">Edit</button>
        </ActionsCell>
      </Table.Row>,
      <>
        <Table.HeaderCell>Name</Table.HeaderCell>
        <Table.HeaderCell>Actions</Table.HeaderCell>
      </>,
    );
    expect(screen.getByRole('img', { name: 'Olivia Rhye avatar' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDefined();
    await expectNoAxeViolations(container);
  });

  it('Type=Avatar: an md avatar, text and supporting text with 12px gaps', async () => {
    const { container } = renderTable(
      <Table.Row>
        <AvatarCell avatar={<Avatar size="md" alt="Olivia Rhye" initials="OR" />} supportingText="olivia@untitledui.com">
          Olivia Rhye
        </AvatarCell>
      </Table.Row>,
    );
    const cell = screen.getByRole('cell');
    expect(cell.className).toBe('h-18 border-b border-secondary px-3xl py-xl align-middle');
    const row = cell.firstElementChild!;
    expect(row.className).toBe('flex items-center gap-lg');
    expect(within(cell).getByRole('img', { name: 'Olivia Rhye' }).className).toContain('size-10');
    expect(within(cell).getByText('Olivia Rhye').className).toContain('font-medium');
    expect(within(cell).getByText('olivia@untitledui.com').className).toContain('text-tertiary');
    await expectNoAxeViolations(container);
  });

  it('Type=Action icons: xs tertiary button utilities, 2px apart, in a hugging 16px-padded cell', async () => {
    const { container } = renderTable(
      <Table.Row>
        <ActionsCell>
          {(['Copy', 'Edit', 'Share', 'Delete'] as const).map(label => (
            <ButtonUtility key={label} size="xs" hierarchy="tertiary" icon={<Icon name="placeholder" />} tooltip={label} />
          ))}
        </ActionsCell>
      </Table.Row>,
      <Table.HeaderCell text={false}>Actions</Table.HeaderCell>,
    );
    const cell = screen.getByRole('cell');
    expect(cell.className).toContain('w-0');
    expect(cell.className).toContain('px-xl');
    expect(cell.className).toContain('py-xl');
    expect(cell.firstElementChild?.className).toBe('flex items-center gap-xxs');
    expect(within(cell).getAllByRole('button')).toHaveLength(4);
    await expectNoAxeViolations(container);
  });

  it('header Text=False: an empty header cell, named for assistive tech only', async () => {
    const { container } = renderTable(
      <Table.Row>
        <TextCell>Olivia Rhye</TextCell>
        <TextCell>Edit</TextCell>
      </Table.Row>,
      <>
        <Table.HeaderCell>Name</Table.HeaderCell>
        <Table.HeaderCell text={false} data-testid="empty">
          Actions
        </Table.HeaderCell>
      </>,
    );
    const header = screen.getByTestId('empty');
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBe(header);
    expect(header.className).toBe('h-11 border-b border-secondary bg-primary px-3xl py-lg align-middle');
    expect(header.firstElementChild?.className).toBe('sr-only');
    expect(header.querySelector('button')).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('Type=File type icon: a labelled Simple / Empty page, optional text, and nothing without a label', async () => {
    const { container } = renderTable(
      <Table.Row>
        <FileTypeCell label="2 open notes" />
        <FileTypeCell label="PDF file" fileType="pdf" supportingText="200 KB">
          Tech requirements.pdf
        </FileTypeCell>
        <FileTypeCell />
      </Table.Row>,
      <>
        <Table.HeaderCell>Notes</Table.HeaderCell>
        <Table.HeaderCell>File</Table.HeaderCell>
        <Table.HeaderCell>Empty</Table.HeaderCell>
      </>,
    );
    const [notes, file, empty] = screen.getAllByRole('cell') as [HTMLElement, HTMLElement, HTMLElement];
    expect(within(notes).getByRole('img', { name: '2 open notes' }).textContent).toBe('');
    expect(within(file).getByRole('img', { name: 'PDF file' }).textContent).toBe('PDF');
    expect(file.textContent).toContain('Tech requirements.pdf');
    expect(file.textContent).toContain('200 KB');
    expect(within(empty).queryByRole('img')).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('cells pass DOM props, className and ref to the <td>', () => {
    const ref = createRef<HTMLTableCellElement>();
    renderTable(
      <Table.Row>
        <TextCell ref={ref} className="w-60" data-testid="cell">
          Olivia Rhye
        </TextCell>
      </Table.Row>,
    );
    const cell = screen.getByTestId('cell');
    expect(ref.current).toBe(cell);
    expect(cell.tagName).toBe('TD');
    expect(cell.className).toContain('w-60');
  });
});

describeGalleryInThemes(gallery);
