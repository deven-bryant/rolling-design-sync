import gallery from './TokenValue.gallery';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { TokenValue } from '.';

const classesOf = (el: Element | null) => el?.getAttribute('class')?.split(' ') ?? [];

describe('TokenValue', () => {
  it('renders a color value after a decorative swatch in that color', async () => {
    const { container } = render(<TokenValue swatch="#2B3033">#2B3033</TokenValue>);
    const swatch = container.querySelector<HTMLElement>('[data-slot="swatch"]');
    expect(swatch?.getAttribute('aria-hidden')).toBe('true');
    expect(swatch?.style.backgroundColor).toBe('rgb(43, 48, 51)');
    expect(classesOf(swatch)).toEqual(expect.arrayContaining(['size-3', 'rounded-xs', 'border', 'border-primary']));
    expect(screen.getByText('#2B3033')).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('renders other values without a swatch', () => {
    const { container } = render(<TokenValue>16</TokenValue>);
    expect(container.querySelector('[data-slot="swatch"]')).toBeNull();
    expect(container.textContent).toBe('16');
  });

  it('passes className and DOM props through', () => {
    const { container } = render(
      <TokenValue className="text-tertiary" title="gray/800">
        gray-800
      </TokenValue>,
    );
    expect(classesOf(container.firstElementChild)).toEqual(expect.arrayContaining(['inline-flex', 'text-tertiary']));
    expect(container.firstElementChild?.getAttribute('title')).toBe('gray/800');
  });
});

describe('TokenValue under the dark theme', () => {
  it('renders its gallery examples with no axe violations', async () => {
    const dark = gallery.examples.filter(e => e.figma.endsWith('Color Mode=Dark'));
    expect(dark.length).toBeGreaterThan(0);
    const { container } = render(<div>{dark.map(e => <section key={e.figma} aria-label={e.figma}>{e.render()}</section>)}</div>);
    expect(container.querySelectorAll('[data-theme="dark"]')).toHaveLength(dark.length);
    await expectNoAxeViolations(container);
  });
});
