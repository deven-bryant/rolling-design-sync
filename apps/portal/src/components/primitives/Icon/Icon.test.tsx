import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { Icon, iconNames } from '.';
import { describeGalleryInThemes } from '../../../test/theme';
import gallery from './Icon.gallery';

describe('Icon', () => {
  it('maps every Figma icon in the component map', () => {
    expect(iconNames.sort()).toEqual([
      'alert-circle',
      'arrow-left',
      'arrow-right',
      'arrow-up-right',
      'bar-chart-square-02',
      'check-circle',
      'check-done-01',
      'chevron-down',
      'chevron-right',
      'chevron-selector-vertical',
      'dots-vertical',
      'help-circle',
      'home-line',
      'mail-01',
      'moon-01',
      'pie-chart-03',
      'placeholder',
      'rows-01',
      'search-lg',
      'settings-01',
      'sun',
      'users-01',
      'x-close',
    ]);
  });

  it.each(iconNames)('renders %s as a 24px, 2px-stroke currentColor glyph', name => {
    const { container } = render(<Icon name={name} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('data-icon')).toBe(name);
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg?.getAttribute('stroke')).toBe('currentColor');
    expect(svg?.getAttribute('stroke-width')).toBe('2');
    expect(svg?.getAttribute('class')).toContain('size-6');
  });

  it('renders the placeholder as a plain circle', () => {
    const { container } = render(<Icon name="placeholder" />);
    expect(container.querySelectorAll('svg > *')).toHaveLength(1);
    expect(container.querySelector('svg > circle')?.getAttribute('r')).toBe('10');
  });

  it('applies sizes and merges className', () => {
    const { container } = render(<Icon name="search-lg" size="md" className="text-fg-quaternary" />);
    const cls = container.querySelector('svg')?.getAttribute('class') ?? '';
    expect(cls).toContain('size-5');
    expect(cls).not.toContain('size-6');
    expect(cls).toContain('text-fg-quaternary');
  });

  it('is decorative by default and named when labelled', async () => {
    const { container } = render(
      <div>
        <Icon name="x-close" />
        <Icon name="help-circle" label="Help" />
      </div>,
    );
    expect(container.querySelector('[data-icon="x-close"]')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('img', { name: 'Help' })).toBeDefined();
    await expectNoAxeViolations(container);
  });

  it('forwards ref and DOM props', () => {
    const ref = createRef<SVGSVGElement>();
    render(<Icon name="mail-01" ref={ref} data-testid="mail" />);
    expect(ref.current).toBe(screen.getByTestId('mail'));
  });
});

describeGalleryInThemes(gallery);
