import { createElement, type ReactNode } from 'react';

/** One rendered example in the dev gallery, labelled with its Figma name. */
export interface GalleryExample {
  /** The Figma component / variant name, e.g. `arrow-right` or `Size=sm, Hierarchy=Primary`. */
  figma: string;
  render: () => ReactNode;
}

/** The default export of a `Name.gallery.tsx` file. */
export interface GalleryEntry {
  /** The code component, e.g. `Icon`. */
  component: string;
  examples: GalleryExample[];
}

/** A gallery example that can vary by theme, e.g. to keep landmark labels unique across both copies. */
export interface ThemedGalleryExample {
  figma: string;
  render: (theme: 'light' | 'dark') => ReactNode;
}

/** The examples, then each again under `data-theme="dark"`, so a gallery entry shows both themes. */
export function inBothThemes(examples: ThemedGalleryExample[]): GalleryExample[] {
  return [
    ...examples.map(example => ({ figma: example.figma, render: () => example.render('light') })),
    ...examples.map(example => ({
      figma: `${example.figma} · Dark`,
      render: () =>
        createElement('div', { 'data-theme': 'dark', className: 'rounded-md bg-primary p-md text-primary' }, example.render('dark')),
    })),
  ];
}
