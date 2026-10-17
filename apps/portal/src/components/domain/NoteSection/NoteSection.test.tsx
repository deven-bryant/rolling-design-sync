import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import gallery from './NoteSection.gallery';
import { figmaNoteSection, NoteSection } from '.';

describe('NoteSection', () => {
  it('maps Property 1=Preview, and Default / Edit to NodeDetails', () => {
    expect(figmaNoteSection.axes['Property 1'].Preview.nodeId).toBe('198:106305');
    expect(figmaNoteSection.axes['Property 1'].Edit.props.state).toBe('add-change');
  });

  it('renders the title row, the note and its screenshots', () => {
    render(
      <NoteSection title="Open notes (1)" badge={<span>Requested</span>} actions={<button type="button">Edit</button>} meta="by alex" screenshots={<img alt="Shot" />}>
        Wrong gap.
      </NoteSection>,
    );
    const heading = screen.getByRole('heading', { name: 'Open notes (1)', level: 3 });
    const row = within(heading.parentElement!.parentElement!);
    expect(row.getByText('Requested')).toBeTruthy();
    expect(row.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByText('Wrong gap.').className).toContain('text-tertiary');
    expect(screen.getByText('by alex')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Shot' }).parentElement!.className).toContain('justify-end');
  });

  it('leaves out the empty parts', () => {
    const { container } = render(<NoteSection title="Open notes (2)" headingLevel="h4" />);
    expect(screen.getByRole('heading', { level: 4 })).toBeTruthy();
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('renders its gallery in both themes with no axe violations', async () => {
    const { container } = render(<div>{gallery.examples.map(e => <section key={e.figma} aria-label={e.figma}>{e.render()}</section>)}</div>);
    await expectNoAxeViolations(container);
  });
});
