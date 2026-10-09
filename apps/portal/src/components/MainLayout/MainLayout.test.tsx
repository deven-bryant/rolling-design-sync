import gallery from './MainLayout.gallery';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { MainLayout } from '.';

describe('MainLayout', () => {
  it('renders the slot content in a main landmark with the design spacing', async () => {
    const { container } = render(
      <MainLayout>
        <h1>Files</h1>
        <p>Synced files</p>
      </MainLayout>,
    );
    const main = screen.getByRole('main');
    expect(main.className).toBe('flex min-w-0 flex-1 flex-col gap-4xl overflow-x-clip bg-primary px-6xl py-3xl');
    expect(Array.from(main.children).map(c => c.textContent)).toEqual(['Files', 'Synced files']);
    await expectNoAxeViolations(container);
  });

  it('takes spacing only from tokens and never fixes a width', () => {
    render(<MainLayout data-testid="m" />);
    const classes = screen.getByTestId('m').className.split(' ');
    expect(classes.filter(c => /^(gap|p[xy]?)-/.test(c))).toEqual(['gap-4xl', 'px-6xl', 'py-3xl']);
    expect(classes.some(c => /^(w|max-w)-/.test(c) || /\[/.test(c))).toBe(false);
  });

  it('passes element, className, DOM props and ref through', async () => {
    const ref = createRef<HTMLElement>();
    const { container } = render(
      <MainLayout as="section" ref={ref} id="main" aria-label="Content" className="gap-xl">
        <p>Body</p>
      </MainLayout>,
    );
    const el = screen.getByRole('region', { name: 'Content' });
    expect(ref.current).toBe(el);
    expect(el.tagName).toBe('SECTION');
    expect(el.id).toBe('main');
    expect(el.className).toContain('gap-xl');
    expect(el.className).not.toContain('gap-4xl');
    await expectNoAxeViolations(container);
  });
});

describe('MainLayout under the dark theme', () => {
  it('renders its gallery examples with no axe violations', async () => {
    const dark = gallery.examples.filter(e => e.figma.endsWith('Color Mode=Dark'));
    expect(dark.length).toBeGreaterThan(0);
    const { container } = render(<div>{dark.map(e => <section key={e.figma} aria-label={e.figma}>{e.render()}</section>)}</div>);
    expect(container.querySelectorAll('[data-theme="dark"]')).toHaveLength(dark.length);
    await expectNoAxeViolations(container);
  });
});
