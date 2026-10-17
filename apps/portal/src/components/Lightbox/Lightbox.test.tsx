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
    await expectNoAxeViolations(document.body);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
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
