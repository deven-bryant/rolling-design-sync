import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { GalleryPage, galleryEntries } from './GalleryPage';

describe('GalleryPage', () => {
  // Open list: component tasks add gallery files in parallel, so this checks the
  // primitives are collected and never enumerates components (an exact list
  // would conflict on every parallel merge).
  it('collects the gallery files, primitives included', () => {
    expect(galleryEntries.map(e => e.component)).toEqual(
      expect.arrayContaining(['Icon', 'Inline', 'Stack', 'Surface', 'Text', 'VisuallyHidden']),
    );
  });

  // Renders every component's gallery and runs axe over all of it, so it grows
  // with each component and outlasts Vitest's 5 s default on slow CI runners.
  it('lists each example by its Figma name', { timeout: 60_000 }, async () => {
    const { container } = render(<GalleryPage />);
    const icons = screen.getByRole('region', { name: 'Icon' });
    for (const name of ['arrow-right', 'bar-chart-square-02', 'placeholder', 'x-close']) {
      expect(within(icons).getByText(name)).toBeDefined();
      expect(icons.querySelector(`[data-icon="${name}"]`)).not.toBeNull();
    }
    expect(within(screen.getByRole('region', { name: 'Text' })).getByText('Text sm/Regular')).toBeDefined();
    await expectNoAxeViolations(container);
  });
});
