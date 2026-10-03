import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Checkbox, CheckboxBase, Radio, RadioGroup } from '.';

const base = (container: Element) => container.querySelector('[aria-hidden="true"]');

describe('CheckboxBase', () => {
  it.each([
    ['sm', 'radio', false, ['size-4', 'rounded-full', 'border-primary']],
    ['sm', 'radio', true, ['size-4', 'rounded-full', 'bg-brand-solid']],
    ['md', 'checkbox', false, ['size-5', 'rounded-sm', 'border-primary']],
    ['md', 'checkbox', true, ['size-5', 'rounded-sm', 'bg-brand-solid']],
  ] as const)('draws Size=%s, Type=%s, Checked=%s', (size, type, checked, classes) => {
    const { container } = render(<CheckboxBase size={size} type={type} checked={checked} />);
    const cls = base(container)?.getAttribute('class') ?? '';
    for (const c of classes) expect(cls.split(' ')).toContain(c);
  });

  it('marks a checked radio with a dot and a checked box with a check', () => {
    const { container, rerender } = render(<CheckboxBase type="radio" checked />);
    expect(container.querySelector('span > span.rounded-full')).not.toBeNull();
    rerender(<CheckboxBase type="checkbox" size="md" checked />);
    expect(container.querySelector('svg path')?.getAttribute('d')).toMatch(/^M11\.667/);
    rerender(<CheckboxBase type="checkbox" size="md" indeterminate />);
    expect(container.querySelector('svg path')?.getAttribute('d')).toBe('M2.917 7h8.166');
  });

  it('is decorative, forwards ref and merges className', () => {
    const ref = createRef<HTMLSpanElement>();
    const { container } = render(<CheckboxBase ref={ref} className="mt-xxs" data-testid="b" />);
    expect(ref.current).toBe(screen.getByTestId('b'));
    expect(base(container)?.getAttribute('class')).toContain('mt-xxs');
  });
});

describe('Checkbox', () => {
  it('toggles with Space and click, and reports changes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox onChange={onChange}>Auto-clear</Checkbox>);
    const box = screen.getByRole('checkbox', { name: 'Auto-clear' });
    await user.tab();
    expect(document.activeElement).toBe(box);
    await user.keyboard(' ');
    expect((box as HTMLInputElement).checked).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByText('Auto-clear'));
    expect((box as HTMLInputElement).checked).toBe(false);
  });

  it('shows the focus ring only for keyboard focus', async () => {
    const user = userEvent.setup();
    const { container } = render(<Checkbox aria-label="Select row" size="md" />);
    await user.click(screen.getByRole('checkbox'));
    expect(base(container)?.getAttribute('class')).not.toContain('outline-focus-ring');
    await user.tab();
    await user.tab({ shift: true });
    expect(base(container)?.getAttribute('class')).toContain('outline-focus-ring');
  });

  it('exposes indeterminate as mixed and draws a dash', () => {
    const { container } = render(<Checkbox aria-label="Select all" size="md" isIndeterminate />);
    const box = screen.getByRole('checkbox') as HTMLInputElement;
    expect(box.indeterminate).toBe(true);
    expect(container.querySelector('svg path')?.getAttribute('d')).toBe('M2.917 7h8.166');
  });

  it('renders supporting text, offsets the sm base and forwards ref', () => {
    const ref = createRef<HTMLLabelElement>();
    const { container } = render(
      <Checkbox ref={ref} supportingText="Clear nodes once CI is green." className="w-full">
        Auto-clear
      </Checkbox>,
    );
    expect(ref.current?.tagName).toBe('LABEL');
    expect(ref.current?.className).toContain('w-full');
    expect(screen.getByText('Clear nodes once CI is green.').className).toContain('text-tertiary');
    expect(base(container)?.getAttribute('class')).toContain('mt-xxs');
  });

  it('does not toggle when disabled', async () => {
    const user = userEvent.setup();
    const { container } = render(<Checkbox aria-label="Locked" isDisabled />);
    await user.click(screen.getByRole('checkbox'));
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect(base(container)?.getAttribute('class')).toContain('border-disabled');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <div>
        <Checkbox aria-label="Select row" size="md" />
        <Checkbox aria-label="Select all" size="md" isIndeterminate />
        <Checkbox supportingText="Supporting">Label</Checkbox>
      </div>,
    );
    await expectNoAxeViolations(container);
  });
});

describe('Checkbox.Radio', () => {
  it('moves the selection with arrow keys inside a group', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RadioGroup aria-label="Workspace" defaultValue="design" onChange={onChange}>
        <Radio value="design">Design</Radio>
        <Radio value="engineering">Engineering</Radio>
      </RadioGroup>,
    );
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Design' }));
    await user.keyboard('{ArrowDown}');
    expect((screen.getByRole('radio', { name: 'Engineering' }) as HTMLInputElement).checked).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith('engineering');
  });

  it('draws the selected radio as the checked sm base', () => {
    const { container } = render(
      <RadioGroup aria-label="Workspace" defaultValue="a">
        <Radio value="a" aria-label="A" />
      </RadioGroup>,
    );
    const cls = base(container)?.getAttribute('class') ?? '';
    expect(cls).toContain('rounded-full');
    expect(cls).toContain('bg-brand-solid');
  });

  it('is exposed as compound parts', () => {
    expect(Checkbox.Radio).toBe(Radio);
    expect(Checkbox.RadioGroup).toBe(RadioGroup);
    expect(Checkbox.Base).toBe(CheckboxBase);
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <RadioGroup aria-label="Workspace" defaultValue="a">
        <Radio value="a" aria-label="A" />
        <Radio value="b">B</Radio>
      </RadioGroup>,
    );
    await expectNoAxeViolations(container);
  });
});
