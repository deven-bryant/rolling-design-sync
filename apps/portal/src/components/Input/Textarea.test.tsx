import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { figmaTextarea, Textarea } from '.';

describe('Textarea', () => {
  it('maps the Figma Textarea input field', () => {
    expect(figmaTextarea.variants[0].nodeId).toBe('173:32743');
  });

  it('labels a multi-line field, marks it required and describes it with the hint', async () => {
    const onChange = vi.fn();
    render(<Textarea label="Description" required tooltip="What to fix" placeholder="Enter a description..." hint="0/4000" onChange={onChange} />);
    const box = screen.getByRole('textbox', { name: /Description/ });
    expect(box.tagName).toBe('TEXTAREA');
    expect(box.getAttribute('placeholder')).toBe('Enter a description...');
    expect(box.hasAttribute('required')).toBe(true);
    expect(box.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText('0/4000')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'What to fix' })).toBeTruthy();
    await userEvent.setup().type(box, 'a{Enter}b');
    expect(onChange).toHaveBeenLastCalledWith('a\nb');
  });

  it('has no axe violations', async () => {
    const { container } = render(<Textarea label="Description" required hint="Hint" />);
    await expectNoAxeViolations(container);
  });
});
