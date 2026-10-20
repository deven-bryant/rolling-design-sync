-- rolling-design-sync: one check switch per scope, excluded targets (additive).
-- Source of truth: docs/api-v3-design.md ("Check targets").
--
-- `scope_setting.checks` replaces the scope kind: true (the default for scopes
-- without a row) makes the scope's top-level frames / components / instances,
-- the variants of its top-level component sets and every main component in it
-- check targets; false = no targets. Legacy kinds map `screens` / `components`
-- to true and `none` to false; `kind` stays readable but is no longer written.
-- `screen.excluded` keeps a target out of the ready / all lists (set with
-- update_check_target); re-detection never resets it. Idempotent; the local
-- (PGlite) store applies it at startup like every migration.

alter table public.scope_setting add column if not exists checks boolean;
update public.scope_setting set checks = (kind is distinct from 'none') where checks is null;
alter table public.scope_setting alter column checks set default true;
alter table public.scope_setting alter column checks set not null;
alter table public.scope_setting alter column kind drop not null;

alter table public.screen add column if not exists excluded boolean not null default false;
