-- rolling-design-sync: automatic check targets, scope kinds, families, node maps (additive).
-- Source of truth: docs/api-v3-design.md ("Check targets").
--
-- A `screen` row is now a check target: `level` screen | component, `source`
-- manual (set up with set_screen) | auto (detected from a scope's kind),
-- `family_key` (variants that differ only in mapped properties share a
-- route), `gallery` (the CLI's gallery resolution cache), `mask_node_ids`
-- (nodes masked through the node map) and `node_map_id` (the JSON node map
-- uploaded with the reference). Auto targets have no route of their own:
-- screens take their family's from `target_family`, components render
-- through the file's gallery settings. `scope_setting` holds each synced
-- scope's kind. `render_check.attribution` lists the nodes a mismatch was
-- attributed to. Idempotent; the local (PGlite) store applies it at startup
-- like every migration.

alter table public.screen add column if not exists level text not null default 'screen';
alter table public.screen drop constraint if exists screen_level_check;
alter table public.screen add constraint screen_level_check check (level in ('screen', 'component'));

alter table public.screen add column if not exists source text not null default 'manual';
alter table public.screen drop constraint if exists screen_source_check;
alter table public.screen add constraint screen_source_check check (source in ('manual', 'auto'));

alter table public.screen add column if not exists family_key text;
alter table public.screen add column if not exists gallery jsonb;
alter table public.screen add column if not exists mask_node_ids jsonb not null default '[]'::jsonb;
alter table public.screen add column if not exists node_map_id uuid;
alter table public.screen alter column route drop not null;

alter table public.attachment drop constraint if exists attachment_kind_check;
alter table public.attachment
  add constraint attachment_kind_check check (kind in ('screenshot', 'reference', 'built', 'heatmap', 'node_map'));

alter table public.render_check add column if not exists attribution jsonb not null default '[]'::jsonb;

create table if not exists public.scope_setting (
  file_key   text not null,
  node_id    text not null,
  kind       text not null constraint scope_setting_kind_check check (kind in ('screens', 'components', 'none')),
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (file_key, node_id)
);

create table if not exists public.target_family (
  file_key   text not null,
  family_key text not null,
  route      text not null,
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (file_key, family_key)
);
