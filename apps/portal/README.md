# @rolling-design-sync/portal

The browser UI for local and self-hosted deployments, served by the API at
`/ui`. Design and scope: [docs/ui-portal.md](../../docs/ui-portal.md).

![The node tree](../../docs/images/portal-node-tree.png)

The screenshots in `docs/images/` are generated from a seeded demo:
`npm run screenshots` in `tests/e2e-portal`
([`screenshots.spec.js`](../../tests/e2e-portal/screenshots.spec.js)).

## Develop

```bash
npm install                 # once, at the repo root
npm run dev                 # in apps/portal: http://localhost:5173/ui/
```

The dev server proxies `/v3` and `/health` to the API at `RDS_PORTAL_API`
(default `http://localhost:8787`), so the portal and API share an origin and the
session cookie works as in production. Sign in at `/ui/sign-in` with a viewer
or agent token. The component gallery is at `/ui/gallery` (dev builds only).

| Script | Does |
|---|---|
| `npm run dev` | Vite dev server under `/ui/` |
| `npm run build` | Production build into `dist/` (the API serves it; the Docker image includes it) |
| `npm test` | Vitest + Testing Library + `jest-axe` in jsdom |
| `npm run typecheck` | `tsc` (strict) |
| `npm run lint` | ESLint, including the layer rule |
| `npm run gen:api` | Regenerates `src/api/schema.d.ts` from the API's OpenAPI document (built in-process; no server needed). `gen:api:check` fails when it is out of date — run it after changing API routes or schemas, and commit the output. |

## Build and serve

```bash
npm ci                                            # at the repo root
npm run build -w @rolling-design-sync/portal      # → apps/portal/dist
npm start -w @rolling-design-sync/api             # serves it at /ui
```

The API serves `RDS_PORTAL_DIR` (default `apps/portal/dist`) at `/ui` with an
SPA fallback and long-cached hashed assets; without a build, `/ui` answers a
page that says how to build it. The Docker image builds the portal in its own
stage, so `docker compose up -d` serves it at `http://localhost:8787/ui`.

## Gallery

`/ui/gallery` lists every `*.gallery.tsx` in `src/` (collected with
`import.meta.glob`, so a new file shows up without registering it), each example
labelled with the Figma name it implements. It exists in dev builds only; use it
to check a component against the design file before it is used in a page.

`/ui/gallery?figma=<set>&variant=<variant>` renders one example alone inside a
`data-rds-target` wrapper, for render checks; see `docs/ui-portal.md`
"Gallery URLs" for matching, set names and theme.

## Layout

`src/styles` (tokens) → `src/components/primitives` → `src/components/<Name>`
→ `src/components/domain` → `src/features` → `src/routes`. Imports only go
down; `src/api` is used by features and routes only, and the presentational
layers can't use the query cache. `eslint/layers.js` enforces it.

- **Tokens** — `src/styles/tokens.css`, from the MIT Untitled UI React theme
  (see `NOTICE`), exposed through Tailwind's `@theme`: `bg-primary`,
  `text-tertiary`, `border-secondary`, `p-xl`, `gap-md`, `rounded-md`, … Light
  mode only. Inter comes from `@fontsource-variable/inter`.
- **Primitives** — `cx()`, `variants()`, `Icon`, `Text`, `Stack`, `Inline`,
  `Surface`, `VisuallyHidden`. Each has a test and a `*.gallery.tsx` entry.
- **API** — `src/api/client.ts` (fetch wrapper: same-origin cookies,
  `X-RDS-Client: portal/<version>`, problem JSON → `ApiError`, 401 → sign-in and
  back), `session.ts`, `query.tsx` (TanStack Query), `useEventStream.ts` (one
  shared `EventSource` per URL, handlers by event type, `reset` refetches,
  `live` / `reconnecting` state).

## Icons

`Icon` draws the design file's icons by their Figma names (`Icon/figma.ts`)
from **`lucide-react`** (ISC). `@untitledui/icons` is preferred when it is
MIT-licensed; its `package.json` says MIT, but the `LICENSE` file it ships is
the Untitled UI license, which forbids redistributing the icons — incompatible
with an Apache-2.0 repo and a published image — so the fallback applies. Each
Figma name maps to the closest Lucide glyph on the same 24px grid with a 2px
round stroke; `bar-chart-square-02` uses `SquareKanban` flipped vertically so
its bars rise from the bottom, and `placeholder` is a plain circle.

## Adding a component

1. **Pick the layer.** A generic UI piece goes in `src/components/<Name>/`; one
   that only makes sense for this product (a node, an agent, a diff) in
   `src/components/domain/<Name>/`. Either one gets data and callbacks as props
   and never imports `src/api` or TanStack Query — that is a feature's job
   (`src/features/<area>/`). `npm run lint` fails on an import that goes up a
   layer.
2. **Build it from the design.** Read the Figma component (the portal design
   file `PORTAL_DESIGN_FILE` from `src/figma-file.ts`, Portal components page)
   and use the token classes
   (`bg-primary`, `p-xl`, `gap-md`, …) and existing primitives and components —
   no raw colours or pixel values. Interactive parts use React Aria Components.
3. **Map it.** `figma.ts` exports the Figma component's node id, key and name,
   how its properties map to props, and the defaults its gallery uses (see
   `domain/NodeCell/figma.ts`).
4. **Add the files** next to it:
   - `<Name>.tsx` — the component, with JSDoc on the props;
   - `index.ts` — re-exports the component, its props type and the `figma*` map;
   - `<Name>.test.tsx` — behaviour and `jest-axe`;
   - `<Name>.gallery.tsx` — a default-exported `GalleryEntry` with one example
     per Figma variant.
5. **Check** `npm test`, `npm run typecheck` and `npm run lint` here, and the
   gallery entry against the design.

## End-to-end tests

`tests/e2e-portal` drives the built portal in Chromium with Playwright against a
running API (sign in as viewer and agent, browse a file's node tree, block and
release, live claim and clear). See [tests/README.md](../../tests/README.md).

