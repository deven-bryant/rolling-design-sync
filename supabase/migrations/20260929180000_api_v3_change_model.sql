-- figma-design-sync: API v3 phase-1 change model (additive).
-- Source of truth: docs/api-v3-design.md ("What's stored", "Migration of
-- existing data", "Claims", "Supporting data").
--
-- Adds per-property change tracking, claim and block columns to `public.node`,
-- plus the `claim`, `sync_event` and `file` tables, and backfills existing
-- rows. Existing columns and the v1/v2 tables stay untouched.

-- ---------------------------------------------------------------------------
-- node: v3 change model, claim and block columns.
-- ---------------------------------------------------------------------------
alter table public.node
  add column if not exists implemented_attrs jsonb;

alter table public.node
  add column if not exists change_type text
    constraint node_change_type_check check (change_type in ('added', 'modified', 'deleted'));

alter table public.node
  add column if not exists changed_props text[] not null default '{}';

alter table public.node
  add column if not exists change_categories text[] not null default '{}';

alter table public.node
  add column if not exists claim_id uuid;

alter table public.node
  add column if not exists blocked_at timestamptz;

alter table public.node
  add column if not exists blocked_by text;

alter table public.node
  add column if not exists blocked_reason text;

-- ---------------------------------------------------------------------------
-- claim: a v3 lease over a set of nodes, renewed/released as a unit. Nodes
-- still carry `claimed_by` / `claim_expires_at` (the one lease mechanism
-- shared with v2); `node.claim_id` links them to this row.
-- ---------------------------------------------------------------------------
create table if not exists public.claim (
  claim_id    uuid primary key default gen_random_uuid(),
  file_key    text not null,
  worker      text not null,
  label       text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

alter table public.node
  add constraint node_claim_id_fkey
    foreign key (claim_id) references public.claim (claim_id) on delete set null;

-- ---------------------------------------------------------------------------
-- sync_event: one row per plugin sync (counts: uploaded, changed, new,
-- deleted, baselined).
-- ---------------------------------------------------------------------------
create table if not exists public.sync_event (
  id            uuid primary key default gen_random_uuid(),
  file_key      text not null,
  root_node_id  text,
  counts        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists sync_event_file_key_created_at_idx
  on public.sync_event (file_key, created_at desc);

-- ---------------------------------------------------------------------------
-- file: one row per Figma file seen by the service.
-- ---------------------------------------------------------------------------
create table if not exists public.file (
  file_key      text primary key,
  name          text,
  last_sync_at  timestamptz,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- node indexes for v3 filters.
-- ---------------------------------------------------------------------------
create index if not exists node_changed_props_gin_idx
  on public.node using gin (changed_props);
create index if not exists node_change_categories_gin_idx
  on public.node using gin (change_categories);
create index if not exists node_file_key_blocked_idx
  on public.node (file_key)
  where blocked_at is not null;
create index if not exists node_file_key_claim_id_idx
  on public.node (file_key, claim_id);

-- ---------------------------------------------------------------------------
-- Backfill. Dirty/clean follows the existing `dirty` flag (tombstoning sets
-- it; a clear resets it), so v2 and v3 agree on which nodes are outstanding.
-- `implemented_attrs` is only known where the current attrs are the
-- implemented ones; other dirty nodes keep it null ("changes unknown").
-- The updated_at trigger is suspended so the backfill does not look like a
-- content update.
-- ---------------------------------------------------------------------------
alter table public.node disable trigger node_set_updated_at;

update public.node
set implemented_attrs = case when content_hash = implemented_hash then attrs end,
    change_type = case
      when not dirty then null
      when deleted_at is not null then 'deleted'
      when implemented_hash is null then 'added'
      else 'modified'
    end;

alter table public.node enable trigger node_set_updated_at;

insert into public.file (file_key, created_at)
select file_key, min(created_at)
from public.node
group by file_key
on conflict (file_key) do nothing;
