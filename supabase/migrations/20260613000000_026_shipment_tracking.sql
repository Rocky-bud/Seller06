-- Migration 026: Shipment / courier tracking for orders (Phase 5 · Step 1)
-- Additive only. Lets a merchant move an order through packed -> shipped ->
-- delivered and (optionally) attach a postal tracking code, with timestamps.
-- Customers are notified automatically by the app layer; no courier API needed.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shipment_status      text,
  ADD COLUMN IF NOT EXISTS postal_tracking_code text,
  ADD COLUMN IF NOT EXISTS shipped_at           timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at         timestamptz;

-- Guard valid values when set (NULL = not shipped yet).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_shipment_status_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_shipment_status_check
      CHECK (shipment_status IS NULL OR shipment_status IN ('packed','shipped','delivered'));
  END IF;
END $$;

-- Fast lookup of shipments per shop (e.g. "shipped but not yet delivered").
CREATE INDEX IF NOT EXISTS orders_shipment_status_idx
  ON public.orders (shop_id, shipment_status);
