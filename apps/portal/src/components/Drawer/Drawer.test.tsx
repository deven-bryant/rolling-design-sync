import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Button } from '../Button';
import { Icon } from '../primitives';
import { Drawer, type DrawerProps } from '.';

const classesOf = (el: Element | null) => el?.getAttribute('class')?.split(' ') ?? [];

function Example(props: Partial<DrawerProps>) {
  return (
    <Drawer isOpen onOpenChange={() => {}} {...props}>
      <Drawer.Header title="Team View" description="FRAME · 1:95540" icon={<Icon name="check-circle" />} />
      <Drawer.Body>
        <Drawer.Section title="What changed" subtitle="Since it was last cleared">
          <Button hierarchy="secondary">Inside</Button>
        </Drawer.Section>
      </Drawer.Body>
      <Drawer.Footer>
        <Button>Clear node</Button>
      </Drawer.Footer>
    </Drawer>
  );
}

function Controlled({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const [isOpen, setOpen] = useState(false);
  return (
    <>
      <Button onPress={() => setOpen(true)}>Open</Button>
      <Example
        isOpen={isOpen}
        onOpenChange={open => {
          setOpen(open);
          onOpenChange(open);
        }}
      />
    </>
  );
}

describe('Drawer', () => {
  it('names the dialog by its header title and renders the design layout', async () => {
    render(<Example />);
    const dialog = screen.getByRole('dialog', { name: 'Team View' });
    expect(screen.getByRole('heading', { name: 'Team View' })).toHaveProperty('className', 'text-lg font-semibold text-primary');
    expect(screen.getByText('FRAME · 1:95540').className).toContain('text-tertiary');
    const panel = dialog.parentElement;
    expect(classesOf(panel)).toEqual(expect.arrayContaining(['w-120', 'h-full', 'bg-primary', 'shadow-xl']));
    expect(classesOf(panel?.parentElement ?? null)).toEqual(expect.arrayContaining(['bg-overlay/70', 'fixed', 'inset-0', 'justify-end']));
    expect(classesOf(screen.getByRole('heading', { name: 'What changed' }).parentElement)).toEqual(
      expect.arrayContaining(['flex-col', 'gap-md']),
    );
    expect(classesOf(screen.getByRole('button', { name: 'Clear node' }).parentElement)).toEqual(
      expect.arrayContaining(['border-t', 'border-secondary', 'px-3xl', 'py-lg', 'gap-lg', 'justify-end']),
    );
    await expectNoAxeViolations(document.body);
  });

  it('keeps the 480px panel by default and has the Node drawer’s narrow and wide sizes', () => {
    const { rerender } = render(<Example />);
    expect(classesOf(screen.getByRole('dialog').parentElement)).toEqual(expect.arrayContaining(['w-120', 'max-w-full']));
    rerender(<Example size="narrow" />);
    let panel = classesOf(screen.getByRole('dialog').parentElement);
    expect(panel).toEqual(expect.arrayContaining(['w-126.25', 'p-lg', 'max-w-full', 'h-full', 'bg-primary', 'shadow-xl']));
    expect(panel).not.toContain('w-120');
    rerender(<Example size="wide" />);
    panel = classesOf(screen.getByRole('dialog').parentElement);
    expect(panel).toEqual(expect.arrayContaining(['w-275', 'p-lg', 'max-w-full']));
    expect(panel).not.toContain('w-126.25');
  });

  it('stays anchored to the right edge while its width changes', () => {
    render(<Example size="narrow" />);
    const panel = screen.getByRole('dialog').parentElement as HTMLElement;
    expect(classesOf(panel.parentElement)).toEqual(expect.arrayContaining(['flex', 'justify-end']));
    expect(classesOf(panel)).toContain('motion-safe:transition-[translate,width]');
  });

  it('omits the featured icon and supporting text when not given', () => {
    render(
      <Drawer isOpen>
        <Drawer.Header title="Only a title" />
      </Drawer>,
    );
    const heading = screen.getByRole('heading', { name: 'Only a title' });
    expect(heading.parentElement?.children).toHaveLength(1);
    expect(heading.parentElement?.previousElementSibling).toBeNull();
  });

  it('moves focus into the drawer and traps it there', async () => {
    const user = userEvent.setup();
    render(<Controlled onOpenChange={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Controlled onOpenChange={onOpenChange} />);
    const trigger = screen.getByRole('button', { name: 'Open' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('closes on a scrim click, but not on a click inside the panel', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Controlled onOpenChange={onOpenChange} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('heading', { name: 'What changed' }));
    expect(onOpenChange).not.toHaveBeenCalled();
    const scrim = screen.getByRole('dialog').parentElement?.parentElement as HTMLElement;
    await user.click(scrim);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes from the header close button', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Controlled onOpenChange={onOpenChange} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('only slides and fades when motion is allowed', () => {
    render(<Example />);
    const panel = screen.getByRole('dialog').parentElement as HTMLElement;
    const scrim = panel.parentElement as HTMLElement;
    for (const el of [panel, scrim]) {
      const transitions = classesOf(el).filter(c => c.includes('transition') || c.includes('duration'));
      expect(transitions.length).toBeGreaterThan(0);
      expect(transitions.every(c => c.startsWith('motion-safe:'))).toBe(true);
    }
    expect(classesOf(panel)).toEqual(expect.arrayContaining(['data-entering:translate-x-full', 'data-exiting:translate-x-full']));
  });
});
