import { render, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Feed, FeedItem, FileTypeIcon } from '.';
import { describeGalleryInThemes } from '../../test/theme';
import gallery from './FeedItem.gallery';

const avatar = <span role="img" aria-label="Olivia Rhye" className="size-6xl" />;

describe('FeedItem', () => {
  it('Divider=Connector: items carry a connector line, hidden on the last item', async () => {
    const ref = createRef<HTMLUListElement>();
    const { container } = render(
      <Feed ref={ref} aria-label="Activity" className="w-90">
        <FeedItem avatar={avatar} name="Olivia Rhye" time="2 mins ago">
          Invited <FeedItem.Highlight>Lana Steiner</FeedItem.Highlight> to the team
        </FeedItem>
        <FeedItem avatar={avatar} name="Phoenix Baker" time="3 mins ago" />
      </Feed>,
    );
    const list = screen.getByRole('list', { name: 'Activity' });
    expect(ref.current).toBe(list);
    expect(list.className).not.toContain('gap-4xl');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    for (const item of items) {
      const line = item.querySelector('.bg-border-primary');
      expect(line?.className).toContain('group-last/feed-item:hidden');
    }
    expect(screen.getByText('Lana Steiner').className).toContain('text-brand-secondary');
    expect(screen.getByText('Olivia Rhye', { selector: 'span.font-medium' }).className).toContain('text-secondary');
    expect(screen.getByText('2 mins ago').className).toContain('text-xs');
    await expectNoAxeViolations(container);
  });

  it('Divider=False: no connector, items spaced by spacing-4xl', () => {
    render(
      <Feed divider="none" aria-label="Activity">
        <FeedItem avatar={avatar} name="Olivia Rhye" time="2 mins ago" />
      </Feed>,
    );
    expect(screen.getByRole('list').className).toContain('gap-4xl');
    expect(screen.getByRole('listitem').querySelector('.bg-border-primary')).toBeNull();
  });

  it('Connector prop overrides the feed', () => {
    render(
      <Feed divider="none" aria-label="Activity">
        <FeedItem avatar={avatar} name="Olivia Rhye" time="2 mins ago" connector />
      </Feed>,
    );
    expect(screen.getByRole('listitem').querySelector('.bg-border-primary')).not.toBeNull();
  });

  it('Supporting item=File: file icon, name and size', async () => {
    const { container } = render(
      <Feed aria-label="Activity">
        <FeedItem
          avatar={avatar}
          name="Olivia Rhye"
          time="2 mins ago"
          supportingItem={<FeedItem.File name="Tech requirements.pdf" size="720 KB" />}
        >
          Added a file
        </FeedItem>
      </Feed>,
    );
    expect(screen.getByText('Tech requirements.pdf')).toBeDefined();
    expect(screen.getByText('720 KB').className).toContain('text-tertiary');
    expect(screen.getByText('PDF').className).toContain('bg-error-600');
    await expectNoAxeViolations(container);
  });

  it('Supporting item=Text: the message bubble', async () => {
    const { container } = render(
      <Feed aria-label="Activity">
        <FeedItem avatar={avatar} name="Olivia Rhye" time="2 mins ago" supportingItem={<FeedItem.Message>Looks good</FeedItem.Message>} />
      </Feed>,
    );
    const bubble = screen.getByText('Looks good').closest('blockquote')!;
    for (const c of ['bg-primary_alt', 'border-secondary', 'rounded-tr-md', 'rounded-b-md']) expect(bubble.className).toContain(c);
    await expectNoAxeViolations(container);
  });

  it('New dot: unread dot with accessible text', async () => {
    const ref = createRef<HTMLLIElement>();
    const { container } = render(
      <Feed aria-label="Activity">
        <FeedItem ref={ref} avatar={avatar} name="Olivia Rhye" time="2 mins ago" dateTime="2026-10-01T12:00:00Z" unread unreadLabel="New" className="pr-md" />
      </Feed>,
    );
    expect(ref.current?.className).toContain('pr-md');
    expect(within(ref.current!).getByText('New').className).toContain('sr-only');
    expect(ref.current?.querySelector('.bg-fg-success-secondary')).not.toBeNull();
    expect(ref.current?.querySelector('time')?.getAttribute('dateTime')).toBe('2026-10-01T12:00:00Z');
    await expectNoAxeViolations(container);
  });

  it('File type icon: File type=Document / PDF', () => {
    const ref = createRef<HTMLSpanElement>();
    render(<FileTypeIcon ref={ref} className="ml-xs" />);
    expect(ref.current?.textContent).toBe('PDF');
    expect(ref.current?.getAttribute('aria-hidden')).toBe('true');
    expect(ref.current?.className).toContain('ml-xs');
  });
});

describeGalleryInThemes(gallery);
