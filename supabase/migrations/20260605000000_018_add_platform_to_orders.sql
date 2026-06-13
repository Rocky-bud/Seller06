/*
  # Stage 32 -- add platform channel to orders

  Orders previously had no channel column, so financial analytics could not tell
  Telegram sales apart from Instagram sales. This adds a `platform` column and
  backfills existing rows from the chats table (matching on user_id + shop_id).

  Run this entire block in Supabase SQL Editor -> Run.
*/

ALTER TABLE orders ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'telegram';

CREATE INDEX IF NOT EXISTS idx_orders_platform ON orders(platform);

-- Backfill historical orders from the chats table (best-effort: pick the most
-- recent chat platform seen for the same user_id + shop_id).
UPDATE orders o
SET platform = c.platform
FROM (
  SELECT DISTINCT ON (user_id, shop_id) user_id, shop_id, platform
  FROM chats
  ORDER BY user_id, shop_id, created_at DESC
) c
WHERE o.user_id = c.user_id
  AND o.shop_id = c.shop_id
  AND c.platform IN ('telegram', 'instagram');
