import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Metric, MetricChange } from '.';
import { describeGalleryInThemes } from '../../test/theme';
import gallery from './Metric.gallery';

describe('Metric', () => {
  it('Type=Simple: heading, value, change and menu', async () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(
      <Metric
        ref={ref}
        className="w-97"
        data-testid="metric"
        heading="Views 24 hours"
        value="2,000"
        change={<MetricChange>100%</MetricChange>}
        menu={<button type="button">More</button>}
      />,
    );
    const metric = screen.getByTestId('metric');
    expect(ref.current).toBe(metric);
    for (const c of ['p-2xl', 'gap-md', 'rounded-xl', 'border-secondary', 'shadow-xs', 'w-97']) expect(metric.className).toContain(c);
    expect(screen.getByRole('heading', { name: 'Views 24 hours' }).className).toContain('text-tertiary');
    expect(screen.getByText('2,000').className).toContain('text-display-sm');
    expect(screen.getByText('100%')).toBeDefined();
    expect(screen.getByRole('button', { name: 'More' }).parentElement?.className).toContain('absolute');
    await expectNoAxeViolations(container);
  });

  it('renders without change badge or menu', () => {
    render(<Metric data-testid="metric" heading="Nodes" value={12} />);
    expect(screen.getByTestId('metric').querySelector('.absolute')).toBeNull();
    expect(screen.getByText('12')).toBeDefined();
  });

  it('_Change Type=03, Trend=Positive: labelled arrow and text', async () => {
    const ref = createRef<HTMLSpanElement>();
    const { container } = render(
      <MetricChange ref={ref} trendLabel="Increase" className="ml-auto">
        100%
      </MetricChange>,
    );
    expect(ref.current?.className).toContain('ml-auto');
    expect(ref.current?.className).toContain('pl-sm');
    expect(screen.getByRole('img', { name: 'Increase' }).getAttribute('data-icon')).toBe('arrow-up-right');
    expect(screen.getByText('100%').className).toContain('text-secondary');
    await expectNoAxeViolations(container);
  });
});

describeGalleryInThemes(gallery);
