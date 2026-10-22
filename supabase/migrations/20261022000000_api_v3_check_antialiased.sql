-- rolling-design-sync: render checks report the pixels ignored as anti-aliasing (additive).
-- Source of truth: docs/api-v3-design.md ("Screens and render checks").
--
-- `render_check.antialiased` counts the differing pixels the comparison ignored
-- as anti-aliasing (not part of `score`); null for checks scored before it
-- existed and for error results. Idempotent; the local (PGlite) store applies it
-- at startup like every migration.

alter table public.render_check add column if not exists antialiased integer;
