import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { figmaProgressBar, ProgressBar } from '.';
import { describeGalleryInThemes } from '../../test/theme';
import gallery from './ProgressBar.gallery';

const classesOf = (el: Element | null) => el?.getAttribute('class')?.split(' ') ?? [];
const part = (bar: HTMLElement, slot: string) => bar.querySelector<HTMLElement>(`[data-slot="${slot}"]`);

describe('ProgressBar', () => {
  it.each(Object.entries(figmaProgressBar.variants))('renders %s', async (_name, { props }) => {
    const { container } = render(<ProgressBar aria-label="Upload" {...props} />);
    const bar = screen.getByRole('progressbar', { name: 'Upload' });
    expect(bar.getAttribute('aria-valuenow')).toBe(String(props.value));
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(classesOf(part(bar, 'track'))).toEqual(expect.arrayContaining(['h-2', 'rounded-full', 'bg-quaternary']));
    expect(classesOf(part(bar, 'fill'))).toEqual(expect.arrayContaining(['rounded-full', 'bg-fg-brand-primary']));
    expect(part(bar, 'fill')?.style.width).toBe(`${props.value}%`);
    if (props.label === 'right') {
      expect(part(bar, 'value')?.textContent).toBe('60%');
      expect(classesOf(part(bar, 'value'))).toEqual(expect.arrayContaining(['text-sm', 'font-medium', 'text-secondary']));
      expect(classesOf(bar)).toEqual(expect.arrayContaining(['items-center', 'gap-lg']));
    } else {
      expect(part(bar, 'value')).toBeNull();
    }
    await expectNoAxeViolations(container);
  });

  it('puts the label below with Label=Bottom', () => {
    render(<ProgressBar aria-label="Upload" value={40} label="bottom" />);
    const bar = screen.getByRole('progressbar');
    expect(classesOf(bar)).toEqual(expect.arrayContaining(['flex-col', 'items-end', 'gap-md']));
    expect(part(bar, 'value')?.textContent).toBe('40%');
  });

  it.each([0, 10, 50, 100])('fills %s%%', value => {
    render(<ProgressBar aria-label="Upload" value={value} />);
    expect(part(screen.getByRole('progressbar'), 'fill')?.style.width).toBe(`${value}%`);
  });

  it('clamps out-of-range values and defaults to Label=False', () => {
    render(<ProgressBar aria-label="Upload" value={140} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
    expect(part(bar, 'fill')?.style.width).toBe('100%');
    expect(part(bar, 'value')).toBeNull();
  });

  it('merges className and forwards ref and DOM props', () => {
    const ref = createRef<HTMLDivElement>();
    render(<ProgressBar ref={ref} aria-label="Upload" value={5} className="w-80" data-testid="p" />);
    expect(ref.current).toBe(screen.getByTestId('p'));
    expect(classesOf(ref.current)).toContain('w-80');
    expect(classesOf(ref.current)).not.toContain('w-full');
  });
});

describeGalleryInThemes(gallery);
