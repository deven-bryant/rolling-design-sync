import { inBothThemes, type GalleryEntry } from '../primitives';
import { Pagination } from './Pagination';

const noop = () => undefined;
/** Both theme copies render side by side, so each `nav` landmark needs its own name. */
const named = (label: string, theme: 'light' | 'dark') => (theme === 'dark' ? `${label}, dark theme` : label);

export default {
  component: 'Pagination',
  examples: inBothThemes([
    {
      figma: 'Type=Card default, Shape=Square, Breakpoint=Desktop',
      render: theme => <Pagination label={named('Pagination, first page', theme)} page={1} pageCount={10} onPageChange={noop} />,
    },
    {
      figma: 'Type=Card default · middle page (two ellipses)',
      render: theme => <Pagination label={named('Pagination, middle page', theme)} page={5} pageCount={10} onPageChange={noop} />,
    },
    {
      figma: 'Type=Card default · cursor mode (Page n)',
      render: theme => <Pagination label={named('Cursor pagination', theme)} page={2} hasNext onPageChange={noop} />,
    },
    {
      figma: '_Pagination number base · Shape=Square, State=Default / State=Hover/active', set: '_Pagination number base', variant: 'Shape=Square, State=Default / State=Hover/active',
      render: theme => <Pagination label={named('Page numbers', theme)} page={2} pageCount={3} onPageChange={noop} />,
    },
  ]),
} satisfies GalleryEntry;
