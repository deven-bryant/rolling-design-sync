-- rolling-design-sync: library components (additive).
-- Source of truth: docs/api-v3-design.md ("Library components").
--
-- `node.library` flags library nodes: a remote (library) main component or
-- component set and everything inside it. `file.settings` holds per-file
-- settings (`trackLibraryComponents`, default true when absent).
-- `library_component` caches what a library component key resolves to through
-- Figma's REST API (RDS_FIGMA_TOKEN): its library file and node id.
-- The backfill marks the rows stored before the flag existed. Idempotent; the
-- local (PGlite) store applies it at startup like every migration.

alter table public.node add column if not exists library boolean not null default false;

alter table public.file add column if not exists settings jsonb not null default '{}'::jsonb;

create table if not exists public.library_component (
  component_key text primary key,
  file_key      text,
  node_id       text,
  name          text,
  resolved_at   timestamptz,
  error         text
);

-- Library roots: COMPONENT / COMPONENT_SET rows whose own component reference
-- is remote, and the mains (and sets) that instance rows with a remote
-- reference point at. Every row in a root's subtree is a library node. Not a
-- content update: `updated_at` is kept.
alter table public.node disable trigger node_set_updated_at;

with roots as (
  select r.file_key, r.path from public.node r
   where r.node_type in ('COMPONENT', 'COMPONENT_SET')
     and r.attrs #>> '{componentReference,remote}' = 'true'
  union
  select m.file_key, m.path from public.node i
    join public.node m on m.file_key = i.file_key
      and (m.node_id = i.main_component_id or m.node_id = i.attrs #>> '{componentReference,set,id}')
   where i.main_component_id is not null
     and i.attrs #>> '{componentReference,remote}' = 'true'
)
update public.node n
   set library = true
  from roots
 where n.file_key = roots.file_key
   and n.path <@ roots.path
   and not n.library;

alter table public.node enable trigger node_set_updated_at;
