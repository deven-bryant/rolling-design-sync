import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import gallery from './RenderCheckTarget.gallery';
import { HeatmapCrop, RenderCheckHistory, RenderChecksContaining, RenderCheckTargetDetails } from '.';

describe('RenderCheckTargetDetails', () => {
  it('lists the details and toggles the exclusion', async () => {
    const onExcludedChange = vi.fn();
    render(<RenderCheckTargetDetails excluded={false} onExcludedChange={onExcludedChange} details={[{ label: 'Route', value: '/work' }]} />);
    expect(screen.getByRole('heading', { name: 'Render Check Target Details' })).toBeTruthy();
    expect(screen.getByRole('term').textContent).toBe('Route');
    expect(screen.getByRole('definition').textContent).toBe('/work');
    await userEvent.click(screen.getByRole('switch', { name: 'Exclude from checks' }));
    expect(onExcludedChange).toHaveBeenCalledWith(true);
  });

  it('is read-only without onExcludedChange and shows a hint instead of the details', () => {
    render(<RenderCheckTargetDetails excluded hint="Excluded." learnMoreHref="/docs" details={[{ label: 'Route', value: '/work' }]} />);
    const toggle = screen.getByRole('switch', { name: 'Exclude from checks' }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(toggle.disabled).toBe(true);
    expect(screen.getByText('Excluded.')).toBeTruthy();
    expect(screen.queryByRole('term')).toBeNull();
    expect(screen.getByRole('link', { name: 'Learn more' }).getAttribute('href')).toBe('/docs');
  });
});

describe('RenderCheckHistory', () => {
  it('marks the viewed result and the baseline, and selects another one', async () => {
    const onSelect = vi.fn();
    render(
      <RenderCheckHistory
        retention={3}
        onSelect={onSelect}
        results={[
          { id: 'k2', status: 'mismatch', summary: '3.4% · 4b11b44', time: '2h ago', viewing: true },
          { id: 'k1', status: 'passed', summary: '0.4% · 71fd0b2', time: 'yesterday', baseline: true },
        ]}
      />,
    );
    expect(screen.getByText('Last 3 results · the last pass is always kept as the baseline')).toBeTruthy();
    const [current, baseline] = screen.getAllByRole('listitem');
    expect(within(current!).getByText('Viewing')).toBeTruthy();
    expect(within(current!).getByText('Mismatch')).toBeTruthy();
    expect(within(baseline!).getByText('Baseline')).toBeTruthy();
    await userEvent.click(within(baseline!).getByRole('button'));
    expect(onSelect).toHaveBeenCalledWith('k1');
  });
});

describe('RenderChecksContaining', () => {
  it('lists each target with its status and opens it', async () => {
    const onOpen = vi.fn();
    render(<RenderChecksContaining onOpen={onOpen} targets={[{ id: '1:9', name: 'Work', meta: 'checked 2h ago', status: 'waiting' }]} />);
    expect(screen.getByText('Waiting')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Open Work' }));
    expect(onOpen).toHaveBeenCalledWith('1:9');
  });
});

describe('HeatmapCrop', () => {
  it('scales the region into the box', () => {
    render(<HeatmapCrop src="/heat.png" width={400} height={200} region={{ x: 100, y: 50, width: 62, height: 31 }} alt="Heatmap" />);
    const img = screen.getByRole('img', { name: 'Heatmap' });
    expect(img.style.width).toBe('800px');
    expect(screen.getByText('Cropped from the heatmap')).toBeTruthy();
  });
});

describe('gallery', () => {
  it('renders in both themes with no axe violations', async () => {
    const { container } = render(<div>{gallery.examples.map(e => <section key={e.figma} aria-label={e.figma}>{e.render()}</section>)}</div>);
    await expectNoAxeViolations(container);
  });
});
