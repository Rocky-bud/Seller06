/*
  # State Machine Support for Multi-Tenant Order Flow

  1. New Tables
    - `shops`
      - `id` (text, primary key) - the shop code like 'shop-default-123'
      - `name` (text) - shop display name
      - `card_number` (text) - bank card number for payments
      - `created_at` (timestamp)

  2. Modified Tables
    - `orders` - added fields for customer data collection:
      - `customer_name` (text, nullable) - customer full name
      - `shipping_address` (text, nullable) - shipping address with postal code
      - `phone` (text, nullable) - customer mobile number (09xxxxxxxxx)

  3. Security
    - Enable RLS on `shops` table
    - Allow anon read for shops (public info needed for checkout)
    
  4. Important Notes
    - This enables the state machine flow: IDLE -> GETTING_NAME -> GETTING_ADDRESS -> GETTING_PHONE -> AWAITING_RECEIPT
    - Each state transition updates the order with customer data
*/

-- Create shops table
CREATE TABLE IF NOT EXISTS shops (
  id text PRIMARY KEY,
  name text NOT NULL DEFAULT 'فروشگاه من',
  card_number text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

-- Add customer data fields to orders table
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'customer_name') THEN
    ALTER TABLE orders ADD COLUMN customer_name text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'shipping_address') THEN
    ALTER TABLE orders ADD COLUMN shipping_address text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'phone') THEN
    ALTER TABLE orders ADD COLUMN phone text;
  END IF;
END $$;

-- Enable RLS on shops
ALTER TABLE shops ENABLE ROW LEVEL SECURITY;

-- Allow anon to read shops (needed for checkout to get card_number)
CREATE POLICY "Shops are publicly readable"
  ON shops FOR SELECT
  TO anon
  USING (true);

-- Insert default shop if not exists
INSERT INTO shops (id, name, card_number)
VALUES ('shop-default-123', 'فروشگاه پیش‌فرض', '6037-9975-1234-5678')
ON CONFLICT (id) DO NOTHING;
