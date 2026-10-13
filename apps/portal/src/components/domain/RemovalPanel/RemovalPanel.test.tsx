import { render, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { describeGalleryInThemes } from '../../../test/theme';
import { RemovalPanel, sortUses, warningText } from '.';
import gallery from './RemovalPanel.gallery';

const uses = [
  { componentId: '1:10', name: 'Button', livePlacements: 4 },
  { componentId: '1:11', name: 'Pricing card', livePlacements: 0 },
  { componentId: '1:12', name: 'Avatar', livePlacements: 1 },
];

describe('RemovalPanel', () => {
  it('lists the unused components first, with Keep / Likely unused badges and placements left', async () => {
    const { container } = render(<RemovalPanel name="Files" uses={uses} action={<button type="button">Copy removal prompt</button>} />);
    const panel = screen.getByRole('group', { name: 'Removed from the design' });
    expect(within(panel).getByText('Remove the code that rendered “Files”. Keep components that are still used.')).toBeDefined();
    const items = within(within(panel).getByRole('list', { name: 'Components it used' })).getAllByRole('listitem');
    expect(items.map(li => li.textContent)).toEqual([
      'Pricing cardnone leftLikely unused',
      'Button4 placements leftKeep',
      'Avatar1 placement leftKeep',
    ]);
    expect(within(items[0]!).getByText('Likely unused').className).toContain('bg-utility-warning-50');
    expect(within(items[1]!).getByText('Keep').className).toContain('bg-utility-success-50');
    expect(within(panel).getByRole('button', { name: 'Copy removal prompt' })).toBeDefined();
    expect(within(panel).queryByRole('list', { name: 'Warnings' })).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('shows warnings by component name', () => {
    render(<RemovalPanel name="Files" uses={uses} warnings={[{ componentId: '1:11', livePlacements: 2 }, { componentId: '9:9', livePlacements: 1 }]} />);
    const warnings = within(screen.getByRole('list', { name: 'Warnings' })).getAllByRole('listitem');
    expect(warnings.map(w => w.textContent)).toEqual([
      '“Pricing card” was deleted from the design but 2 instances still use it.',
      '“9:9” was deleted from the design but 1 instance still uses it.',
    ]);
  });

  it('says so when the design used no components, and forwards ref and className', () => {
    const ref = createRef<HTMLDivElement>();
    render(<RemovalPanel ref={ref} className="w-120" name="Draft" uses={[]} />);
    expect(screen.getByText('It used no components.')).toBeDefined();
    expect(ref.current?.className).toContain('w-120');
  });

  it('sorts and words without rendering', () => {
    expect(sortUses(uses).map(u => u.name)).toEqual(['Pricing card', 'Button', 'Avatar']);
    expect(warningText({ componentId: '1:10', livePlacements: 3 }, uses)).toBe('“Button” was deleted from the design but 3 instances still use it.');
  });
});

describeGalleryInThemes(gallery);
