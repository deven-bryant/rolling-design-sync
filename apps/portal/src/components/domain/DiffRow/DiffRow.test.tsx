import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { DiffRow, figmaDiffRow } from '.';

const classesOf = (el: Element | null) => el?.getAttribute('class')?.split(' ') ?? [];

describe('DiffRow', () => {
  it('renders the Figma default', async () => {
    const { property, category, built, now, raw } = figmaDiffRow.defaults;
    const { container } = render(<DiffRow {...figmaDiffRow.defaults} />);
    expect(classesOf(container.firstElementChild)).toEqual(
      expect.arrayContaining(['flex-col', 'gap-md', 'py-lg', 'border-b', 'border-secondary']),
    );
    expect(classesOf(screen.getByText(property))).toEqual(expect.arrayContaining(['text-sm', 'font-semibold', 'text-primary']));
    expect(classesOf(screen.getByText(category))).toEqual(
      expect.arrayContaining(['bg-utility-gray-blue-50', 'text-utility-gray-blue-700', 'rounded-full']),
    );
    expect(classesOf(screen.getByText(built))).toEqual(
      expect.arrayContaining(['rounded-sm', 'border', 'border-secondary', 'bg-secondary', 'text-secondary', 'px-md', 'py-xs', 'text-xs', 'font-medium']),
    );
    expect(classesOf(screen.getByText(now))).toEqual(
      expect.arrayContaining(['border-utility-brand-200', 'bg-utility-brand-50', 'text-utility-brand-700']),
    );
    expect(screen.getByRole('img', { name: 'to' })).toBeTruthy();
    expect(classesOf(screen.getByText(raw))).toEqual(expect.arrayContaining(['text-sm', 'text-quaternary']));
    await expectNoAxeViolations(container);
  });

  it('hides the raw value unless showRaw', () => {
    render(<DiffRow property="fills" built="bg-primary" now="bg-secondary" raw="#FFFFFF → #F9FAFB" />);
    expect(screen.queryByText('#FFFFFF → #F9FAFB')).toBeNull();
  });

  it('omits the category badge when not given', () => {
    const { container } = render(<DiffRow property="fills" built="a" now="b" />);
    expect(container.querySelector('.bg-utility-gray-blue-50')).toBeNull();
  });
});
