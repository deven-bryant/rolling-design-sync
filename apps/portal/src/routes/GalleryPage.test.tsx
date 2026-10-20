import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { ThemeProvider } from '../theme';
import { GalleryPage, GalleryRoute, galleryEntries } from './GalleryPage';
import { galleryHref } from './galleryTargets';

function renderRoute(url: string) {
  const router = createMemoryRouter(['gallery', '_gallery'].map(path => ({ path, Component: GalleryRoute })), { initialEntries: [url] });
  return render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
}

const target = (container: Element) => container.querySelector('[data-rds-target]');

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

describe('GalleryRoute', () => {
  it('shows the whole gallery without parameters', () => {
    const { container } = renderRoute('/gallery');
    expect(screen.getByRole('heading', { level: 1, name: 'Component gallery' })).toBeDefined();
    expect(screen.getByRole('region', { name: 'Icon' })).toBeDefined();
    expect(target(container)).toBeNull();
  });

  it('renders only the addressed example, inside data-rds-target', async () => {
    const { container } = renderRoute(galleryHref({ set: 'arrow-right', variant: '' }));
    expect(screen.queryByRole('heading', { name: 'Component gallery' })).toBeNull();
    expect(screen.queryByText('arrow-right')).toBeNull();
    const wrapper = target(container);
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelectorAll('[data-icon]')).toHaveLength(1);
    expect(wrapper?.querySelector('[data-icon="arrow-right"]')).not.toBeNull();
    expect(wrapper?.className).toContain('w-fit');
    expect(container.querySelector('style')?.textContent).toContain('animation:none');
    await expectNoAxeViolations(container);
  });

  it('matches the variant in any property order', async () => {
    const { container } = renderRoute(
      `/gallery?${new URLSearchParams({ figma: 'Badge', variant: 'Color=Brand,Icon=False, Type=Pill color,Size=sm' })}`,
    );
    const wrapper = target(container);
    expect(wrapper).not.toBeNull();
    expect(within(wrapper as HTMLElement).getAllByText('Label')).toHaveLength(1);
    await expectNoAxeViolations(container);
  });

  it('takes the theme from Color Mode or ?theme=, else the portal', () => {
    const neutral = renderRoute(galleryHref({ set: 'arrow-right', variant: '' }));
    expect(target(neutral.container)?.getAttribute('data-theme')).toBe(document.documentElement.dataset.theme);
    neutral.unmount();

    const dark = renderRoute(`${galleryHref({ set: 'arrow-right', variant: '' })}&theme=dark`);
    expect(target(dark.container)?.getAttribute('data-theme')).toBe('dark');
    // `inBothThemes`' dark copy renders alone, without the gallery's padded dark wrapper.
    expect(target(dark.container)?.querySelector('[data-theme]')).toBeNull();
    dark.unmount();

    const mode = renderRoute(galleryHref({ set: 'Badge', variant: 'Size=sm, Type=Pill color, Icon=False, Color=Brand, Color Mode=Dark' }));
    expect(target(mode.container)?.getAttribute('data-theme')).toBe('dark');
  });

  it('answers a plain 404 message for an unknown example', async () => {
    const { container } = renderRoute(galleryHref({ set: 'Nope', variant: 'Size=sm' }));
    expect(screen.getByRole('heading', { level: 1, name: /404/ })).toBeDefined();
    expect(screen.getByText(/matches figma “Nope” and variant “Size=sm”/)).toBeDefined();
    expect(target(container)).toBeNull();
    await expectNoAxeViolations(container);
  });
});
