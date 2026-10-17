import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import gallery from './NoteScreenshots.gallery';
import { filesFromClipboard, NoteScreenshots } from '.';

const shot = (id: string) => ({ id, src: `blob:${id}`, name: `${id}.png`, detail: '4 KB' });

describe('NoteScreenshots', () => {
  it('browses for files with the drop zone’s button', async () => {
    const onAdd = vi.fn();
    const { container } = render(<NoteScreenshots screenshots={[]} onAdd={onAdd} onRemove={vi.fn()} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.getAttribute('accept')).toBe('image/png,image/jpeg,image/webp');
    expect(screen.getByRole('button', { name: 'Drop, paste or click to add screenshots' })).toBeTruthy();
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    await userEvent.setup().upload(input, file);
    expect(onAdd).toHaveBeenCalledWith([file]);
    await expectNoAxeViolations(container);
  });

  it('lists attached thumbnails with remove buttons and hides the zone when full', async () => {
    const onRemove = vi.fn();
    render(<NoteScreenshots screenshots={[shot('a'), shot('b'), shot('c')]} onAdd={vi.fn()} onRemove={onRemove} />);
    const list = within(screen.getByRole('list', { name: 'Attached screenshots' }));
    expect(list.getAllByRole('img').map(i => i.getAttribute('alt'))).toEqual(['a.png', 'b.png', 'c.png']);
    expect(list.getByText('a.png · 4 KB')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Drop, paste/ })).toBeNull();
    await userEvent.setup().click(list.getByRole('button', { name: 'Remove b.png' }));
    expect(onRemove).toHaveBeenCalledWith('b');
  });

  it('shows an error as an alert', () => {
    render(<NoteScreenshots screenshots={[]} onAdd={vi.fn()} onRemove={vi.fn()} error="Too big" />);
    expect(screen.getByRole('alert').textContent).toBe('Too big');
  });

  it('reads files from a clipboard', () => {
    const file = new File(['x'], 'p.png', { type: 'image/png' });
    expect(filesFromClipboard({ files: [file] } as unknown as DataTransfer)).toEqual([file]);
    expect(filesFromClipboard(null)).toEqual([]);
  });

  it('renders its gallery in both themes with no axe violations', async () => {
    const { container } = render(<div>{gallery.examples.map(e => <section key={e.figma} aria-label={e.figma}>{e.render()}</section>)}</div>);
    await expectNoAxeViolations(container);
  });
});
