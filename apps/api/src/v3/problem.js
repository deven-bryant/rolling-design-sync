'use strict';

/*
 * RFC 9457 problem details for every v3 error (docs/api-v3-design.md,
 * "Errors"), with two extra members: `code` (stable, machine-readable) and
 * `hint` (what to do about it).
 */

const ERRORS_DOC = 'https://github.com/deven-bryant/rolling-design-sync/blob/main/docs/errors.md';
const CONTENT_TYPE = 'application/problem+json';

/** Every v3 error code, with its HTTP status and title. docs/errors.md has one section per code. */
const CODES = Object.freeze({
  bad_request: { status: 400, title: 'Bad request' },
  invalid_parameter: { status: 400, title: 'Invalid parameter' },
  unknown_parameter: { status: 400, title: 'Unknown parameter' },
  invalid_body: { status: 400, title: 'Invalid request body' },
  invalid_cursor: { status: 400, title: 'Invalid cursor' },
  invalid_url: { status: 400, title: 'Not a Figma link' },
  url_mismatch: { status: 400, title: 'Link does not match the path' },
  unauthorized: { status: 401, title: 'Missing bearer token' },
  invalid_token: { status: 401, title: 'Invalid bearer token' },
  wrong_token_class: { status: 403, title: 'Wrong token class' },
  csrf_rejected: { status: 403, title: 'Request rejected' },
  forbidden: { status: 403, title: 'Forbidden' },
  file_not_found: { status: 404, title: 'File not found' },
  node_not_found: { status: 404, title: 'Node not found' },
  claim_not_found: { status: 404, title: 'Claim not found' },
  note_not_found: { status: 404, title: 'Note not found' },
  attachment_not_found: { status: 404, title: 'Attachment not found' },
  screen_not_found: { status: 404, title: 'Screen not found' },
  check_not_found: { status: 404, title: 'Render check not found' },
  invalid_image: { status: 400, title: 'Invalid image' },
  image_too_large: { status: 413, title: 'Image too large' },
  images_disabled: { status: 409, title: 'Images disabled' },
  reference_missing: { status: 409, title: 'Reference image missing' },
  check_not_requested: { status: 409, title: 'Render check not requested' },
  blob_store_full: { status: 507, title: 'Image store full' },
  route_not_found: { status: 404, title: 'Route not found' },
  rate_limited: { status: 429, title: 'Too many requests' },
  internal_error: { status: 500, title: 'Internal server error' },
  sessions_disabled: { status: 503, title: 'Sessions disabled' },
});

const typeUri = code => `${ERRORS_DOC}#${code.replace(/_/g, '-')}`;

class Problem extends Error {
  /** `extra` members (e.g. `validParameters`) are added to the body as-is. */
  constructor(code, detail, { hint = null, ...extra } = {}) {
    const def = CODES[code];
    if (!def) throw new Error(`Unknown problem code: ${code}`);
    super(detail || def.title);
    this.code = code;
    this.statusCode = def.status;
    this.hint = hint;
    this.extra = extra;
  }

  toJSON() {
    const def = CODES[this.code];
    const body = { type: typeUri(this.code), title: def.title, status: def.status, code: this.code, detail: this.message };
    if (this.hint) body.hint = this.hint;
    return { ...body, ...this.extra };
  }
}

const problem = (code, detail, options) => new Problem(code, detail, options);

function sendProblem(reply, err) {
  return reply.code(err.statusCode).type(CONTENT_TYPE).send(err.toJSON());
}

module.exports = { CODES, CONTENT_TYPE, ERRORS_DOC, Problem, problem, sendProblem, typeUri };
