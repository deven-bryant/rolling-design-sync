-- rolling-design-sync: node notes (additive).
-- Source of truth: docs/api-v3-design.md ("Node notes").
--
-- A note says a built node does not match the design. An open note keeps its
-- node dirty (change type `requested` when the design is otherwise built);
-- clearing the node resolves its open notes, and a note can be dismissed.
-- Idempotent; the local (PGlite) store applies it at startup like every
-- migration.

create table if not exists public.node_note (
  note_id     uuid primary key default gen_random_uuid(),
  file_key    text not null,
  node_id     text not null,
  body        text not null constraint node_note_body_check check (char_length(body) between 1 and 4000),
  author      text not null,
  worker      text,
  status      text not null default 'open' constraint node_note_status_check check (status in ('open', 'resolved', 'dismissed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  commit_ref  text
);

create index if not exists node_note_open_idx on public.node_note (file_key, node_id) where status = 'open';

create index if not exists node_note_node_idx on public.node_note (file_key, node_id, created_at desc);

-- `requested`: dirty only because of open notes.
alter table public.node drop constraint if exists node_change_type_check;

alter table public.node
  add constraint node_change_type_check check (change_type in ('added', 'modified', 'deleted', 'requested'));
