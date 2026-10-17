import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import gallery from './ClaimHolder.gallery';
import { ClaimHolder } from '.';

describe('ClaimHolder', () => {
  it('lists who holds the claim as terms and values, with its action', async () => {
    const { container } = render(
      <ClaimHolder
        details={[
          { label: 'Name', value: 'devin' },
          { label: 'Lease Expiration', value: 'in 14 min' },
        ]}
        note="covers 2 other nodes too"
        action={<button type="button">Release claim</button>}
      />,
    );
    const group = within(screen.getByRole('group', { name: 'Claim Holder' }));
    expect(group.getAllByRole('term').map(t => t.textContent)).toEqual(['Name', 'Lease Expiration']);
    expect(group.getAllByRole('definition').map(d => d.textContent)).toEqual(['devin', 'in 14 min']);
    expect(group.getByText('covers 2 other nodes too')).toBeTruthy();
    expect(group.getByRole('button', { name: 'Release claim' })).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('says it is unclaimed without details', () => {
    render(<ClaimHolder />);
    expect(screen.getByText('Unclaimed · the next agent pass you start picks this up')).toBeTruthy();
    expect(screen.queryByRole('term')).toBeNull();
  });

  it('renders its gallery in both themes with no axe violations', async () => {
    const { container } = render(<div>{gallery.examples.map(e => <section key={e.figma} aria-label={e.figma}>{e.render()}</section>)}</div>);
    await expectNoAxeViolations(container);
  });
});
