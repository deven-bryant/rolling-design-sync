import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { Table } from '../../Table';
import { agentInitials } from '../AgentSprite';
import { AgentCell, figmaAgentCell } from '.';

const classesOf = (el: Element | null) => el?.getAttribute('class')?.split(' ') ?? [];

describe('AgentCell', () => {
  it('renders the Figma default inside Table.Cell', async () => {
    const { worker, when } = figmaAgentCell.defaults;
    const { container } = render(
      <Table>
        <Table.Body>
          <Table.Row>
            <Table.Cell>
              <AgentCell worker={worker} when={when} />
            </Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table>,
    );
    const name = screen.getByText(worker);
    expect(classesOf(name)).toEqual(expect.arrayContaining(['text-sm', 'font-medium', 'text-primary']));
    expect(classesOf(screen.getByText(when))).toEqual(expect.arrayContaining(['text-sm', 'font-regular', 'text-tertiary']));
    const cell = name.parentElement?.parentElement ?? null;
    expect(classesOf(cell)).toEqual(expect.arrayContaining(['flex', 'items-center', 'gap-lg']));
    const sprite = cell?.firstElementChild ?? null;
    expect(sprite?.textContent).toBe(agentInitials(worker));
    expect(classesOf(sprite)).toContain('size-8');
    await expectNoAxeViolations(container);
  });

  it('shows the token label beside the worker', () => {
    render(<AgentCell worker="devin-7f3a" tokenLabel="devin" when="claimed 1m ago" />);
    expect(screen.getByText('devin-7f3a', { exact: false }).textContent).toBe('devin-7f3a · devin');
    expect(classesOf(screen.getByText('· devin', { exact: false }))).toContain('text-tertiary');
  });

  it('hides the sprite with avatar={false}', () => {
    const { container } = render(<AgentCell worker="claude-local" when="claimed 2m ago" avatar={false} />);
    expect(container.querySelector('[data-state]')).toBeNull();
  });

  it('passes the sprite state through', () => {
    const { container } = render(<AgentCell worker="claude-local" spriteState="enter" />);
    expect(container.querySelector('[data-state]')?.getAttribute('data-state')).toBe('enter');
  });
});
