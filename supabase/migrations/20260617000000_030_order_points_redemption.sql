-- Migration 030: loyalty-points redemption on orders
-- PHASE 6 / STEP 3b (Redemption at checkout + display)
--
-- Additive + idempotent. Records the loyalty points a customer spends on a
-- checkout, stored on the PRIMARY order row of the cart (the row whose id
-- equals the checkout's pendingOrderId), alongside the coupon columns from 028.
--
--   points_redeemed : how many points were spent on this checkout
--   points_value    : the Toman value of those points (points * redeem_value)
--
-- Final payable = total_price - discount_amount (coupon) - points_value.
-- Depends on 028 (order coupon columns) and 029 (loyalty engine).

alter table public.orders
  add column if not exists points_redeemed integer not null default 0;

alter table public.orders
  add column if not exists points_value numeric(12,2) not null default 0;

-- Neither value may be negative.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_points_redeemed_nonneg'
  ) then
    alter table public.orders
      add constraint orders_points_redeemed_nonneg check (points_redeemed >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'orders_points_value_nonneg'
  ) then
    alter table public.orders
      add constraint orders_points_value_nonneg check (points_value >= 0);
  end if;
end $$;
