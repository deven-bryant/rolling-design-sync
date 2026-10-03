import { Table } from '../../Table';
import type { GalleryEntry } from '../../primitives';
import { AgentCell, figmaAgentCell } from '.';

const { worker, when } = figmaAgentCell.defaults;

function InTable({ avatar }: { avatar: boolean }) {
  return (
    <Table className="w-45">
      <Table.Body>
        <Table.Row>
          <Table.Cell>
            <AgentCell worker={worker} when={when} avatar={avatar} />
          </Table.Cell>
        </Table.Row>
      </Table.Body>
    </Table>
  );
}

export default {
  component: 'AgentCell',
  examples: [
    { figma: 'Agent cell (Avatar=True)', render: () => <InTable avatar /> },
    { figma: 'Agent cell (Avatar=False)', render: () => <InTable avatar={false} /> },
    { figma: 'With token label', render: () => <AgentCell worker="devin-7f3a" tokenLabel="devin" when="claimed 1m ago" /> },
  ],
} satisfies GalleryEntry;
