/*
  # Add shop_id for multi-tenant architecture

  1. New Columns
    - `products.shop_id` (text, default 'shop-default-123') - identifies which shop a product belongs to
    - `orders.shop_id` (text, default 'shop-default-123') - identifies which shop an order belongs to
    - `chats.shop_id` (text, default 'shop-default-123') - identifies which shop a conversation belongs to

  2. Backfill
    - All existing rows in products, orders, and chats get shop_id = 'shop-default-123'
    - This ensures existing queries continue to work without modification until shop_id filtering is added

  3. Indexes
    - Add index on shop_id for each table to optimize filtered queries

  4. Important Notes
    - shop_id defaults to 'shop-default-123' so new inserts without a shop_id still work
    - Existing application logic will continue to function unchanged
    - Frontend/admin can later filter data by shop_id for multi-tenant separation
*/

-- Add shop_id column to products
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'shop_id'
  ) THEN
    ALTER TABLE products ADD COLUMN shop_id text NOT NULL DEFAULT 'shop-default-123';
  END IF;
END $$;

-- Add shop_id column to orders
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'shop_id'
  ) THEN
    ALTER TABLE orders ADD COLUMN shop_id text NOT NULL DEFAULT 'shop-default-123';
  END IF;
END $$;

-- Add shop_id column to chats
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'chats' AND column_name = 'shop_id'
  ) THEN
    ALTER TABLE chats ADD COLUMN shop_id text NOT NULL DEFAULT 'shop-default-123';
  END IF;
END $$;

-- Backfill existing rows (in case any were inserted before the column was added with the default)
UPDATE products SET shop_id = 'shop-default-123' WHERE shop_id IS NULL;
UPDATE orders SET shop_id = 'shop-default-123' WHERE shop_id IS NULL;
UPDATE chats SET shop_id = 'shop-default-123' WHERE shop_id IS NULL;

-- Add indexes for shop_id lookups
CREATE INDEX IF NOT EXISTS idx_products_shop_id ON products(shop_id);
CREATE INDEX IF NOT EXISTS idx_orders_shop_id ON orders(shop_id);
CREATE INDEX IF NOT EXISTS idx_chats_shop_id ON chats(shop_id);
