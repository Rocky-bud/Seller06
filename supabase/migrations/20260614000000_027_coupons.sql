-- Migration 027: discount coupons
-- PHASE 6 · STEP 1 (Coupon engine + admin management)
--
-- One additive table: coupons. Merchants create simple discount codes
-- (percentage or fixed amount) from the admin panel. The bot will apply them
-- at checkout in a later step. Rows are written SERVER-SIDE with the
-- service-role key, so there are NO client write policies; shop members may
-- READ their own shop's coupons via the has_shop_access() helper (migration
-- 021 must be run first).

create table if not exists public.coupons (
  id             uuid primary key default gen_random_uuid(),
  shop_id        text not null,
  code           text not null,
  discount_type  text not null default 'percent',
  discount_value numeric(12,2) not null default 0,
  min_cart_total numeric(12,2) not null default 0,
  max_uses       integer,
  used_count     integer not null default 0,
  starts_at      timestamptz,
  expires_at     timestamptz,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);

-- Discount type must be one of the supported kinds.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'coupons_discount_type_check'
  ) then
    alter table public.coupons
      add constraint coupons_discount_type_check
      check (discount_type in ('percent', 'fixed'));
  end if;
end $$;

-- One active code per shop, case-insensitive (FREE10 == free10).
create unique index if not exists coupons_shop_code_unique
  on public.coupons (shop_id, lower(code));

create index if not exists coupons_shop_active_idx
  on public.coupons (shop_id, is_active);

-- Row Level Security: members read their own shop's coupons; writes are
-- server-side only (service-role key bypasses RLS).
alter table public.coupons enable row level security;
drop policy if exists coupons_select on public.coupons;
create policy coupons_select on public.coupons
  for select to authenticated
  using (shop_id is not null and public.has_shop_access(shop_id, 'viewer'));
