import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { Text, textStyles } from '.';

describe('Text', () => {
  it('defaults to Text sm/Regular in text-primary', () => {
    render(<Text>Hello</Text>);
    const el = screen.getByText('Hello');
    expect(el.tagName).toBe('SPAN');
    expect(el.className).toBe('text-sm font-regular text-primary');
  });

  it.each(Object.keys(textStyles.variants.size))('applies size %s', size => {
    render(<Text size={size as keyof typeof textStyles.variants.size}>x</Text>);
    expect(screen.getByText('x').className).toContain(`text-${size}`);
  });

  it.each(Object.keys(textStyles.variants.weight))('applies weight %s', weight => {
    render(<Text weight={weight as keyof typeof textStyles.variants.weight}>x</Text>);
    expect(screen.getByText('x').className).toContain(`font-${weight}`);
  });

  it('applies color, truncate, element, className and ref', async () => {
    const ref = createRef<HTMLElement>();
    const { container } = render(
      <Text as="h1" ref={ref} size="lg" weight="semibold" color="tertiary" truncate className="text-secondary" id="t">
        Title
      </Text>,
    );
    const el = screen.getByRole('heading', { level: 1, name: 'Title' });
    expect(ref.current).toBe(el);
    expect(el.className).toBe('text-lg font-semibold truncate text-secondary');
    expect(el.id).toBe('t');
    await expectNoAxeViolations(container);
  });

  it('keeps the inherited color with color="inherit"', () => {
    render(<Text color="inherit">x</Text>);
    expect(screen.getByText('x').className).toBe('text-sm font-regular');
  });
});
