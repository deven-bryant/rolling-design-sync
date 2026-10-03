-- rolling-design-sync: API v3 document order (additive).
-- Source of truth: docs/api-v3-agent-ergonomics.md ("9. Document order").
--
-- `order_key` is the node's position in the design's document order: its
-- parent's key + '.' + its rank among its siblings, zero-padded to 5 digits
-- ('00000' for nodes whose parent isn't stored). The API maintains it on every
-- sync and backfills null keys at startup (maintenance step `document-order`).

alter table public.node
  add column if not exists order_key text;

create index if not exists node_file_key_order_key_idx
  on public.node (file_key, order_key collate "C");

-- Re-ranking reads a parent's children by `parent_id`.
create index if not exists node_file_key_parent_id_idx
  on public.node (file_key, parent_id);

-- Re-keying siblings is not a content update: an update that changes only
-- `order_key` keeps `updated_at` (so `since` and `sort=updatedAt` don't see it).
drop trigger if exists node_set_updated_at on public.node;
create trigger node_set_updated_at
  before update on public.node
  for each row
  when (old.order_key is not distinct from new.order_key
        or (to_jsonb(old) - 'order_key') is distinct from (to_jsonb(new) - 'order_key'))
  execute function public.set_updated_at();
