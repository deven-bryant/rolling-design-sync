-- figma-design-sync: node-sync v2.3 stale-main refresh (additive).
-- Source of truth: docs/node-sync-design.md ("Stale-main refresh (v2.3)").
--
-- Capture-version stamp on `public.node`. The API stamps its CAPTURE_VERSION
-- constant on every upsert; rows written before this migration keep the
-- default `1` (pre-instance-support) and are reported as stale by
-- `/v2/nodes/exists` so the plugin re-scans them once. Existing columns and
-- the v1 tables stay untouched.

alter table public.node
  add column if not exists capture_version smallint not null default 1;
