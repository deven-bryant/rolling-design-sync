import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import gallery from './LoadingIndicator.gallery';
import { LoadingIndicator } from '.';

const classesOf = (el: Element | null | undefined) => (el?.getAttribute('class') ?? '').split(' ');

describe('LoadingIndicator', () => {
  it('is a status with a visible label and a reduced-motion-safe spinner', async () => {
    const { container } = render(<LoadingIndicator label="Loading nodes…" />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Loading nodes…');
    const spinner = container.querySelector('svg');
    expect(spinner?.getAttribute('aria-hidden')).toBe('true');
    expect(classesOf(spinner)).toEqual(expect.arrayContaining(['size-4', 'animate-spin', 'motion-reduce:animate-none', 'text-fg-brand-primary']));
    await expectNoAxeViolations(container);
  });

  it('defaults its label and sizes md for sections', () => {
    const { container } = render(<LoadingIndicator size="md" />);
    expect(screen.getByRole('status').textContent).toBe('Loading…');
    expect(classesOf(container.querySelector('svg'))).toContain('size-5');
  });

  it('keeps a hidden label for assistive tech', async () => {
    const { container } = render(<LoadingIndicator hideLabel label="Loading render check" className="ml-md" />);
    const status = screen.getByRole('status', { name: '' });
    expect(status.textContent).toBe('Loading render check');
    expect(classesOf(status)).toContain('ml-md');
    await expectNoAxeViolations(container);
  });

  it('renders its gallery in both themes with no axe violations', async () => {
    const { container } = render(
      <div>
        {gallery.examples.map(e => (
          <section key={e.figma} aria-label={e.figma}>
            {e.render()}
          </section>
        ))}
      </div>,
    );
    expect(container.querySelectorAll('[data-theme="dark"]').length).toBe(2);
    await expectNoAxeViolations(container);
  });
});
