import type { ReactNode } from 'react';

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
