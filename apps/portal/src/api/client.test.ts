import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, CLIENT_ID, api, apiFetch, buildUrl, setSignInRedirect } from './client';
import { safeReturnPath, signIn } from './session';

const json = (status: number, body: unknown, type = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });

const problem = {
  type: 'https://github.com/deven-bryant/rolling-design-sync/blob/main/docs/errors.md#file-not-found',
  title: 'File not found',
  status: 404,
  code: 'file_not_found',
  detail: 'No file abc.',
  hint: 'List files with GET /v3/files.',
};

describe('apiFetch', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const redirect = vi.fn<(next: string) => void>();
  let restore: () => void;

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    restore = setSignInRedirect(redirect);
    window.history.replaceState(null, '', '/ui/files/abc/nodes?state=dirty');
  });

  afterEach(() => {
    restore();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    redirect.mockReset();
  });

  it('sends the client header, cookies and JSON', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true }));
    await expect(apiFetch('/v3/session', { method: 'POST', body: { token: 't' } })).resolves.toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/v3/session');
    expect(init?.credentials).toBe('same-origin');
    expect(init?.body).toBe('{"token":"t"}');
    const headers = new Headers(init?.headers);
    expect(headers.get('X-RDS-Client')).toBe(CLIENT_ID);
    expect(CLIENT_ID).toMatch(/^portal\/\d+\.\d+\.\d+/);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('Accept')).toBe('application/json');
  });

  it('fills path parameters and the query string', async () => {
    fetchMock.mockResolvedValue(json(200, { nodes: [] }));
    await api.get('/v3/files/{fileKey}/nodes', {
      path: { fileKey: 'a/b' },
      query: { state: 'dirty', category: ['color', 'layout'], cursor: undefined, depth: 1 },
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v3/files/a%2Fb/nodes?state=dirty&category=color%2Clayout&depth=1');
    expect(() => buildUrl('/v3/files/{fileKey}')).toThrow('Missing path parameter "fileKey"');
  });

  it('maps problem JSON to a typed ApiError', async () => {
    fetchMock.mockResolvedValue(json(404, problem, 'application/problem+json'));
    const error = await apiFetch('/v3/files/abc').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: 'file_not_found', message: 'No file abc.', hint: problem.hint });
    expect((error as ApiError).problem).toEqual(problem);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('builds an ApiError when the body is not a problem', async () => {
    fetchMock.mockResolvedValue(new Response('Bad gateway', { status: 502, statusText: 'Bad Gateway' }));
    await expect(apiFetch('/v3/files')).rejects.toMatchObject({ status: 502, code: 'internal_error', message: 'Bad gateway' });
  });

  it('maps a failed request to a network ApiError', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(apiFetch('/v3/files')).rejects.toMatchObject({ status: 0, code: 'network_error', message: 'Failed to fetch' });
  });

  it('redirects to sign-in on 401, preserving where the user was', async () => {
    fetchMock.mockResolvedValue(json(401, { ...problem, status: 401, code: 'unauthorized', title: 'Missing bearer token' }));
    await expect(apiFetch('/v3/files')).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
    expect(redirect).toHaveBeenCalledWith('/ui/files/abc/nodes?state=dirty');
  });

  it('does not redirect when signing in fails', async () => {
    fetchMock.mockResolvedValue(json(401, { ...problem, status: 401, code: 'invalid_token', title: 'Invalid bearer token' }));
    await expect(signIn('nope')).rejects.toMatchObject({ code: 'invalid_token' });
    expect(redirect).not.toHaveBeenCalled();
  });

  it('returns undefined for 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(apiFetch('/v3/session', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});

describe('safeReturnPath', () => {
  it.each([
    [null, '/ui/files'],
    ['/ui/activity?x=1', '/ui/activity?x=1'],
    ['/ui/sign-in?next=/ui/', '/ui/files'],
    ['https://evil.example/ui/', '/ui/files'],
    ['//evil.example/ui/', '/ui/files'],
    ['/v3/files', '/ui/files'],
    ['/ui/\\evil', '/ui/files'],
  ])('%s → %s', (next, expected) => {
    expect(safeReturnPath(next)).toBe(expected);
  });
});
