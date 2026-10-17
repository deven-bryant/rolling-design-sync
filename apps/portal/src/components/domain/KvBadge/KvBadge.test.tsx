import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import gallery from './KvBadge.gallery';
import { KvBadge, KvBadgeList } from '.';

describe('KvBadge', () => {
  it('renders a regular label and a semibold value as a term / definition', async () => {
    const { container } = render(
      <dl>
        <KvBadge label="Checked" value="2h ago" />
      </dl>,
    );
    expect(screen.getByText('Checked').tagName).toBe('DT');
    expect(screen.getByText('2h ago').className).toContain('font-semibold');
    await expectNoAxeViolations(container);
  });

  it('separates a list with vertical dividers', () => {
    const { container } = render(
      <KvBadgeList
        items={[
          { label: 'Checked', value: '2h ago' },
          { label: 'Commit', value: '4b11b44' },
          { label: 'Limit', value: '1%' },
        ]}
      />,
    );
    expect(screen.getAllByRole('term').map(t => t.textContent)).toEqual(['Checked', 'Commit', 'Limit']);
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
  });

  it('renders its gallery in both themes with no axe violations', async () => {
    const { container } = render(<div>{gallery.examples.map(e => <section key={e.figma} aria-label={e.figma}>{e.render()}</section>)}</div>);
    await expectNoAxeViolations(container);
  });
});
