import { createElement, type ReactNode } from 'react';

/** One rendered example in the dev gallery, labelled with its Figma name. */
export interface GalleryExample {
  /** The Figma component / variant name, e.g. `arrow-right` or `Size=sm, Hierarchy=Primary`. */
  figma: string;
  render: () => ReactNode;
  /** The Figma set (or component) it renders, when it isn't the entry's (`GalleryEntry.figma`). */
  set?: string;
  /** The Figma variant string it renders, when the label isn't exactly that (e.g. it carries a set prefix). */
  variant?: string;
  /** Renders the example alone at its own gallery URL, without gallery-only wrappers; defaults to `render`. */
  renderAlone?: () => ReactNode;
}

/** The default export of a `Name.gallery.tsx` file. */
export interface GalleryEntry {
  /** The code component, e.g. `Icon`. */
  component: string;
  /** The Figma component set (or component) name its examples render, e.g. `Buttons/Button`; defaults to `component`. */
  figma?: string;
  examples: GalleryExample[];
}

/** A gallery example that can vary by theme, e.g. to keep landmark labels unique across both copies. */
export interface ThemedGalleryExample {
  figma: string;
  render: (theme: 'light' | 'dark') => ReactNode;
  set?: string;
  variant?: string;
}

/** The examples, then each again under `data-theme="dark"`, so a gallery entry shows both themes. */
export function inBothThemes(examples: ThemedGalleryExample[]): GalleryExample[] {
  return [
    ...examples.map(({ render, ...example }) => ({ ...example, render: () => render('light') })),
    ...examples.map(({ render, ...example }) => ({
      ...example,
      figma: `${example.figma} · Dark`,
      render: () => createElement('div', { 'data-theme': 'dark', className: 'rounded-md bg-primary p-md text-primary' }, render('dark')),
      renderAlone: () => render('dark'),
    })),
  ];
}
