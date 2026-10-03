-- figma-design-sync: node-sync v2 per-node store (additive).
-- Source of truth: docs/node-sync-design.md ("Schema").
--
-- Adds `public.node` alongside the v1 per-scope tables (tracked_scope,
-- snapshot, changeset, checklist_item, verification), which stay untouched.
-- Safe to run on a fresh Postgres/Supabase project after the init migration.

create extension if not exists ltree;

-- ---------------------------------------------------------------------------
-- node: current state, ONE row per tracked Figma node (main components +
-- non-instance nodes). `path` is the materialized path of ancestor node ids
-- (ltree labels), enabling subtree reads via `path <@ :ancestor`.
-- `attrs` holds this node's OWN attributes only (children are separate rows).
-- ---------------------------------------------------------------------------
create table public.node (
  file_key            text not null,
  node_id             text not null,
  node_type           text,
  name                text,
  parent_id           text,
  path                ltree,
  attrs               jsonb not null default '{}'::jsonb,
  content_hash        text,
  implemented_hash    text,
  dirty               boolean not null default true,
  implemented_commit  text,
  implemented_at      timestamptz,
  claimed_by          text,
  claim_expires_at    timestamptz,
  deleted_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint node_pkey primary key (file_key, node_id)
);

create index node_path_gist_idx on public.node using gist (path);
create index node_file_key_dirty_idx on public.node (file_key) where dirty;
create index node_file_key_node_type_idx on public.node (file_key, node_type);

-- `updated_at` is trigger-managed (reuses public.set_updated_at from the init
-- migration); the API must not set it explicitly.
create trigger node_set_updated_at
  before update on public.node
  for each row execute function public.set_updated_at();
