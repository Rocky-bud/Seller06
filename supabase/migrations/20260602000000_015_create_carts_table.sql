/*
  # Stage 20 -- DB-backed shopping cart (Instagram)

  Telegram keeps its cart in memory; Instagram has no buttons, so the cart is
  persisted here. One row per cart line item. An active cart = all rows with
  status='active' for a (user_id, shop_id, platform).

  Run this whole block in Supabase SQL Editor -> Run.
*/

CREATE TABLE IF NOT EXISTS carts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text        NOT NULL,
  shop_id     text        NOT NULL DEFAULT 'shop-default-123',
  platform    text        NOT NULL DEFAULT 'instagram',
  product_id  uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity    integer     NOT NULL DEFAULT 1,
  status      text        NOT NULL DEFAULT 'active',
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE carts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read carts"   ON carts FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can insert carts" ON carts FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Anyone can update carts" ON carts FOR UPDATE TO public USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_carts_lookup     ON carts(user_id, shop_id, platform, status);
CREATE INDEX IF NOT EXISTS idx_carts_product_id ON carts(product_id);
