-- figma-design-sync: API v3 phase-2 event log (additive).
-- Source of truth: docs/api-v3-phase2.md ("1. Events").
--
-- One row per coarse event (sync.completed, nodes.cleared, claim.*,
-- node.blocked / node.unblocked), inserted in the same transaction as the
-- change it describes (transactional outbox). `data` holds IDs, counts, labels
-- and commit refs only — never node attributes or other design content.

create table if not exists public.event (
  id          bigserial primary key,
  file_key    text not null,
  type        text not null,
  actor       text,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists event_file_key_id_idx
  on public.event (file_key, id);
