-- Migration 028: per-order coupon application (Phase 6 / Step 2)
-- Adds the columns needed to apply a coupon discount at checkout.
-- Additive + idempotent: safe to re-run. Depends on 014/018/026 (orders table)
-- and 027 (coupons table). No RLS changes; inherits the orders table policies.

-- The coupon code applied to this checkout (stored on the primary order row of
-- the cart, i.e. the row whose id equals the pendingOrderId of the checkout).
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS coupon_code text;

-- The absolute discount amount (in Toman) granted by the coupon for this
-- checkout. Cart-level value; lives on the primary order row. Never negative.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS discount_amount numeric(12,2) NOT NULL DEFAULT 0;

-- Guard against accidental negative discounts written by buggy callers.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_discount_amount_nonneg'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_discount_amount_nonneg CHECK (discount_amount >= 0);
  END IF;
END$$;

-- Helpful when reporting coupon performance later (loyalty/analytics steps).
CREATE INDEX IF NOT EXISTS idx_orders_coupon_code
  ON public.orders (shop_id, coupon_code)
  WHERE coupon_code IS NOT NULL;
