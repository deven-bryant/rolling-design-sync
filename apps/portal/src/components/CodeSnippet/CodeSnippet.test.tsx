import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { CodeSnippet } from '.';
import { describeGalleryInThemes } from '../../test/theme';
import gallery from './CodeSnippet.gallery';

const code = 'const a = 1;\nconst b = 2;\nexport { a, b };';

describe('CodeSnippet', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('Type=Simple: line numbers and monospace code', async () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(<CodeSnippet ref={ref} code={code} className="w-180" data-testid="snippet" />);
    const snippet = screen.getByTestId('snippet');
    expect(ref.current).toBe(snippet);
    for (const c of ['rounded-xl', 'border-secondary', 'bg-primary', 'w-180']) expect(snippet.className).toContain(c);
    const pre = snippet.querySelector('pre')!;
    expect(pre.textContent).toBe(code);
    expect(pre.className).toContain('font-mono');
    const numbers = snippet.querySelector('[aria-hidden]')!;
    expect([...numbers.children].map(n => n.textContent)).toEqual(['1', '2', '3']);
    expect(numbers.className).toContain('bg-secondary');
    expect(screen.queryByRole('button')).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('hides line numbers and renders the tabs slot', () => {
    render(<CodeSnippet code={code} lineNumbers={false} tabs={<div role="tablist" aria-label="Files" />} data-testid="snippet" />);
    expect(screen.getByRole('tablist', { name: 'Files' })).toBeDefined();
    expect(screen.getByTestId('snippet').querySelector('[aria-hidden]')).toBeNull();
  });

  it('copies the code to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const onCopy = vi.fn();
    const { container } = render(<CodeSnippet code={code} copyLabel="Copy code" onCopy={onCopy} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(writeText).toHaveBeenCalledWith(code);
    await waitFor(() => expect(onCopy).toHaveBeenCalledOnce());
    await expectNoAxeViolations(container);
  });
});

describeGalleryInThemes(gallery);
