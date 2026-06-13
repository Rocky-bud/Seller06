-- Migration 029: loyalty points foundation
-- PHASE 6 / STEP 3a (Loyalty foundation + earning)
--
-- Adds opt-in loyalty config to shops + two additive tables:
--   loyalty_accounts  : one running balance per (shop_id, user_id)
--   loyalty_ledger    : append-only audit trail of every points movement
-- Points are EARNED when a paid order is confirmed (accrual hook in
-- routes/orders.js). Redemption at checkout arrives in step 3b.
--
-- Rows are written SERVER-SIDE with the service-role key, so there are NO
-- client write policies; shop members may READ their own shop's loyalty data
-- via the has_shop_access() helper (migration 021 must be run first).

-- ── Per-shop loyalty configuration (additive, idempotent) ────────────────────
-- loyalty_enabled       : master switch for the shop
-- loyalty_earn_per_1000 : points granted per 1000 Toman actually paid
-- loyalty_redeem_value  : Toman value of 1 point when redeemed (used in 3b)
alter table public.shops add column if not exists loyalty_enabled       boolean       not null default true;
alter table public.shops add column if not exists loyalty_earn_per_1000  numeric(6,2)  not null default 1;
alter table public.shops add column if not exists loyalty_redeem_value   numeric(12,2) not null default 1000;

-- ── Running balance per customer per shop ────────────────────────────────────
create table if not exists public.loyalty_accounts (
  id             uuid primary key default gen_random_uuid(),
  shop_id        text    not null,
  user_id        text    not null,
  points_balance integer not null default 0,
  total_earned   integer not null default 0,
  total_redeemed integer not null default 0,
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

-- One balance row per customer per shop.
create unique index if not exists loyalty_accounts_shop_user_unique
  on public.loyalty_accounts (shop_id, user_id);

-- Balance can never go negative.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'loyalty_accounts_balance_nonneg'
  ) then
    alter table public.loyalty_accounts
      add constraint loyalty_accounts_balance_nonneg check (points_balance >= 0);
  end if;
end $$;

-- ── Append-only ledger of every points movement ──────────────────────────────
create table if not exists public.loyalty_ledger (
  id            uuid primary key default gen_random_uuid(),
  shop_id       text    not null,
  user_id       text    not null,
  order_id      uuid,
  delta         integer not null,
  reason        text    not null default 'earn',
  balance_after integer not null default 0,
  note          text,
  created_at    timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'loyalty_ledger_reason_check'
  ) then
    alter table public.loyalty_ledger
      add constraint loyalty_ledger_reason_check
      check (reason in ('earn', 'redeem', 'adjust'));
  end if;
end $$;

create index if not exists loyalty_ledger_shop_user_idx
  on public.loyalty_ledger (shop_id, user_id, created_at desc);

-- Guard against double-accrual: at most one EARN ledger row per order.
create unique index if not exists loyalty_ledger_earn_per_order_unique
  on public.loyalty_ledger (order_id)
  where reason = 'earn' and order_id is not null;

-- ── Row Level Security: members read their own shop; writes are server-side ──
alter table public.loyalty_accounts enable row level security;
drop policy if exists loyalty_accounts_select on public.loyalty_accounts;
create policy loyalty_accounts_select on public.loyalty_accounts
  for select to authenticated
  using (shop_id is not null and public.has_shop_access(shop_id, 'viewer'));

alter table public.loyalty_ledger enable row level security;
drop policy if exists loyalty_ledger_select on public.loyalty_ledger;
create policy loyalty_ledger_select on public.loyalty_ledger
  for select to authenticated
  using (shop_id is not null and public.has_shop_access(shop_id, 'viewer'));
