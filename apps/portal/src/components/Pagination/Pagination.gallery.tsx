import type { GalleryEntry } from '../primitives';
import { Pagination } from './Pagination';

const noop = () => undefined;

export default {
  component: 'Pagination',
  examples: [
    {
      figma: 'Type=Card default, Shape=Square, Breakpoint=Desktop',
      render: () => <Pagination label="Pagination, first page" page={1} pageCount={10} onPageChange={noop} />,
    },
    {
      figma: 'Type=Card default · middle page (two ellipses)',
      render: () => <Pagination label="Pagination, middle page" page={5} pageCount={10} onPageChange={noop} />,
    },
    {
      figma: 'Type=Card default · cursor mode (Page n)',
      render: () => <Pagination label="Cursor pagination" page={2} hasNext onPageChange={noop} />,
    },
    {
      figma: '_Pagination number base · Shape=Square, State=Default / State=Hover/active',
      render: () => <Pagination label="Page numbers" page={2} pageCount={3} onPageChange={noop} />,
    },
  ],
} satisfies GalleryEntry;
