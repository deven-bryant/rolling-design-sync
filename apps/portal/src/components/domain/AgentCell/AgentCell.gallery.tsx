import { Table } from '../../Table';
import type { GalleryEntry, GalleryExample } from '../../primitives';
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


const themes = [
  ['Light', undefined],
  ['Dark', 'dark'],
] as const;

/** Each example once per theme: `Color Mode` is the `data-theme` it renders under, never a prop. */
const bothThemes = (examples: { figma: string; render: (mode: string) => ReturnType<GalleryExample['render']> }[]) =>
  themes.flatMap(([mode, theme]) =>
    examples.map(({ figma, render }): GalleryExample => ({
      figma: `${figma} · Color Mode=${mode}`,
      render: () => (
        <div data-theme={theme} className="bg-primary">
          {render(mode)}
        </div>
      ),
    })),
  );

export default {
  component: 'AgentCell',
  figma: 'Agent cell',
  examples: bothThemes([
    { figma: 'Agent cell (Avatar=True)', render: () => <InTable avatar /> },
    { figma: 'Agent cell (Avatar=False)', render: () => <InTable avatar={false} /> },
    { figma: 'With token label', render: () => <AgentCell worker="devin-7f3a" tokenLabel="devin" when="claimed 1m ago" /> },
  ]),
} satisfies GalleryEntry;
