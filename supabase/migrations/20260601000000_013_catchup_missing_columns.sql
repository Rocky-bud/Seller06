/*
  # Catch-up migration — ensure all columns required by the bot state machine exist

  This is a safe, idempotent migration using IF NOT EXISTS guards.
  Run this in your Supabase SQL editor if the bot is throwing
  "schema cache" errors for reservation_expires_at, state, pending_order_id,
  shop_id, customer_name, shipping_address, phone, receipt_url, or tracking_code.

  Tables affected: chats, orders
*/

-- ── chats table ────────────────────────────────────────────────────────────────
-- shop_id (migration 008 — multi-tenancy)
ALTER TABLE chats ADD COLUMN IF NOT EXISTS shop_id text NOT NULL DEFAULT 'shop-default-123';

-- intent (original migration 004 — sometimes missing from early setups)
ALTER TABLE chats ADD COLUMN IF NOT EXISTS intent text DEFAULT 'unknown';

-- state machine columns (migration 009)
ALTER TABLE chats ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS reservation_expires_at timestamptz;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS pending_order_id uuid REFERENCES orders(id) ON DELETE SET NULL;

-- ── orders table ───────────────────────────────────────────────────────────────
-- shop_id (migration 008 — multi-tenancy)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shop_id text NOT NULL DEFAULT 'shop-default-123';

-- receipt / tracking (migration 009)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS receipt_url text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_code text;

-- customer data collected during checkout flow (migration 010)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS phone text;

-- ── indexes ────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_chats_shop_id   ON chats(shop_id);
CREATE INDEX IF NOT EXISTS idx_chats_state     ON chats(state);
CREATE INDEX IF NOT EXISTS idx_orders_shop_id  ON orders(shop_id);
