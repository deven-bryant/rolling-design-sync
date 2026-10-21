import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import gallery from './RenderCheck.gallery';
import { RenderCheck, RenderCheckBadge, renderCheckLabels, type RenderCheckStatus } from '.';

const img = (src: string) => ({ src: `${src}-thumb`, fullSrc: src, width: 200, height: 100 });

describe('RenderCheck', () => {
  it('shows the header KV badges, side-by-side images with regions, the score and actions', async () => {
    const { container } = render(
      <RenderCheck
        status="mismatch"
        meta={[
          { label: 'Checked', value: '2h ago' },
          { label: 'Commit', value: '4b11b44' },
        ]}
        designed={img('/ref')}
        implemented={img('/built')}
        heatmap={img('/heat')}
        regions={[{ x: 20, y: 10, width: 100, height: 50 }]}
        diff={{ score: '3.4%', regions: 1 }}
        details={['100 × 50 px at 20, 10']}
        actions={<button type="button">Request check</button>}
      />,
    );
    const section = screen.getByRole('group', { name: /Render check/ });
    expect(within(section).getByText('Render mismatch')).toBeTruthy();
    expect(screen.getAllByRole('term').map(t => t.textContent)).toEqual(['Checked', 'Commit', 'Pixel diff', 'Regions']);
    const diff = within(screen.getByRole('heading', { name: 'Diff Status' }).parentElement as HTMLElement);
    expect(diff.getAllByRole('definition').map(d => d.textContent)).toEqual(['3.4%', '1']);
    expect(screen.getByRole('tab', { name: 'Side by side' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'View Designed' })).toBeTruthy();
    const region = container.querySelector('[data-region]') as HTMLElement;
    expect(region.style.left).toBe('10%');
    expect(region.style.width).toBe('50%');
    expect(within(screen.getByRole('list', { name: 'Differing regions' })).getAllByRole('listitem')).toHaveLength(1);
    await expectNoAxeViolations(container);
  });

  it.each([
    ['wide', 563, 90, 'min(100%, 1401px)'],
    ['tall', 90, 563, 'min(100%, 36px)'],
  ])('shows a %s image whole, framed to its aspect ratio on a light backdrop, regions over the image', async (_, width, height, frameWidth) => {
    const image = (src: string) => ({ src, width, height });
    const { container } = render(
      <RenderCheck
        status="mismatch"
        designed={image('/ref')}
        implemented={image('/built')}
        heatmap={image('/heat')}
        regions={[{ x: width / 4, y: height / 2, width: width / 2, height: height / 4 }]}
      />,
    );
    const frame = screen.getByRole('button', { name: 'View Implemented' });
    expect(frame.style.aspectRatio).toBe(`${width} / ${height}`);
    expect(frame.style.width).toBe(frameWidth);
    expect(frame.className).toContain('bg-checkerboard');
    expect(frame.className).not.toContain('aspect-square');
    expect(frame.querySelector('img')?.className).toContain('object-contain');
    const region = frame.querySelector('[data-region]') as HTMLElement;
    expect([region.style.left, region.style.top, region.style.width, region.style.height]).toEqual(['25%', '50%', '50%', '25%']);
    await expectNoAxeViolations(container);
  });

  it('without the image size: a bounded frame, the image contained', () => {
    render(<RenderCheck status="mismatch" designed={{ src: '/ref' }} />);
    const frame = screen.getByRole('button', { name: 'View Designed' });
    expect(frame.style.aspectRatio).toBe('');
    expect(frame.className).toContain('h-40');
    expect(frame.querySelector('img')?.className).toContain('object-contain');
  });

  it('switches to the heatmap tab and opens the full image', async () => {
    const user = userEvent.setup();
    render(<RenderCheck status="mismatch" designed={img('/ref')} implemented={img('/built')} heatmap={img('/heat')} />);
    await user.click(screen.getByRole('tab', { name: 'Heatmap' }));
    await user.click(screen.getByRole('button', { name: 'View Heatmap' }));
    const dialog = await screen.findByRole('dialog', { name: 'Heatmap' });
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe('/heat');
  });

  it('shows a message and no tabs without images', () => {
    render(<RenderCheck status="not-set-up" message="Not a screen yet." />);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByText('Not a screen yet.')).toBeTruthy();
    expect(screen.getByText('Not set up')).toBeTruthy();
  });

  it.each(Object.keys(renderCheckLabels) as RenderCheckStatus[])('badges %s', status => {
    render(<RenderCheckBadge status={status} />);
    expect(screen.getByText(renderCheckLabels[status])).toBeTruthy();
  });

  it('renders its gallery in both themes with no axe violations', async () => {
    const { container } = render(<div>{gallery.examples.map(e => <section key={e.figma} aria-label={e.figma}>{e.render()}</section>)}</div>);
    await expectNoAxeViolations(container);
  });
});
