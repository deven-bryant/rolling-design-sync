-- figma-design-sync: initial change-sync schema.
-- Source of truth: docs/architecture.md ("Data model").
--
-- Apply with `supabase db push` (Supabase CLI) or paste into the Supabase
-- SQL editor. Safe to run on a fresh Postgres/Supabase project.

create extension if not exists "pgcrypto";

-- Keeps `updated_at` current on row updates.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- tracked_scope: one Figma Section/Frame we sync. Snapshot FKs are added
-- after `snapshot` exists (circular reference).
-- ---------------------------------------------------------------------------
create table public.tracked_scope (
  id                              uuid primary key default gen_random_uuid(),
  file_key                        text not null,
  frame_id                        text not null,
  scope_name                      text not null default '',
  latest_snapshot_id              uuid,
  verified_baseline_snapshot_id   uuid,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  constraint tracked_scope_file_key_frame_id_key unique (file_key, frame_id)
);

create trigger tracked_scope_set_updated_at
  before update on public.tracked_scope
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- snapshot: full normalized node map for one scan of a scope.
-- ---------------------------------------------------------------------------
create table public.snapshot (
  id              uuid primary key default gen_random_uuid(),
  scope_id        uuid not null references public.tracked_scope (id) on delete cascade,
  captured_at     timestamptz not null,
  schema_version  integer not null,
  coverage        text not null default '',
  warnings        jsonb not null default '[]'::jsonb,
  nodes           jsonb not null default '{}'::jsonb,
  published       boolean not null default false,
  created_at      timestamptz not null default now()
);

create index snapshot_scope_id_idx on public.snapshot (scope_id);
create index snapshot_scope_id_published_captured_at_idx
  on public.snapshot (scope_id, captured_at desc)
  where published;

alter table public.tracked_scope
  add constraint tracked_scope_latest_snapshot_id_fkey
    foreign key (latest_snapshot_id) references public.snapshot (id) on delete set null,
  add constraint tracked_scope_verified_baseline_snapshot_id_fkey
    foreign key (verified_baseline_snapshot_id) references public.snapshot (id) on delete set null;

-- ---------------------------------------------------------------------------
-- changeset: which scan produced the current outstanding set; verification
-- binds to it.
-- ---------------------------------------------------------------------------
create table public.changeset (
  id                uuid primary key default gen_random_uuid(),
  scope_id          uuid not null references public.tracked_scope (id) on delete cascade,
  from_snapshot_id  uuid references public.snapshot (id) on delete set null,
  to_snapshot_id    uuid not null references public.snapshot (id) on delete cascade,
  captured_at       timestamptz not null default now(),
  state             text not null default 'open',
  constraint changeset_state_check check (state in ('open', 'superseded'))
);

create index changeset_scope_id_idx on public.changeset (scope_id);
create index changeset_scope_id_state_idx on public.changeset (scope_id, state);

-- ---------------------------------------------------------------------------
-- checklist_item: compact, agent-facing work items reconciled from the diff.
-- ---------------------------------------------------------------------------
create table public.checklist_item (
  id                uuid primary key default gen_random_uuid(),
  scope_id          uuid not null references public.tracked_scope (id) on delete cascade,
  changeset_id      uuid not null references public.changeset (id) on delete cascade,
  node_id           text not null,
  frame_id          text not null,
  change_type       text not null,
  changes           jsonb not null default '{}'::jsonb,
  context_snapshot  jsonb,
  figma_url         text,
  reconcile_key     text not null,
  status            text not null default 'pending',
  claimed_by        text,
  claim_expires_at  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint checklist_item_change_type_check
    check (change_type in ('added', 'modified', 'moved', 'deleted')),
  constraint checklist_item_status_check
    check (status in ('pending', 'claimed', 'implemented', 'verified', 'obsolete', 'blocked'))
);

create index checklist_item_scope_id_idx on public.checklist_item (scope_id);
create index checklist_item_changeset_id_idx on public.checklist_item (changeset_id);
create index checklist_item_status_idx on public.checklist_item (status);
create index checklist_item_scope_id_status_idx on public.checklist_item (scope_id, status);
create index checklist_item_scope_id_reconcile_key_idx
  on public.checklist_item (scope_id, reconcile_key);
create index checklist_item_claim_expires_at_idx
  on public.checklist_item (claim_expires_at)
  where status = 'claimed';

create trigger checklist_item_set_updated_at
  before update on public.checklist_item
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- verification: append-only record of a worker verifying/blocking an item.
-- ---------------------------------------------------------------------------
create table public.verification (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references public.checklist_item (id) on delete cascade,
  changeset_id  uuid not null references public.changeset (id) on delete cascade,
  status        text not null,
  code_paths    jsonb not null default '[]'::jsonb,
  commit_ref    text,
  evidence      text not null default '',
  blockers      text,
  agent         text not null,
  created_at    timestamptz not null default now(),
  constraint verification_status_check check (status in ('verified', 'blocked')),
  constraint verification_evidence_required_check
    check (status <> 'verified' or length(btrim(evidence)) > 0)
);

create index verification_item_id_idx on public.verification (item_id);
create index verification_changeset_id_idx on public.verification (changeset_id);
create index verification_status_idx on public.verification (status);
