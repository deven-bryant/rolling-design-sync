# API v3 errors

Every `/v3` error is an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem
(`Content-Type: application/problem+json`) with two extra members: `code`, a stable
machine-readable identifier, and `hint`, what to do about it. `type` links to the
section for the code on this page.

```json
{
  "type": "https://github.com/deven-bryant/rolling-design-sync/blob/main/docs/errors.md#file-not-found",
  "title": "File not found",
  "status": 404,
  "code": "file_not_found",
  "detail": "No tracked file with key 'https://www.figma.com/design/AbC123/Shop'.",
  "hint": "That looks like a Figma URL. Use the file key 'AbC123', or pass ?url=<figma link> with '-' as the file key."
}
```

Branch on `code`, not on `title`, `detail` or `hint`; those are for people and may be
reworded. Some problems add members, e.g. `unknown_parameter` has `validParameters`.
v1 and v2 routes keep their `{ "error": "..." }` bodies.

| Code | Status | Title |
|---|---|---|
| [`bad_request`](#bad-request) | 400 | Bad request |
| [`invalid_parameter`](#invalid-parameter) | 400 | Invalid parameter |
| [`unknown_parameter`](#unknown-parameter) | 400 | Unknown parameter |
| [`invalid_body`](#invalid-body) | 400 | Invalid request body |
| [`invalid_cursor`](#invalid-cursor) | 400 | Invalid cursor |
| [`invalid_url`](#invalid-url) | 400 | Not a Figma link |
| [`url_mismatch`](#url-mismatch) | 400 | Link does not match the path |
| [`invalid_image`](#invalid-image) | 400 | Invalid image |
| [`unauthorized`](#unauthorized) | 401 | Missing bearer token |
| [`invalid_token`](#invalid-token) | 401 | Invalid bearer token |
| [`wrong_token_class`](#wrong-token-class) | 403 | Wrong token class |
| [`csrf_rejected`](#csrf-rejected) | 403 | Request rejected |
| [`forbidden`](#forbidden) | 403 | Forbidden |
| [`file_not_found`](#file-not-found) | 404 | File not found |
| [`node_not_found`](#node-not-found) | 404 | Node not found |
| [`claim_not_found`](#claim-not-found) | 404 | Claim not found |
| [`note_not_found`](#note-not-found) | 404 | Note not found |
| [`attachment_not_found`](#attachment-not-found) | 404 | Attachment not found |
| [`screen_not_found`](#screen-not-found) | 404 | Screen not found |
| [`check_not_found`](#check-not-found) | 404 | Render check not found |
| [`route_not_found`](#route-not-found) | 404 | Route not found |
| [`images_disabled`](#images-disabled) | 409 | Images disabled |
| [`reference_missing`](#reference-missing) | 409 | Reference image missing |
| [`check_not_requested`](#check-not-requested) | 409 | Render check not requested |
| [`image_too_large`](#image-too-large) | 413 | Image too large |
| [`rate_limited`](#rate-limited) | 429 | Too many requests |
| [`internal_error`](#internal-error) | 500 | Internal server error |
| [`sessions_disabled`](#sessions-disabled) | 503 | Sessions disabled |
| [`blob_store_full`](#blob-store-full) | 507 | Image store full |

<a id="bad-request"></a>
## `bad_request`

**400.** The request could not be processed as sent, for a reason no more specific code
covers.

- **Usual cause:** malformed JSON (`Body is not valid JSON…`), an unsupported
  `Content-Type`, or a body over the server's size limit (`RDS_BODY_LIMIT_BYTES`).
- **Fix:** send `Content-Type: application/json` with a valid JSON body, and check the
  route in [`/v3/openapi.json`](#openapi).

<a id="invalid-parameter"></a>
## `invalid_parameter`

**400.** A path or query parameter, or a body member, has a value the route's schema does
not accept. `detail` names it (`querystring/limit …`, `body/items/0 must have required
property 'contentHash'`).

- **Usual cause:** a value outside its enum (`state=dirtyy`, `changeType=changed`), a
  number out of range (`limit=0`, `limit=1000`), `depth` without `under`, more than 50 `under` ids, several `under` ids
  with `group=frame`, `claimed=mine`
  without `worker`, a `since` that is not a date, a `changed` pattern whose `*` is not
  trailing, an unparsable `q`, a key given both in `q` and as a parameter, the `-`
  placeholder without `?url=`, or a body that misses a required member or has the wrong
  type (an empty or oversized `items` list on bulk clear, a claim without `worker`).
- **Fix:** follow `hint`, which lists the accepted values or the missing companion
  parameter. The full parameter list per route is in `/v3/openapi.json`.

<a id="unknown-parameter"></a>
## `unknown_parameter`

**400.** The query string has a parameter the route does not define. v3 rejects these
rather than ignoring them, because a typo would otherwise silently widen a filter.

- **Usual cause:** a typo (`stat=dirty`), a v2 parameter name, or a parameter meant for
  another route.
- **Fix:** use the suggestion in `hint` (`Did you mean 'stat' → 'state'?`); the
  `validParameters` member lists every parameter the route takes.

<a id="invalid-body"></a>
## `invalid_body`

**400.** The JSON body passes the schema but asks for something the route does not do.
v3 rejects unknown members rather than ignoring them, because a typo would otherwise
silently widen a claim.

- **Usual cause:** an unknown member (e.g. `nodeIDs` for `nodeIds`), a blank `worker`,
  both `nodeIds` and `filter` in one claim, or `claimed`/`worker` inside a claim's
  `filter` (a claim implies them).
- **Fix:** follow `hint`; for unknown members, `validParameters` lists the accepted
  ones. The body schemas are in `/v3/openapi.json`.

<a id="invalid-cursor"></a>
## `invalid_cursor`

**400.** `cursor` is not one this API issued, or it belongs to a different query.

- **Usual cause:** a hand-built or truncated cursor, or changing a filter, `sort`,
  `fields`, `view`, `include` or `q` between pages.
- **Fix:** pass the previous page's `nextCursor` unchanged with exactly the same other
  parameters, or drop `cursor` to start from the first page.

<a id="invalid-url"></a>
## `invalid_url`

**400.** `?url=` is not a Figma design link.

- **Usual cause:** a link to another site, a shortened or copied-with-text link, or a
  URL that is not URL-encoded so the query string split it.
- **Fix:** pass a link like `https://www.figma.com/design/<fileKey>/<name>?node-id=1-2`,
  URL-encoded as a query value.

<a id="url-mismatch"></a>
## `url_mismatch`

**400.** `?url=` names a different file (or node) than the path.

- **Usual cause:** a file key in the path together with a link to another file, or a node
  id in the path that differs from the link's `node-id`.
- **Fix:** use `-` in the path when passing `?url=` (`/v3/files/-/nodes?url=…`,
  `/v3/files/-/nodes/-?url=…`), or drop `?url=`.

<a id="unauthorized"></a>
## `unauthorized`

**401.** No bearer token was sent.

- **Usual cause:** a missing `Authorization` header, or a proxy that strips it.
- **Fix:** send `Authorization: Bearer <agent token>`. Only `/v3/openapi.json` is public.

<a id="invalid-token"></a>
## `invalid_token`

**401.** A bearer token was sent but the server does not recognise it.

- **Usual cause:** a typo, a rotated token, or a token from another deployment.
- **Fix:** use a token listed in the server's `RDS_AGENT_TOKENS` (or the local tokens
  file, see `README.md`).

<a id="wrong-token-class"></a>
## `wrong_token_class`

**403.** The token is valid, but of the wrong class: a plugin token on a v3 route
other than the plugin routes, a viewer token on a v3 write, or an agent or viewer
token on a plugin route (`…/hashes`, `…/sync`, `…/exists`).

- **Usual cause:** reusing the Figma plugin's token in an agent or script, a
  read-only UI's viewer token in a script that writes, or an agent calling the
  plugin's upload routes.
- **Fix:** use an agent token (`RDS_AGENT_TOKENS`). Plugin tokens only call the v2
  upload routes and the v3 plugin routes; viewer tokens
  (`RDS_VIEWER_TOKENS`) only call v3 `GET` routes other than `…/hashes`. Agents
  read with `GET …/nodes` and clear with `POST …/clear`, never through the
  plugin routes.

<a id="csrf-rejected"></a>
## `csrf_rejected`

**403.** A cookie-authenticated write (POST or DELETE) did not pass the CSRF
checks. Only cookie (`rds_session`) requests need them; `SameSite=Strict` is
the first layer and these headers are the second.

- **Usual cause:** a browser request missing `X-RDS-Client: portal/…`, or an
  `Origin` that is not the API's own origin — i.e. a cross-site form or fetch
  that attached the cookie anyway.
- **Fix:** send `X-RDS-Client: portal/<version>` on writes and let the browser
  set `Origin`; if your UI is served by something other than this API, use a
  bearer token instead of the cookie.

<a id="forbidden"></a>
## `forbidden`

**403.** The token is valid for this route, but not for this note: only a note's author may
edit or delete it, and only its author or an agent may dismiss it.

- **Usual cause:** a viewer (or another agent) editing someone else's note.
- **Fix:** ask the author, add a new note instead, or — for an agent — fix the code and
  clear the node, which resolves its notes.

<a id="file-not-found"></a>
## `file_not_found`

**404.** No tracked file has this key. A file is tracked once the plugin has synced it.

- **Usual cause:** a Figma URL pasted as the file key, a typo, or a file that has not been
  synced yet.
- **Fix:** use the key from `GET /v3/files`. For a URL, `hint` gives the key it contains;
  or pass the link as `?url=` with `-` as the file key.

<a id="node-not-found"></a>
## `node_not_found`

**404.** The file is tracked, but it has no node with this id (in `{nodeId}` or `under`; with several `under` ids, `detail` names the first unknown one).

- **Usual cause:** a node outside every synced scope, a node from another file, or a
  mistyped id. Both `1:2` and `1-2` are accepted, so the separator is not the cause.
- **Fix:** check the id against the link's `node-id`, and that the node is under one of
  `GET /v3/files/{fileKey}/scopes`; if not, sync that scope from the plugin first.

<a id="claim-not-found"></a>
## `claim_not_found`

**404.** No claim with this id exists on this file.

- **Usual cause:** a mistyped or truncated `claimId`, a claim id from another file, or
  a claim id kept from another deployment or database.
- **Fix:** use the `claimId` returned by `POST /v3/files/{fileKey}/claims` on the same
  file, or take a new claim. A released or expired claim still renews or releases, but
  only the nodes still under it; renew before `expiresAt` to keep a lease.

<a id="note-not-found"></a>
## `note_not_found`

**404.** No note with this id exists on this file (or it was deleted).

- **Usual cause:** a mistyped `noteId`, one from another file, or a note its author deleted.
- **Fix:** use a `noteId` from `POST …/nodes/{nodeId}/notes` or
  `GET …/nodes/{nodeId}/notes?status=all` on the same file.

<a id="invalid-image"></a>
## `invalid_image`

**400.** An uploaded image (note screenshot, screen reference or render-check
result) is not a PNG, JPEG or WebP, does not decode, or is larger than 8192 px
on a side. The type is read from the bytes, never from a name; SVG, GIF and
HTML are refused.

- **Usual cause:** a data URL prefix (`data:image/png;base64,`) left in front of
  the base64, a truncated file, or an unsupported format.
- **Fix:** send the raw file bytes, base64-encoded, as PNG, JPEG or WebP.

<a id="attachment-not-found"></a>
## `attachment_not_found`

**404.** No image with this id is stored for this file (or its note, screen or
check was deleted).

- **Usual cause:** an attachment id from another file, or one whose note was
  deleted or whose render check was pruned (each target keeps its `checkRetention` newest results, default 5, plus its last pass).
- **Fix:** use the `url` / `thumbUrl` from a current note, screen or check.

<a id="screen-not-found"></a>
## `screen_not_found`

**404.** The node is not set up as a screen for render checks.

- **Usual cause:** `request_render_check` or a reference upload for a frame
  nobody configured, or one whose screen was deleted.
- **Fix:** `PUT /v3/files/{fileKey}/screens/{nodeId}` (`set_screen`) with its
  `route` first; `list_screens` shows the configured ones.

<a id="check-not-found"></a>
## `check_not_found`

**404.** No render check with this id exists on this file.

- **Usual cause:** a mistyped `checkId`, one from another file, or an old check
  pruned after newer ones (each target keeps its `checkRetention` newest results, default 5, plus its last pass).
- **Fix:** take ids from `list_render_checks` (`status=requested` for the ones
  waiting to run).

<a id="images-disabled"></a>
## `images_disabled`

**409.** The file's `storeImages` setting is `false`, so the API stores no
images for it: note screenshots, screen references and render-check results
are refused. Text-only notes still work.

- **Usual cause:** a team that opted out of keeping screenshots.
- **Fix:** send the note without `images`, or turn it back on with
  `PATCH /v3/files/{fileKey} {"settings": {"storeImages": true}}`.

<a id="reference-missing"></a>
## `reference_missing`

**409.** The screen has no reference image for its current design yet, so a
built screenshot has nothing to be compared with.

- **Usual cause:** a screen configured (or redesigned) since the plugin's last
  sync; the plugin uploads references for `references-needed` screens when it
  syncs.
- **Fix:** run a sync from the plugin, then submit the result again (the check
  stays `requested`).

<a id="check-not-requested"></a>
## `check_not_requested`

**409.** The check already has a result (`passed`, `mismatch` or `error`);
results are accepted once.

- **Usual cause:** two agents running the same check, or a retry after a
  successful submit.
- **Fix:** request a new check (`request_render_check`) and submit to that one.

<a id="image-too-large"></a>
## `image_too_large`

**413.** The decoded image is over `RDS_IMAGE_MAX_BYTES` (5 MB by default).

- **Usual cause:** a full-page or retina screenshot.
- **Fix:** crop it, or render at 1× (render checks compare 1× screenshots at the
  screen's viewport).

<a id="route-not-found"></a>
## `route_not_found`

**404.** No `/v3` route matches the method and path.

- **Usual cause:** a typo, a wrong method, or a Figma URL in the path (which adds extra
  `/` segments).
- **Fix:** see `/v3/openapi.json` for the routes. For a URL in the path, `hint` gives the
  file key; or use `/v3/files/-/…?url=<url-encoded link>`.

<a id="rate-limited"></a>
## `rate_limited`

**429.** The request is over one of the API's per-minute rate limits
(`docs/setup.md`, "Rate limits"). The response has `Retry-After` (seconds) and
`RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset`; the body adds
`retryAfter`, the same seconds. Unlike the other codes it is also sent for
routes outside `/v3` (except `/health`).

```json
{
  "type": "https://github.com/deven-bryant/rolling-design-sync/blob/main/docs/errors.md#rate-limited",
  "title": "Too many requests",
  "status": 429,
  "code": "rate_limited",
  "detail": "This token made more than 600 requests in a minute.",
  "hint": "Retry in 42 s (Retry-After). Limits are per minute; the server sets them with RDS_RATE_LIMIT_TOKEN, RDS_RATE_LIMIT_IP and RDS_RATE_LIMIT_AUTH.",
  "retryAfter": 42
}
```

- **Usual cause:** a tight polling loop or a burst of parallel calls on one token;
  more than 120 unauthenticated requests a minute from one address; or more than 10
  sign-ins / rejected (`401`) tokens a minute from one address, after which every
  request from it is refused until the window ends. Behind a proxy without
  `RDS_TRUST_PROXY`, all clients share the proxy's address.
- **Fix:** wait `Retry-After` seconds and retry; slow down or batch the calls. The
  operator can raise or disable (`0`) each limit with `RDS_RATE_LIMIT_TOKEN`,
  `RDS_RATE_LIMIT_IP` and `RDS_RATE_LIMIT_AUTH`, and set `RDS_TRUST_PROXY` behind a
  proxy.

<a id="internal-error"></a>
## `internal_error`

**500.** The server failed while handling a valid request.

- **Usual cause:** the database is unreachable or a bug.
- **Fix:** retry; if it persists, check the API logs, which have the stack trace for the
  request.

<a id="sessions-disabled"></a>
## `sessions_disabled`

**503.** The session routes (`/v3/session`) are off: the server runs on
`DATABASE_URL` and has no `RDS_SESSION_SECRET` to sign cookies with.

- **Usual cause:** a self-hosted deployment that never set the secret.
- **Fix:** set `RDS_SESSION_SECRET` to a random 32+-character value (see
  `docs/setup.md`). `RDS_STORE` modes generate one into `tokens.json`
  automatically.

<a id="blob-store-full"></a>
## `blob_store_full`

**507.** The image store reached its size limit (`RDS_BLOB_MAX_BYTES`, 1 GiB by
default, for the Postgres driver).

- **Usual cause:** many note screenshots on the default database driver.
- **Fix:** delete old notes with screenshots, raise `RDS_BLOB_MAX_BYTES`, or
  move images to a bucket with `RDS_BLOB_URL` (see `docs/setup.md`).

<a id="clear-statuses"></a>
## Clear result statuses

`POST /v3/files/{fileKey}/clear` (`clear_nodes`) is `200` for a valid body;
each item gets its own `status` (and `totals` counts them):

| Status | Meaning | Fix |
|---|---|---|
| `cleared` | Recorded as implemented. With `subtree: true`, `subtreeCleared` counts the deleted descendants cleared with it. | — |
| `stale` | The design changed since you read it; `contentHash` is the current hash. | Re-read the node, implement the change, clear with the new hash. |
| `not_found` | No such node in this file. | Check the id. |
| `not_removed` | `subtree: true` on a node that is not deleted; nothing was cleared. `contentHash` is the current hash. | Clear it without `subtree` (subtree clears are for `kind: "removed"` work items). |

<a id="openapi"></a>
## OpenAPI

`GET /v3/openapi.json` (no token needed) is the OpenAPI 3.1 description of every v3 route,
its parameters, bodies, responses and the problem shape.
