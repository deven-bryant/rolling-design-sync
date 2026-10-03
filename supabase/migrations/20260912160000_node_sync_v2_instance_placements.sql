-- figma-design-sync: node-sync v2.2 instance placements (additive).
-- Source of truth: docs/node-sync-design.md ("Instance placements (v2.2)").
--
-- Instances are stored as lightweight placement rows in `public.node`,
-- referencing their main component. `main_component_id` is a soft reference
-- (no FK): the main may be upserted later in the same sync and is resolved by
-- presence. Existing columns and the v1 tables stay untouched.

alter table public.node
  add column if not exists is_instance boolean not null default false;

alter table public.node
  add column if not exists main_component_id text;

create index if not exists node_file_key_main_component_id_idx
  on public.node (file_key, main_component_id);
