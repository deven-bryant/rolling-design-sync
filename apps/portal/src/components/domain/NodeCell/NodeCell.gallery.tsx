import { useState } from 'react';
import { Table } from '../../Table';
import type { GalleryEntry } from '../../primitives';
import { NodeCell, figmaNodeCell } from '.';

function Tree() {
  const [open, setOpen] = useState(true);
  return (
    <Table className="w-84">
      <Table.Body>
        <Table.Row>
          <Table.Cell>
            <NodeCell name={figmaNodeCell.defaults.name} meta={figmaNodeCell.defaults.meta} expandable expanded={open} onToggle={setOpen} />
          </Table.Cell>
        </Table.Row>
        {open && (
          <>
            <Table.Row>
              <Table.Cell>
                <NodeCell name="Header" meta="INSTANCE · 1:95541 → Page header" depth={1} expandable />
              </Table.Cell>
            </Table.Row>
            <Table.Row>
              <Table.Cell>
                <NodeCell name="Style=Simple, Breakpoint=Desktop" meta="COMPONENT · 1:95540" depth={2} />
              </Table.Cell>
            </Table.Row>
          </>
        )}
      </Table.Body>
    </Table>
  );
}

export default {
  component: 'NodeCell',
  examples: [
    { figma: 'Node cell (Chevron=True)', render: () => <NodeCell {...figmaNodeCell.defaults} className="w-72" /> },
    { figma: 'Node cell (Chevron=False)', render: () => <NodeCell name="Team View" meta="FRAME · 1:95540" className="w-72" /> },
    { figma: 'Node tree (depth 0–2)', render: () => <Tree /> },
  ],
} satisfies GalleryEntry;
