-- rolling-design-sync: never-built deletions resolve themselves (data only).
-- Source of truth: docs/api-v3-design.md ("The change model", "Removed design").
--
-- A node tombstoned while it was never implemented (`implemented_hash` null)
-- is not work: syncs now store it as a clean tombstone. This resolves the
-- dirty never-built tombstones stored before that rule. Idempotent; the local
-- (PGlite) store applies it at startup like every migration.

update public.node
   set dirty = false,
       change_type = null,
       changed_props = '{}',
       change_categories = '{}'
 where deleted_at is not null
   and implemented_hash is null
   and dirty;
