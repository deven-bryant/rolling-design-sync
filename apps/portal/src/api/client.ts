import type { paths } from './schema';
import { ApiError, networkError, problemFrom } from './problem';

export const CLIENT_HEADER = 'X-RDS-Client';
export const CLIENT_ID = `portal/${__PORTAL_VERSION__}`;
export const SIGN_IN_PATH = '/ui/sign-in';

/** Where a 401 sends the browser; tests replace it. */
let redirectToSignIn = (next: string): void => {
  window.location.assign(`${SIGN_IN_PATH}?next=${encodeURIComponent(next)}`);
};

export function setSignInRedirect(fn: (next: string) => void): () => void {
  const previous = redirectToSignIn;
  redirectToSignIn = fn;
  return () => {
    redirectToSignIn = previous;
  };
}

/** The current location to come back to after signing in (never the sign-in page itself). */
export function currentLocation(): string {
  const { pathname, search, hash } = window.location;
  return pathname.startsWith(SIGN_IN_PATH) ? '/ui/' : `${pathname}${search}${hash}`;
}

type Query = Record<string, string | number | boolean | null | undefined | (string | number)[]>;

export interface RequestOptions extends Omit<RequestInit, 'body' | 'credentials'> {
  /** Values for `{name}` placeholders in the path. */
  path?: Record<string, string>;
  query?: Query;
  /** Sent as JSON. */
  body?: unknown;
  /** Set false where a 401 is an expected answer (sign-in itself, session probes). */
  redirectOnUnauthorized?: boolean;
}

/** Fills `{name}` placeholders and appends the query string. */
export function buildUrl(template: string, pathParams: Record<string, string> = {}, query: Query = {}): string {
  const path = template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = pathParams[name];
    if (value === undefined) throw new Error(`Missing path parameter "${name}" for ${template}`);
    return encodeURIComponent(value);
  });
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(','));
    } else params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * `fetch` for the v3 API: same-origin cookies, the portal client header (the API's CSRF check
 * for cookie-authenticated writes), JSON in and out, problem bodies thrown as `ApiError`, and a
 * 401 sending the browser to sign-in and back.
 */
export async function apiFetch<T = unknown>(template: string, options: RequestOptions = {}): Promise<T> {
  const { path, query, body, redirectOnUnauthorized = true, headers, ...init } = options;
  const requestHeaders = new Headers(headers);
  requestHeaders.set(CLIENT_HEADER, CLIENT_ID);
  if (!requestHeaders.has('Accept')) requestHeaders.set('Accept', 'application/json');
  if (body !== undefined) requestHeaders.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await fetch(buildUrl(template, path, query), {
      ...init,
      headers: requestHeaders,
      credentials: 'same-origin',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw networkError(cause);
  }

  if (!response.ok) {
    const error = await problemFrom(response);
    if (response.status === 401 && redirectOnUnauthorized) redirectToSignIn(currentLocation());
    throw error;
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

type Operation<P extends keyof paths, M extends Method> = M extends keyof paths[P] ? NonNullable<paths[P][M]> : never;

type SuccessBody<Op> = Op extends { responses: infer R }
  ? {
      [S in keyof R]: S extends 200 | 201 | 202 ? (R[S] extends { content: { 'application/json': infer B } } ? B : never) : never;
    }[keyof R]
  : unknown;

export type PathsWith<M extends Method> = {
  [P in keyof paths]: paths[P] extends Record<M, object> ? P : never;
}[keyof paths];

/** The JSON a route answers with on success, from the generated schema. */
export type ApiResponse<P extends keyof paths, M extends Method = 'get'> = SuccessBody<Operation<P, M>>;

/** Typed shorthands over the generated schema: `api.get('/v3/files/{fileKey}', { path: { fileKey } })`. */
export const api = {
  get: <P extends PathsWith<'get'>>(p: P, options?: RequestOptions) =>
    apiFetch<ApiResponse<P, 'get'>>(p, { ...options, method: 'GET' }),
  post: <P extends PathsWith<'post'>>(p: P, options?: RequestOptions) =>
    apiFetch<ApiResponse<P, 'post'>>(p, { ...options, method: 'POST' }),
  patch: <P extends PathsWith<'patch'>>(p: P, options?: RequestOptions) =>
    apiFetch<ApiResponse<P, 'patch'>>(p, { ...options, method: 'PATCH' }),
  delete: <P extends PathsWith<'delete'>>(p: P, options?: RequestOptions) =>
    apiFetch<ApiResponse<P, 'delete'>>(p, { ...options, method: 'DELETE' }),
};

export { ApiError };
