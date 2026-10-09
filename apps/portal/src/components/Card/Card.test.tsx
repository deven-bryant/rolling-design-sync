import { render, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Card } from '.';
import { describeGalleryInThemes } from '../../test/theme';
import gallery from './Card.gallery';

describe('Card', () => {
  it('renders the surface with header, body and footer', async () => {
    const ref = createRef<HTMLElement>();
    const { container } = render(
      <Card ref={ref} as="section" aria-label="Team" className="w-120" data-testid="card">
        <Card.Header
          title="Team members"
          badge={<span>100 users</span>}
          description="Manage your team members."
          actions={<button type="button">Add</button>}
          menu={<button type="button">More</button>}
        />
        <Card.Body>Body</Card.Body>
        <Card.Footer>Footer</Card.Footer>
      </Card>,
    );
    const card = screen.getByRole('region', { name: 'Team' });
    expect(ref.current).toBe(card);
    for (const c of ['bg-primary', 'border-secondary', 'rounded-xl', 'shadow-xs', 'w-120']) expect(card.className).toContain(c);
    expect(screen.getByRole('heading', { level: 2, name: 'Team members' }).className).toContain('text-lg');
    const header = screen.getByRole('banner');
    expect(within(header).getByText('100 users')).toBeDefined();
    expect(within(header).getByText('Manage your team members.').className).toContain('text-tertiary');
    expect(within(header).getByRole('button', { name: 'Add' })).toBeDefined();
    expect(within(header).getByRole('button', { name: 'More' })).toBeDefined();
    expect(header.className).toContain('border-b');
    expect(screen.getByText('Body')).toBeDefined();
    expect(screen.getByText('Footer').className).toContain('border-t');
    await expectNoAxeViolations(container);
  });

  it('header without divider, description or actions; custom heading level', () => {
    const ref = createRef<HTMLElement>();
    render(
      <Card>
        <Card.Header ref={ref} title="Activity" headingLevel={3} divider={false} className="bg-secondary" />
      </Card>,
    );
    const header = ref.current!;
    expect(header.className).not.toContain('border-b');
    expect(header.className).toContain('bg-secondary');
    expect(screen.getByRole('heading', { level: 3, name: 'Activity' })).toBeDefined();
    expect(header.querySelectorAll('p')).toHaveLength(0);
  });

  it('body and footer forward refs and props', () => {
    const body = createRef<HTMLDivElement>();
    const footer = createRef<HTMLDivElement>();
    render(
      <Card>
        <Card.Body ref={body} className="p-3xl" data-testid="body" />
        <Card.Footer ref={footer} data-testid="footer" />
      </Card>,
    );
    expect(body.current).toBe(screen.getByTestId('body'));
    expect(body.current?.className).toContain('p-3xl');
    expect(footer.current).toBe(screen.getByTestId('footer'));
  });
});

describeGalleryInThemes(gallery);
