import type { GalleryEntry } from '../primitives';
import { MainLayout } from './MainLayout';

const Block = ({ label }: { label: string }) => (
  <span className="block rounded-xs bg-utility-brand-200 px-md py-xs text-xs text-secondary">{label}</span>
);

export default {
  component: 'MainLayout',
  examples: [
    {
      figma: 'Main · Slot',
      render: () => (
        <MainLayout as="div" className="border border-dashed border-secondary">
          <Block label="Page header" />
          <Block label="Horizontal tabs" />
          <Block label="Filters" />
          <Block label="Table card" />
        </MainLayout>
      ),
    },
  ],
} satisfies GalleryEntry;
