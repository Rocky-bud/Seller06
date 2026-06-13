-- Migration 023: audit_logs — durable trail of sensitive admin actions
-- PHASE 2 · STEP 4 (Audit Log)
--
-- Records WHO did WHAT, to WHICH target, for WHICH shop, with a correlation
-- request_id. Rows are written server-side with the service-role key (which
-- bypasses RLS). Shop OWNERS may READ their own shop's trail through the
-- has_shop_access() helper introduced in migration 021.

create table if not exists public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_id    text,
  actor_email text,
  action      text not null,
  target_type text,
  target_id   text,
  shop_id     text,
  metadata    jsonb,
  request_id  text,
  created_at  timestamptz not null default now()
);

-- Fast lookups: per-shop timeline, by action, and global recent activity.
create index if not exists audit_logs_shop_created_idx
  on public.audit_logs (shop_id, created_at desc);
create index if not exists audit_logs_action_idx
  on public.audit_logs (action);
create index if not exists audit_logs_created_idx
  on public.audit_logs (created_at desc);

-- ─── Row Level Security ──────────────────────────────────────────────
alter table public.audit_logs enable row level security;

-- Read-only access for shop OWNERS. The server writes with the service-role
-- key, which bypasses RLS, so NO insert/update/delete policies are defined
-- (clients can never forge, alter, or erase audit entries).
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (shop_id is not null and public.has_shop_access(shop_id, 'owner'));
