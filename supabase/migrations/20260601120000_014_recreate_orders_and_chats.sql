/*
  # Recreate orders and chats with the correct schema

  The live tables were created with a different schema from the application code.
  Both tables are confirmed empty, so DROP + CREATE is safe.

  Changes:
  - orders: add uuid PK, user_id, product_id, quantity, total_price, status
  - chats:  rename col "role" → "response", use uuid PK

  Run this entire block in Supabase SQL Editor → Run.
*/

-- ── orders ──────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS chats CASCADE;   -- chats has FK to orders, must drop first
DROP TABLE IF EXISTS orders CASCADE;

CREATE TABLE orders (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          text         NOT NULL,
  product_id       uuid         NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity         integer      NOT NULL DEFAULT 1,
  total_price      numeric(12,2) NOT NULL DEFAULT 0.00,
  status           text         NOT NULL DEFAULT 'pending_receipt',
  shop_id          text         NOT NULL DEFAULT 'shop-default-123',
  customer_name    text,
  shipping_address text,
  phone            text,
  receipt_url      text,
  tracking_code    text         UNIQUE,
  created_at       timestamptz  DEFAULT now()
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read orders"   ON orders FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can insert orders" ON orders FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Anyone can update orders" ON orders FOR UPDATE TO public USING (true) WITH CHECK (true);

CREATE INDEX idx_orders_shop_id       ON orders(shop_id);
CREATE INDEX idx_orders_tracking_code ON orders(tracking_code);
CREATE INDEX idx_orders_user_id       ON orders(user_id);

-- ── chats ───────────────────────────────────────────────────────────────────
CREATE TABLE chats (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               text        NOT NULL,
  platform              text        NOT NULL DEFAULT 'telegram',
  message               text        NOT NULL DEFAULT '',
  response              text        NOT NULL DEFAULT '',
  shop_id               text        NOT NULL DEFAULT 'shop-default-123',
  intent                text        DEFAULT 'unknown',
  state                 text,
  reservation_expires_at timestamptz,
  pending_order_id      uuid        REFERENCES orders(id) ON DELETE SET NULL,
  created_at            timestamptz DEFAULT now()
);

ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read chats"   ON chats FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can insert chats" ON chats FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Anyone can update chats" ON chats FOR UPDATE TO public USING (true) WITH CHECK (true);

CREATE INDEX idx_chats_shop_id  ON chats(shop_id);
CREATE INDEX idx_chats_state    ON chats(state);
CREATE INDEX idx_chats_user_id  ON chats(user_id);
