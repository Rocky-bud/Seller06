/*
  # Receipt Verification Workflow for Iranian Market

  1. New Columns on `orders`
    - `receipt_url` (text, nullable) - stores uploaded bank receipt image link
    - `tracking_code` (text, nullable, unique) - bank transfer tracking number

  2. Updated Columns on `orders`
    - `status` default changed from 'pending' to 'pending_receipt'
    - Valid statuses: pending_receipt, awaiting_approval, approved, rejected
    - Existing rows with 'pending' status updated to 'pending_receipt'

  3. New Columns on `chats`
    - `state` (text, nullable) - conversation state machine, e.g. 'AWAITING_RECEIPT'
    - `reservation_expires_at` (timestamptz, nullable) - deadline for receipt upload
    - `pending_order_id` (uuid, nullable) - links chat state to the order awaiting receipt

  4. Security
    - No RLS changes; existing policies cover the new columns

  5. Important Notes
    - When an order is placed, status = 'pending_receipt' and the chat enters AWAITING_RECEIPT state
    - Reservation expires after 1 hour (enforced at application level)
    - When receipt is uploaded, order moves to 'awaiting_approval' and chat state clears
*/

-- Add receipt_url to orders
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'receipt_url'
  ) THEN
    ALTER TABLE orders ADD COLUMN receipt_url text;
  END IF;
END $$;

-- Add tracking_code to orders (unique for bank transfer tracking)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'tracking_code'
  ) THEN
    ALTER TABLE orders ADD COLUMN tracking_code text UNIQUE;
  END IF;
END $$;

-- Update existing 'pending' orders to 'pending_receipt'
UPDATE orders SET status = 'pending_receipt' WHERE status = 'pending';

-- Change default status for new orders
ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'pending_receipt';

-- Add state column to chats for conversation state machine
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'chats' AND column_name = 'state'
  ) THEN
    ALTER TABLE chats ADD COLUMN state text;
  END IF;
END $$;

-- Add reservation_expires_at to chats
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'chats' AND column_name = 'reservation_expires_at'
  ) THEN
    ALTER TABLE chats ADD COLUMN reservation_expires_at timestamptz;
  END IF;
END $$;

-- Add pending_order_id to chats (links AWAITING_RECEIPT state to the order)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'chats' AND column_name = 'pending_order_id'
  ) THEN
    ALTER TABLE chats ADD COLUMN pending_order_id uuid REFERENCES orders(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add index on tracking_code for lookups
CREATE INDEX IF NOT EXISTS idx_orders_tracking_code ON orders(tracking_code);

-- Add index on chats state for filtering
CREATE INDEX IF NOT EXISTS idx_chats_state ON chats(state);
