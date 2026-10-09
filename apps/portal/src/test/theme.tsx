import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from './axe';

/** The shape of a `Name.gallery.tsx` default export. */
interface GalleryEntry {
  component: string;
  examples: { figma: string; render: () => ReactNode }[];
}

export const themes = ['light', 'dark'] as const;
export type DocumentTheme = (typeof themes)[number];

/** Sets `<html data-theme>` for every test in the enclosing `describe`. */
export function withDocumentTheme(theme: DocumentTheme): void {
  beforeEach(() => {
    document.documentElement.dataset.theme = theme;
  });
  afterEach(() => {
    delete document.documentElement.dataset.theme;
  });
}

/** Renders every example of a gallery entry under each theme and checks it with axe. */
export function describeGalleryInThemes(entry: GalleryEntry): void {
  describe.each(themes)(`${entry.component} gallery (%s theme)`, theme => {
    withDocumentTheme(theme);
    it.each(entry.examples.map(example => [example.figma, example] as const))(
      '%s renders without axe violations',
      async (_figma, example) => {
        const { container } = render(<>{example.render()}</>);
        expect(document.documentElement.dataset.theme).toBe(theme);
        expect(container.firstElementChild).not.toBeNull();
        await expectNoAxeViolations(container);
      },
    );
  });
}
