-- Migration 024: Abandoned-cart recovery (PHASE 3 · STEP 1)
--
-- Gives each shop a single ON/OFF switch plus a log of recovery nudges. ALL
-- scheduling / TTL logic lives in the server (services/abandonedCart.js); the
-- merchant only ever sees the toggle, never a cron or timer.

-- 1) Per-shop settings. OFF by default until the merchant flips the switch.
alter table public.shops
  add column if not exists cart_recovery_enabled boolean not null default false;
alter table public.shops
  add column if not exists cart_recovery_delay_minutes integer not null default 60;

-- 2) One row per nudge sent; flipped to recovered=true once the same shopper
--    completes an approved order afterward (powers the "recovered revenue" stat).
create table if not exists public.cart_recovery_log (
  id                 uuid primary key default gen_random_uuid(),
  shop_id            text not null,
  user_id            text not null,
  platform           text not null default 'telegram',
  state_at_nudge     text,
  pending_order_id   uuid,
  nudged_at          timestamptz not null default now(),
  recovered          boolean not null default false,
  recovered_at       timestamptz,
  recovered_order_id uuid,
  recovered_amount   numeric(12,2)
);

create index if not exists cart_recovery_log_shop_idx
  on public.cart_recovery_log (shop_id, nudged_at desc);
create index if not exists cart_recovery_log_user_idx
  on public.cart_recovery_log (shop_id, user_id, nudged_at desc);
create index if not exists cart_recovery_log_recovered_idx
  on public.cart_recovery_log (shop_id, recovered);

-- 3) RLS: shop OWNERS may read their own recovery log. The server writes with
--    the service-role key (bypasses RLS), so NO write policies are defined.
alter table public.cart_recovery_log enable row level security;
drop policy if exists cart_recovery_log_select on public.cart_recovery_log;
create policy cart_recovery_log_select on public.cart_recovery_log
  for select to authenticated
  using (shop_id is not null and public.has_shop_access(shop_id, 'owner'));
