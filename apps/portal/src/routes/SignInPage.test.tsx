import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { FakeEventSource } from '../test/fake-event-source';
import { ThemeProvider } from '../theme';
import { routes } from './router';

const fetchMock = vi.fn<typeof fetch>();

function renderAt(url: string) {
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  const { container } = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return Object.assign(router, { container });
}

const problem = (status: number, code: string, title: string, hint?: string) =>
  new Response(JSON.stringify({ type: 'about:blank', status, code, title, detail: title, hint }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });

describe('SignInPage', () => {
  beforeEach(() => {
    FakeEventSource.reset();
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('posts the token and goes back to where the user was', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      if (input === '/v3/session' && init?.method === 'POST')
        return new Response(JSON.stringify({ role: 'viewer', label: 'me', expiresAt: '2026-10-02T00:00:00Z' }), { status: 200 });
      return problem(404, 'not_found', 'Not found');
    });
    const router = renderAt('/sign-in?next=%2Fui%2Factivity%3Fpaused%3D1');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Token/), '  secret-token ');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/activity'));
    expect(router.state.location.search).toBe('?paused=1');
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(post?.[1]?.body).toBe('{"token":"secret-token"}');
    expect(new Headers(post?.[1]?.headers).get('X-RDS-Client')).toMatch(/^portal\//);
    expect(await screen.findByRole('heading', { level: 1, name: 'Activity' })).toBeDefined();
  });

  it('shows the API error and hint, and stays on the page', async () => {
    fetchMock.mockResolvedValue(problem(401, 'invalid_token', 'Invalid bearer token', 'Use a viewer or agent token.'));
    const router = renderAt('/sign-in');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Token/), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Invalid bearer token')).toBeDefined();
    expect(screen.getByText('Use a viewer or agent token.')).toBeDefined();
    expect(router.state.location.pathname).toBe('/sign-in');
  });

  it('requires a token and is accessible', async () => {
    const { container } = renderAt('/sign-in');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Token/).getAttribute('type')).toBe('password');
    await expectNoAxeViolations(container);
  });
});
