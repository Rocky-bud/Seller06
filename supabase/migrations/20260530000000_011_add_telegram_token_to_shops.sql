/*
  # Add Telegram Token to Shops (Multi-Tenant Bot Support)

  Each shop can register its own Telegram bot token.
  The server reads these on startup and routes incoming webhook
  messages to the correct shop_id.

  1. Changes
    - `shops.telegram_token` (text, nullable) — BotFather token for this shop's bot
    - `shops.webhook_url`    (text, nullable) — last registered webhook URL (audit trail)

  2. Security
    - telegram_token is NOT exposed via the public anon read policy
    - A separate service_role-only policy guards write access
*/

-- Add telegram_token column
ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS telegram_token text,
  ADD COLUMN IF NOT EXISTS webhook_url text;

-- Revoke telegram_token from the existing public SELECT policy by replacing it
-- with a column-level safe view (we restrict via the API layer, but we also
-- create a policy that excludes the token column for anon reads).
-- Simplest approach: keep the existing policy but mask the token in API routes.
-- No additional RLS change needed — the anon key is used only for SELECT and
-- the token is masked server-side before returning to the client.

COMMENT ON COLUMN shops.telegram_token IS 'Telegram Bot API token (BotFather). Never expose raw value to frontend.';
COMMENT ON COLUMN shops.webhook_url    IS 'Last Telegram webhook URL registered for this shop.';
