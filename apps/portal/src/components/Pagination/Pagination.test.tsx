import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { pageSlots, Pagination } from '.';
import { describeGalleryInThemes } from '../../test/theme';
import gallery from './Pagination.gallery';

describe('pageSlots', () => {
  it.each([
    [1, 5, [1, 2, 3, 4, 5]],
    [1, 10, [1, 2, 3, 'ellipsis-start', 8, 9, 10]],
    [9, 10, [1, 2, 3, 'ellipsis-start', 8, 9, 10]],
    [5, 10, [1, 'ellipsis-start', 4, 5, 6, 'ellipsis-end', 10]],
  ])('page %i of %i', (page, count, slots) => {
    expect(pageSlots(page, count)).toEqual(slots);
  });
});

describe('Pagination', () => {
  it('renders the card-default type with previous, numbers, ellipsis and next', async () => {
    const { container } = render(<Pagination page={1} pageCount={10} onPageChange={() => undefined} />);
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    expect(nav.className).toContain('border-t border-secondary px-3xl pt-lg pb-xl');
    expect(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getAllByRole('button', { name: /^Page / }).map(b => b.textContent)).toEqual(['1', '2', '3', '8', '9', '10']);
    expect(nav.textContent).toContain('…');
    await expectNoAxeViolations(container);
  });

  it('marks the current page with aria-current and the Hover/active style', () => {
    render(<Pagination page={2} pageCount={3} onPageChange={() => undefined} />);
    const current = screen.getByRole('button', { name: 'Page 2' });
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(current.className).toContain('bg-primary_hover text-secondary');
    const other = screen.getByRole('button', { name: 'Page 1' });
    expect(other.getAttribute('aria-current')).toBeNull();
    expect(other.className).toContain('text-quaternary');
  });

  it('changes page from the keyboard', async () => {
    const onPageChange = vi.fn();
    render(<Pagination page={5} pageCount={10} onPageChange={onPageChange} />);
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Previous' }));
    await user.keyboard('{Enter}');
    expect(onPageChange).toHaveBeenLastCalledWith(4);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Page 1' }));
    await user.keyboard(' ');
    expect(onPageChange).toHaveBeenLastCalledWith(1);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPageChange).toHaveBeenLastCalledWith(6);
  });

  it('disables Next on the last page', () => {
    render(<Pagination page={10} pageCount={10} onPageChange={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(true);
  });

  it('renders cursor mode with only Previous / Page n / Next', async () => {
    const onPageChange = vi.fn();
    const { container, rerender } = render(<Pagination page={2} hasNext onPageChange={onPageChange} />);
    expect(screen.queryByRole('list')).toBeNull();
    const current = screen.getByText('2', { selector: '[aria-live]' });
    expect(current.textContent).toBe('Page 2');
    expect(current.querySelector('span')?.textContent).toBe('Page ');
    expect(current.className).toContain('bg-primary_hover');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Next' }));
    expect(onPageChange).toHaveBeenCalledWith(3);
    rerender(<Pagination page={3} hasNext={false} onPageChange={onPageChange} />);
    expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled')).toBe(false);
    await expectNoAxeViolations(container);
  });

  it('forwards ref, className and DOM props', () => {
    const ref = createRef<HTMLElement>();
    render(<Pagination ref={ref} label="Results pages" className="px-xl" data-testid="p" page={1} pageCount={2} onPageChange={() => undefined} />);
    const nav = screen.getByRole('navigation', { name: 'Results pages' });
    expect(ref.current).toBe(nav);
    expect(nav.className).toContain('px-xl');
    expect(nav.className).not.toContain('px-3xl');
    expect(nav.getAttribute('data-testid')).toBe('p');
  });
});

describeGalleryInThemes(gallery);
