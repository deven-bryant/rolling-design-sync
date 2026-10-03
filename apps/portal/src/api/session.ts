import { apiFetch } from './client';

/** The signed-in session (`GET /v3/session`). */
export interface Session {
  role: 'viewer' | 'agent';
  label: string;
  expiresAt: string;
}

/** Mints the session cookie from a viewer or agent token (`POST /v3/session`). */
export const signIn = (token: string) =>
  apiFetch<Session>('/v3/session', { method: 'POST', body: { token }, redirectOnUnauthorized: false });

/** The current session; signed out sends the browser to sign-in unless `redirectOnUnauthorized` is false. */
export const getSession = ({ redirectOnUnauthorized = true } = {}) =>
  apiFetch<Session>('/v3/session', { redirectOnUnauthorized });

export const signOut = () => apiFetch<void>('/v3/session', { method: 'DELETE', redirectOnUnauthorized: false });

/** A safe place to return to after sign-in: a portal path, never another origin or the sign-in page. */
export function safeReturnPath(next: string | null): string {
  if (!next || !next.startsWith('/ui/') || next.startsWith('//') || next.includes('\\')) return '/ui/files';
  if (next.startsWith('/ui/sign-in')) return '/ui/files';
  return next;
}
