/** An RFC 9457 problem as the v3 API returns it (`apps/api/src/v3/problem.js`). */
export interface Problem {
  type: string;
  title: string;
  status: number;
  /** Stable machine-readable code, e.g. `invalid_token` (docs/errors.md). */
  code: string;
  detail: string;
  /** What to do about it. */
  hint?: string;
  [extra: string]: unknown;
}

/** A failed API call: the problem body when the API sent one, otherwise one built from the response. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly hint: string | undefined;
  readonly problem: Problem;

  constructor(problem: Problem) {
    super(problem.detail || problem.title);
    this.name = 'ApiError';
    this.status = problem.status;
    this.code = problem.code;
    this.hint = problem.hint;
    this.problem = problem;
  }
}

const isProblem = (body: unknown): body is Problem =>
  typeof body === 'object' &&
  body !== null &&
  typeof (body as Problem).status === 'number' &&
  typeof (body as Problem).code === 'string' &&
  typeof (body as Problem).title === 'string';

/** Builds the ApiError for a non-2xx response. */
export async function problemFrom(response: Response): Promise<ApiError> {
  const text = await response.text().catch(() => '');
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (isProblem(body)) return new ApiError({ ...body, detail: body.detail ?? body.title });
  const title = response.statusText || `HTTP ${response.status}`;
  return new ApiError({
    type: 'about:blank',
    title,
    status: response.status,
    code: response.status >= 500 ? 'internal_error' : 'http_error',
    detail: text && text.length < 500 ? text : title,
  });
}

/** A request that never got a response (offline, DNS, CORS). */
export const networkError = (cause: unknown): ApiError =>
  new ApiError({
    type: 'about:blank',
    title: 'Network error',
    status: 0,
    code: 'network_error',
    detail: cause instanceof Error ? cause.message : 'The API could not be reached.',
    hint: 'Check that the API is running and reachable from this browser.',
  });
