-- rolling-design-sync: image blobs, attachments, screens and render checks (additive).
-- Source of truth: docs/api-v3-design.md ("Screens and render checks", "Note screenshots").
--
-- `blob` holds image bytes when no S3-compatible bucket is configured.
-- `attachment` is one stored image (note screenshot, screen reference, check
-- built/heatmap image) with its thumbnail. `screen` is a frame configured for
-- render checks; `render_check` is one requested or finished comparison.
-- `node_note.source` tells user notes from the system's render-check notes.
-- Idempotent; the local (PGlite) store applies it at startup like every
-- migration.

create table if not exists public.blob (
  key          text primary key,
  content_type text not null,
  size         integer not null,
  bytes        bytea not null,
  created_at   timestamptz not null default now()
);

create table if not exists public.attachment (
  attachment_id uuid primary key default gen_random_uuid(),
  file_key      text not null,
  owner_kind    text not null constraint attachment_owner_kind_check check (owner_kind in ('note', 'screen', 'check')),
  owner_id      text not null,
  kind          text not null constraint attachment_kind_check check (kind in ('screenshot', 'reference', 'built', 'heatmap')),
  content_type  text not null,
  size          integer not null,
  width         integer not null,
  height        integer not null,
  sha256        text not null,
  blob_key      text not null,
  thumb_key     text,
  created_by    text not null,
  created_at    timestamptz not null default now()
);

create index if not exists attachment_owner_idx on public.attachment (file_key, owner_kind, owner_id);

create table if not exists public.screen (
  file_key          text not null,
  node_id           text not null,
  route             text not null,
  viewport_width    integer not null,
  viewport_height   integer not null,
  theme             text,
  query             text,
  masks             jsonb not null default '[]'::jsonb,
  threshold         double precision not null default 1,
  reference_id      uuid,
  reference_version text,
  created_by        text not null,
  updated_by        text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (file_key, node_id)
);

create table if not exists public.render_check (
  check_id       uuid primary key default gen_random_uuid(),
  file_key       text not null,
  node_id        text not null,
  status         text not null constraint render_check_status_check check (status in ('requested', 'passed', 'mismatch', 'error')),
  design_version text not null,
  requested_by   text not null,
  requested_at   timestamptz not null default now(),
  submitted_by   text,
  submitted_at   timestamptz,
  commit_ref     text,
  source         text,
  score          double precision,
  threshold      double precision,
  regions        jsonb not null default '[]'::jsonb,
  built_id       uuid,
  heatmap_id     uuid,
  reference_id   uuid,
  error          text
);

create index if not exists render_check_screen_idx on public.render_check (file_key, node_id, requested_at desc);

create index if not exists render_check_status_idx on public.render_check (file_key, status, requested_at desc);

alter table public.node_note add column if not exists source text not null default 'user';

alter table public.node_note drop constraint if exists node_note_source_check;

alter table public.node_note
  add constraint node_note_source_check check (source in ('user', 'render_check'));
