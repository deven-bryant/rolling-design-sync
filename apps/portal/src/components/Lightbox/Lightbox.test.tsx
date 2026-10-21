import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import gallery from './Lightbox.gallery';
import { ImageThumbnail } from '.';
import { sampleImage } from './sample';

describe('ImageThumbnail', () => {
  it('shows the thumbnail and opens the full image in a lightbox, closed by Escape', async () => {
    const user = userEvent.setup();
    const { container } = render(<ImageThumbnail src="/thumb.webp" fullSrc="/full.png" alt="Screenshot 1" caption="shot.png · 4 KB" />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/thumb.webp');
    expect(screen.getByText('shot.png · 4 KB')).toBeTruthy();
    await expectNoAxeViolations(container);
    await user.click(screen.getByRole('button', { name: 'View Screenshot 1' }));
    const dialog = await screen.findByRole('dialog', { name: 'Screenshot 1' });
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe('/full.png');
    expect(dialog.querySelector('img')?.className).toContain('bg-checkerboard');
    await expectNoAxeViolations(document.body);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the whole thumbnail on a light backdrop, never cropped', () => {
    render(<ImageThumbnail src="/thumb.webp" alt="Screenshot 1" />);
    const frame = screen.getByRole('button', { name: 'View Screenshot 1' });
    expect(frame.className).toContain('bg-checkerboard');
    expect(frame.className).toContain('h-20 w-32');
    expect(frame.querySelector('img')?.className).toContain('object-contain');
    expect(frame.querySelector('img')?.className).not.toContain('object-cover');
  });

  it('takes the image aspect ratio, as wide as fits up to maxHeight', () => {
    render(<ImageThumbnail src="/thumb.webp" alt="Wide" aspect={{ width: 400, height: 100 }} maxHeight={50} />);
    const frame = screen.getByRole('button', { name: 'View Wide' });
    expect(frame.style.aspectRatio).toBe('400 / 100');
    expect(frame.style.width).toBe('min(100%, 200px)');
    expect(frame.className).not.toContain('h-20');
  });

  it('closes from its close button', async () => {
    const user = userEvent.setup();
    render(<ImageThumbnail src={sampleImage()} alt="Heatmap" />);
    await user.click(screen.getByRole('button', { name: 'View Heatmap' }));
    await user.click(await screen.findByRole('button', { name: 'Close image' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders its gallery in both themes with no axe violations', async () => {
    const { container } = render(<div>{gallery.examples.map(e => <section key={e.figma} aria-label={e.figma}>{e.render()}</section>)}</div>);
    await expectNoAxeViolations(container);
  });
});
