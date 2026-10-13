import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UNSTABLE_ToastQueue as ToastQueue } from 'react-aria-components';
import { afterEach, describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { describeGalleryInThemes } from '../../test/theme';
import { showToast, ToastCard, toastQueue, ToastRegion, type ToastData } from '.';
import gallery from './Toast.gallery';

describe('Toast', () => {
  afterEach(() => {
    for (const toast of toastQueue.visibleToasts) act(() => toastQueue.close(toast.key));
  });

  it('renders nothing until a toast is queued, then the message in a labelled region', async () => {
    render(<ToastRegion />);
    expect(screen.queryByRole('region', { name: 'Notifications' })).toBeNull();
    act(() => void showToast('Component key copied'));
    const region = await screen.findByRole('region', { name: 'Notifications' });
    const toast = within(region).getByRole('alertdialog');
    expect(toast.textContent).toContain('Component key copied');
    expect(toast.className).toContain('shadow-lg');
    expect(toast.querySelector('[data-icon="check-circle"]')).not.toBeNull();
    await expectNoAxeViolations(region);
  });

  it('shows an error tone and closes on Dismiss', async () => {
    const user = userEvent.setup();
    const queue = new ToastQueue<ToastData>();
    render(<ToastRegion queue={queue} />);
    act(() => void queue.add({ title: 'Couldn’t save', tone: 'error' }));
    const toast = await screen.findByRole('alertdialog');
    expect(toast.className).toContain('text-fg-error-primary');
    expect(toast.querySelector('[data-icon="alert-circle"]')).not.toBeNull();
    await user.click(within(toast).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('ToastCard forwards className and ref', () => {
    let el: HTMLDivElement | null = null;
    render(
      <ToastCard className="w-60" ref={node => void (el = node)}>
        Saved
      </ToastCard>,
    );
    expect(el).not.toBeNull();
    expect(el!.className).toContain('w-60');
    expect(el!.className).not.toContain('w-90');
  });
});

describeGalleryInThemes(gallery);
