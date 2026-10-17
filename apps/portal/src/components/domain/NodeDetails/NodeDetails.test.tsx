import gallery from './NodeDetails.gallery';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { Avatar } from '../../Avatar';
import { Badge } from '../../Badge';
import { Button } from '../../Button';
import { figmaNodeDetails, NodeDetails, type NodeDetailsChange, type NodeDetailsEvent, type NodeDetailsProps } from '.';

const classesOf = (el: Element | null) => el?.getAttribute('class')?.split(' ') ?? [];

const changes: NodeDetailsChange[] = [
  { attribute: 'fills', from: { value: 'bg-primary', detail: '#FFFFFF' }, to: { value: 'bg-secondary', detail: '#F9FAFB' } },
  { attribute: 'itemSpacing', from: { value: 'spacing-md', detail: '8' }, to: { value: 'spacing-lg', detail: '12' } },
];

const history: NodeDetailsEvent[] = [
  { id: 2, avatar: <Avatar size="lg" alt="devin" initials="DE" />, name: 'devin', time: '2 min ago', children: 'Claimed it' },
  { id: 1, avatar: <Avatar size="lg" alt="figma" initials="FI" />, name: 'figma', time: '2 days ago', children: 'Changed fills' },
];

function Example(props: Partial<NodeDetailsProps>) {
  return (
    <NodeDetails
      title="Breadcrumbs"
      description="INSTANCE · 1:2345"
      status={
        <Badge size="md" color="warning">
          Dirty
        </Badge>
      }
      claimSubtitle="devin · claimed 2 min ago"
      claimAction={
        <Button hierarchy="secondary" size="sm">
          Release claim
        </Button>
      }
      changes={changes}
      changesDescription="Since cleared at 3f2a9c1"
      history={history}
      {...props}
    />
  );
}

describe('NodeDetails', () => {
  it('maps the Figma State axis to the state prop', () => {
    expect(figmaNodeDetails.component.nodeId).toBe('50:14271');
    expect(figmaNodeDetails.axes.State['Change List']).toEqual({ nodeId: '50:14270', props: { state: 'change-list' } });
    expect(figmaNodeDetails.axes.State['Change History']).toEqual({ nodeId: '50:14272', props: { state: 'change-history' } });
  });

  it('renders State=Change List: header, status, claim and the changes table', async () => {
    const { container } = render(<Example />);
    expect(classesOf(container.firstElementChild)).toEqual(expect.arrayContaining(['flex-col', 'gap-4xl', 'w-full']));
    expect(classesOf(screen.getByRole('group', { name: 'Status' }))).not.toContain('flex-1');
    const claimText = screen.getByRole('heading', { name: 'Claim Holder', level: 3 }).parentElement;
    expect(classesOf(claimText)).not.toContain('flex-1');
    expect(classesOf(claimText?.parentElement ?? null)).toEqual(expect.arrayContaining(['justify-between', 'gap-4xl']));
    expect(screen.getByRole('heading', { name: 'Breadcrumbs', level: 2 })).toBeTruthy();
    expect(screen.getByText('INSTANCE · 1:2345')).toBeTruthy();
    expect(within(screen.getByRole('group', { name: 'Status' })).getByText('Dirty')).toBeTruthy();
    const claim = screen.getByRole('group', { name: 'Claim Holder' });
    expect(within(claim).getByRole('heading', { name: 'Claim Holder', level: 3 })).toBeTruthy();
    expect(within(claim).getByText('devin · claimed 2 min ago')).toBeTruthy();
    expect(within(claim).getByRole('button', { name: 'Release claim' })).toBeTruthy();

    const tabs = screen.getByRole('tablist', { name: 'Node details' });
    expect(within(tabs).getByRole('tab', { name: 'Change List' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Change List', level: 3 })).toBeTruthy();
    expect(screen.getByText('2 items')).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Change list' });
    expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Attribute', 'From', 'To']);
    expect(within(table).getAllByRole('columnheader').some(h => classesOf(h).includes('w-1/2'))).toBe(false);
    const first = within(table).getAllByRole('row')[1] as HTMLElement;
    expect(within(first).getAllByRole('cell').map(c => c.textContent)).toEqual(['fills', 'bg-primary#FFFFFF', 'bg-secondary#F9FAFB']);
    expect(screen.getByRole('navigation', { name: 'Change list pages' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Change history' })).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('renders State=Change History as a feed, newest first', async () => {
    const { container } = render(<Example state="change-history" />);
    expect(screen.getByRole('tab', { name: 'Change History' }).getAttribute('aria-selected')).toBe('true');
    const feed = screen.getByRole('list', { name: 'Change history' });
    expect(classesOf(feed)).toEqual(expect.arrayContaining(['w-fit', 'max-w-full']));
    expect(classesOf(screen.getByRole('group', { name: 'Status' }))).not.toContain('flex-1');
    const claimRow = screen.getByRole('heading', { name: 'Claim Holder', level: 3 }).parentElement?.parentElement ?? null;
    expect(classesOf(claimRow)).toEqual(expect.arrayContaining(['justify-between', 'gap-6xl']));
    const items = within(feed).getAllByRole('listitem');
    expect(items.map(i => i.textContent)).toEqual([expect.stringContaining('Claimed it'), expect.stringContaining('Changed fills')]);
    expect(screen.queryByRole('table')).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('switches tabs and reports the new state', async () => {
    const user = userEvent.setup();
    const onStateChange = vi.fn();
    render(<Example onStateChange={onStateChange} />);
    await user.click(screen.getByRole('tab', { name: 'Change History' }));
    expect(onStateChange).toHaveBeenCalledWith('change-history');
    expect(screen.getByRole('list', { name: 'Change history' })).toBeTruthy();
    expect(screen.getByRole('article').getAttribute('data-state')).toBe('change-history');
    await user.click(screen.getByRole('tab', { name: 'Change List' }));
    expect(onStateChange).toHaveBeenLastCalledWith('change-list');
    expect(screen.getByRole('table', { name: 'Change list' })).toBeTruthy();
  });

  it('pages the changes table', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 12 }, (_, i) => ({ attribute: `prop${i}`, from: { value: 'a' }, to: { value: 'b' } }));
    render(<Example changes={many} pageSize={10} />);
    expect(screen.getByText('12 items')).toBeTruthy();
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(11);
    await user.click(screen.getByRole('button', { name: 'Page 2' }));
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]?.textContent).toContain('prop10');
  });

  it('shows the empty texts instead of the table and feed', async () => {
    const user = userEvent.setup();
    render(<Example changes={[]} history={[]} changesEmpty="Nothing changed since it was cleared." historyEmpty="No history yet." />);
    expect(screen.getByText('0 items')).toBeTruthy();
    expect(screen.getByText('Nothing changed since it was cleared.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Change History' }));
    expect(screen.getByText('No history yet.')).toBeTruthy();
  });

  it('puts the status row in the header (Node Details Header), under the description', () => {
    render(<Example />);
    const header = screen.getAllByRole('banner')[0]!;
    const status = within(header).getByRole('group', { name: 'Status' });
    expect(within(status).getByText('Dirty')).toBeTruthy();
    expect(status.closest('.gap-xs')).toBeTruthy();
  });

  it('renders the claim note, content and the content under the status row', () => {
    render(
      <Example claimNote="covers 2 other nodes too" claimContent={<p>Confirm?</p>}>
        <p>Blocked: waiting on tokens</p>
      </Example>,
    );
    const claim = screen.getByRole('group', { name: 'Claim Holder' });
    expect(within(claim).getByText('covers 2 other nodes too')).toBeTruthy();
    expect(within(claim).getByText('Confirm?')).toBeTruthy();
    expect(screen.getByText('Blocked: waiting on tokens')).toBeTruthy();
  });
});

describe('NodeDetails paginationLabel', () => {
  it('names the change list pagination', () => {
    render(<Example paginationLabel="Table changes" />);
    expect(screen.getByRole('navigation', { name: 'Table changes' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Change list pages' })).toBeNull();
  });
});

describe('NodeDetails under the dark theme', () => {
  it('renders its gallery examples with no axe violations', async () => {
    const dark = gallery.examples.filter(e => e.figma.endsWith('Color Mode=Dark'));
    expect(dark.length).toBeGreaterThan(0);
    const { container } = render(<div>{dark.map(e => <section key={e.figma} aria-label={e.figma}>{e.render()}</section>)}</div>);
    expect(container.querySelectorAll('[data-theme="dark"]')).toHaveLength(dark.length);
    await expectNoAxeViolations(container);
  });
});

describe('NodeDetails State=Add Change', () => {
  const form = <textarea aria-label="Description" />;

  it('maps the Add Change variant', () => {
    expect(figmaNodeDetails.axes.State['Add Change']).toEqual({ nodeId: '173:34249', props: { state: 'add-change' } });
  });

  it('opens the note input with Add note (disabled while open), and Cancel goes back', async () => {
    const onStateChange = vi.fn();
    render(<Example addChange={form} onStateChange={onStateChange} />);
    const user = userEvent.setup();
    const toggle = screen.getByRole('button', { name: 'Add note' });
    expect(toggle.className).toContain('ring-primary');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('table', { name: 'Change list' })).toBeTruthy();
    await user.click(toggle);
    expect(onStateChange).toHaveBeenLastCalledWith('add-change');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('textbox', { name: 'Description' })).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Change list' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Change List' }).getAttribute('aria-selected')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onStateChange).toHaveBeenLastCalledWith('change-list');
    expect(screen.getByRole('table', { name: 'Change list' })).toBeTruthy();
    expect(toggle.hasAttribute('disabled')).toBe(false);
    expect(screen.queryByRole('textbox', { name: 'Description' })).toBeNull();
  });

  it('shows notes above the list and can leave out an empty list', () => {
    const { rerender } = render(<Example notes={<p>A note</p>} />);
    expect(screen.getByText('A note')).toBeTruthy();
    rerender(<Example notes={<p>A note</p>} changes={[]} hideEmptyChanges />);
    expect(screen.queryByText('Nothing changed.')).toBeNull();
    expect(screen.getByText('A note')).toBeTruthy();
  });

  it('has no dropdown without addChange', () => {
    render(<Example />);
    expect(screen.queryByRole('button', { name: 'Add note' })).toBeNull();
  });

  it('has no axe violations in State=Add Change', async () => {
    const { container } = render(<Example defaultState="add-change" addChange={form} />);
    await expectNoAxeViolations(container);
  });
});
