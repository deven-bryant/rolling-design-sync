/**
 * `Thumbnail` (the image frame in `Node Details - Notes Screenshots` `198:82719` and `Node Details - Render Check`
 * `198:145401`) → `<ImageThumbnail>`; pressing it opens `<Lightbox>` (no Figma frame: a modal with the full image).
 */
export const figmaImageThumbnail = {
  instances: { 'Notes Screenshots / Thumbnail': '198:82719', 'Render Check / Thumbnail': '198:145400' },
  layers: {
    Thumbnail: 'rounded-md border border-secondary, image object-cover (h-20 w-32 for screenshots)',
    caption: 'text-xs text-tertiary (e.g. built-dark.png · 388 KB)',
  },
} as const;
