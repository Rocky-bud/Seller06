-- Migration 025: broadcast & marketing tools
-- PHASE 4 · STEP 1 (Broadcast core)
--
-- Two additive tables:
--   1) broadcasts        — one row per campaign, with delivery stats.
--   2) marketing_opt_out — consent ledger; one row per opted-out customer.
--
-- Both are written SERVER-SIDE with the service-role key (which bypasses RLS),
-- so NO client write policies exist. Shop members may READ their own shop's
-- rows via the has_shop_access() helper from migration 021 (run 021 first).

-- 1) Campaign records + delivery stats ---------------------------------------
create table if not exists public.broadcasts (
  id               uuid primary key default gen_random_uuid(),
  shop_id          text not null,
  message          text not null,
  image_url        text,
  button_label     text,
  button_url       text,
  audience         text not null default 'all',
  platform         text not null default 'telegram',
  status           text not null default 'sent',
  total_recipients integer not null default 0,
  sent_count       integer not null default 0,
  failed_count     integer not null default 0,
  skipped_count    integer not null default 0,
  sent_by          text,
  created_at       timestamptz not null default now()
);

create index if not exists broadcasts_shop_created_idx
  on public.broadcasts (shop_id, created_at desc);

-- 2) Marketing opt-out (consent ledger) --------------------------------------
create table if not exists public.marketing_opt_out (
  shop_id      text not null,
  user_id      text not null,
  platform     text not null default 'telegram',
  opted_out_at timestamptz not null default now(),
  primary key (shop_id, user_id)
);

create index if not exists marketing_opt_out_shop_idx
  on public.marketing_opt_out (shop_id);

-- ─── Row Level Security ──────────────────────────────────────────────
alter table public.broadcasts enable row level security;
drop policy if exists broadcasts_select on public.broadcasts;
create policy broadcasts_select on public.broadcasts
  for select to authenticated
  using (shop_id is not null and public.has_shop_access(shop_id, 'viewer'));

alter table public.marketing_opt_out enable row level security;
drop policy if exists marketing_opt_out_select on public.marketing_opt_out;
create policy marketing_opt_out_select on public.marketing_opt_out
  for select to authenticated
  using (shop_id is not null and public.has_shop_access(shop_id, 'viewer'));
