import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { Input as AriaInput, TextField } from 'react-aria-components';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Icon } from '../primitives';
import { HelpIcon, Input, InputHint, InputLabel } from '.';
import { describeGalleryInThemes } from '../../test/theme';
import gallery from './Input.gallery';

const classesOf = (el: Element | null | undefined) => (el?.getAttribute('class') ?? '').split(' ');
const frameOf = (input: HTMLElement) => input.parentElement;

const full = (
  <Input
    label="Email"
    required
    hint="This is a hint text to help user."
    tooltip="Used for claim notifications"
    iconLeading={<Icon name="mail-01" size="md" />}
    placeholder="olivia@untitledui.com"
  />
);

describe('Input', () => {
  it('renders Size=sm, Type=Default, State=Placeholder with every part', () => {
    render(full);
    const input = screen.getByRole('textbox', { name: 'Email' }) as HTMLInputElement;
    expect(input.placeholder).toBe('olivia@untitledui.com');
    expect(input.required).toBe(true);
    expect(classesOf(input)).toEqual(expect.arrayContaining(['text-md', 'text-primary', 'placeholder:text-placeholder']));
    expect(classesOf(frameOf(input))).toEqual(
      expect.arrayContaining(['rounded-md', 'border', 'border-primary', 'bg-primary', 'shadow-xs', 'px-lg', 'py-md', 'gap-md']),
    );
    expect(frameOf(input)?.querySelector('[data-icon="mail-01"]')).not.toBeNull();
    expect(screen.getByRole('img', { name: 'Used for claim notifications' }).getAttribute('data-icon')).toBe('help-circle');
    expect(classesOf(screen.getByText('*'))).toContain('text-brand-tertiary');
  });

  it('describes the input with the hint', () => {
    render(full);
    const input = screen.getByRole('textbox');
    const hint = screen.getByText('This is a hint text to help user.');
    expect(input.getAttribute('aria-describedby')).toContain(hint.id);
    expect(classesOf(hint)).toEqual(expect.arrayContaining(['text-sm', 'text-tertiary']));
  });

  it('focuses with Tab, accepts typing and shows the focus ring on the frame', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Input aria-label="Filter" onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: 'Filter' }) as HTMLInputElement;
    await user.tab();
    expect(document.activeElement).toBe(input);
    await user.keyboard('node');
    expect(input.value).toBe('node');
    expect(onChange).toHaveBeenLastCalledWith('node');
    expect(classesOf(frameOf(input))).toEqual(expect.arrayContaining(['focus-within:outline-2', 'outline-focus-ring']));
  });

  it('supports controlled values', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Input aria-label="Worker" value="devin" onChange={onChange} />);
    await user.type(screen.getByRole('textbox'), 'x');
    expect(onChange).toHaveBeenLastCalledWith('devinx');
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('devin');
  });

  it('disables the input', async () => {
    const user = userEvent.setup();
    render(<Input aria-label="Locked" isDisabled defaultValue="x" />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    await user.type(input, 'y');
    expect(input.value).toBe('x');
  });

  it('forwards ref to the input and className to the root', () => {
    const ref = createRef<HTMLInputElement>();
    const { container } = render(<Input ref={ref} aria-label="Ref" className="max-w-xs" data-testid="root" />);
    expect(ref.current).toBe(screen.getByRole('textbox'));
    expect(classesOf(container.firstElementChild)).toContain('max-w-xs');
  });

  it('exposes Label, Hint and HelpIcon for custom layouts', () => {
    expect(Input.Label).toBe(InputLabel);
    expect(Input.Hint).toBe(InputHint);
    expect(Input.HelpIcon).toBe(HelpIcon);
    render(
      <TextField>
        <Input.Label required>Custom</Input.Label>
        <AriaInput />
        <Input.Hint>Hint</Input.Hint>
      </TextField>,
    );
    const input = screen.getByRole('textbox', { name: 'Custom' });
    expect(input.getAttribute('aria-describedby')).toBe(screen.getByText('Hint').id);
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <div>
        {full}
        <Input aria-label="Filter" placeholder="Filter" />
        <Input label="Disabled" isDisabled />
      </div>,
    );
    await expectNoAxeViolations(container);
  });
});

describe('HelpIcon', () => {
  it('is a 16px fg-quaternary help-circle named by its label', () => {
    render(<HelpIcon label="Help" className="ml-xs" />);
    const icon = screen.getByRole('img', { name: 'Help' });
    expect(classesOf(icon)).toEqual(expect.arrayContaining(['size-4', 'text-fg-quaternary', 'ml-xs']));
  });
});

describeGalleryInThemes(gallery);
