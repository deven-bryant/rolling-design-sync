import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { Surface, surfaceStyles } from '.';

type Axis = keyof typeof surfaceStyles.variants;

describe('Surface', () => {
  it('defaults to a bg-primary div', () => {
    render(<Surface data-testid="s" />);
    const el = screen.getByTestId('s');
    expect(el.tagName).toBe('DIV');
    expect(el.className).toBe('bg-primary');
  });

  const cases = (Object.keys(surfaceStyles.variants) as Axis[]).flatMap(axis =>
    Object.entries(surfaceStyles.variants[axis])
      .filter(([, cls]) => cls)
      .map(([value, cls]) => [axis, value, cls] as const),
  );

  it.each(cases)('applies %s=%s', (axis, value, cls) => {
    render(<Surface data-testid="s" {...{ [axis]: value }} />);
    for (const c of cls.split(' ')) expect(screen.getByTestId('s').className).toContain(c);
  });

  it('applies element, className and ref', async () => {
    const ref = createRef<HTMLElement>();
    const { container } = render(
      <Surface as="aside" ref={ref} border="secondary" radius="xl" shadow="xs" padding="xl" className="p-2xl" aria-label="Panel">
        content
      </Surface>,
    );
    const el = screen.getByRole('complementary', { name: 'Panel' });
    expect(ref.current).toBe(el);
    expect(el.className).toBe('bg-primary border border-secondary rounded-xl shadow-xs p-2xl');
    await expectNoAxeViolations(container);
  });
});
