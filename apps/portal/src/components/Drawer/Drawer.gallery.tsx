import { useState } from 'react';
import { Button } from '../Button';
import { Icon, Text, type GalleryEntry } from '../primitives';
import { Drawer, type DrawerProps } from '.';

function Example({ size }: Pick<DrawerProps, 'size'>) {
  const [isOpen, setOpen] = useState(false);
  return (
    <>
      <Button hierarchy="secondary" onPress={() => setOpen(true)}>
        Open drawer
      </Button>
      <Drawer isOpen={isOpen} onOpenChange={setOpen} size={size}>
        <Drawer.Header
          title="Style=Simple, Breakpoint=Desktop"
          description="COMPONENT · 1:95540"
          icon={<Icon name="check-circle" />}
        />
        <Drawer.Body>
          <Drawer.Section title="What changed" subtitle="Since it was last cleared at 3f2a9c1 (2 days ago)">
            <Text color="secondary">fills · bg-primary → bg-secondary</Text>
          </Drawer.Section>
          <Drawer.Section title="Claim" subtitle="devin · claimed 1m ago · lease expires in 14 min" />
        </Drawer.Body>
        <Drawer.Footer>
          <Button hierarchy="secondary" onPress={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onPress={() => setOpen(false)}>Clear node</Button>
        </Drawer.Footer>
      </Drawer>
    </>
  );
}

export default {
  component: 'Drawer',
  examples: [
    { figma: 'Node drawer · _Slide out menu header (Tabs=False, Breakpoint=Desktop)', render: () => <Example /> },
    { figma: 'Node drawer (State=Change History, size="narrow")', render: () => <Example size="narrow" /> },
    { figma: 'Node drawer (State=Change List, size="wide")', render: () => <Example size="wide" /> },
  ],
} satisfies GalleryEntry;
