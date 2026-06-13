# Database migrations — run order

This platform uses **additive, numbered** SQL migrations. They live in
`supabase/migrations/` and must be applied **in ascending numeric order** in the
Supabase **SQL Editor** (the sandbox has no network access, so migrations are
never run automatically there).

> **Golden rule:** never edit an already-applied migration. Fix-forward with a
> new, higher-numbered file.

## Why some numbers are missing

Numbers `001`, `002`, and `005` were early bootstrap scripts that were folded
into later files; the live sequence starts at `003`. Gaps are intentional and
safe — only the ascending order matters.

## Run order

| # | File | Purpose |
|---|------|---------|
| 003 | `..._003_create_products_table.sql` | Products catalog table |
| 004 | `..._004_create_chats_table.sql` | Conversation / chat history |
| 006 | `..._006_create_orders_table.sql` | Orders table |
| 007 | `..._007_allow_anon_update_products.sql` | Early anon product update policy |
| 008 | `..._008_add_shop_id_multitenancy.sql` | Multi-tenant `shop_id` columns |
| 009 | `..._009_receipt_verification_workflow.sql` | Receipt review workflow fields |
| 010 | `..._010_state_machine_fields.sql` | Checkout state-machine columns |
| 011 | `..._011_add_telegram_token_to_shops.sql` | Per-shop Telegram bot token |
| 012 | `..._012_add_system_prompt_to_shops.sql` | Per-shop AI system prompt |
| 013 | `..._013_catchup_missing_columns.sql` | Backfill missing columns |
| 014 | `..._014_recreate_orders_and_chats.sql` | Rebuild orders + chats schema |
| 015 | `..._015_create_carts_table.sql` | Carts table |
| 016 | `..._016_add_is_active_to_shops.sql` | Shop active flag |
| 017 | `..._017_create_merchant_files_bucket.sql` | `merchant-files` storage bucket |
| 018 | `..._018_add_platform_to_orders.sql` | Order channel (telegram/instagram) |
| 019 | `..._019_atomic_confirm_order.sql` | `confirm_order` RPC (atomic stock) |
| 020 | `..._020_create_shop_members_rbac.sql` | RBAC `shop_members` + roles |
| 021 | `..._021_enable_rls_policies.sql` | Row Level Security + access helpers |
| 022 | `..._022_idempotency_keys.sql` | Webhook idempotency table |
| 023 | `..._023_audit_logs.sql` | Audit log for sensitive actions |
| 024 | `..._024_abandoned_cart_recovery.sql` | Abandoned-cart recovery fields |
| 025 | `..._025_broadcast_marketing.sql` | Broadcast / marketing + consent |
| 026 | `..._026_shipment_tracking.sql` | Shipment status + tracking code |
| 027 | `..._027_coupons.sql` | Coupons table (unique per shop+code) |
| 028 | `..._028_order_coupon.sql` | Order coupon code + discount amount |
| 029 | `..._029_loyalty_points.sql` | Loyalty config + accounts + ledger |
| 030 | `..._030_order_points_redemption.sql` | Order points redeemed + value |
| 031 | `..._031_atomic_increment_coupon_usage.sql` | `increment_coupon_usage` RPC (atomic, capped) |

## Critical dependencies

- **021 (RLS)** depends on the helper functions and `shop_members` from **020**,
  and its policies are relied on by every later table — run **020 → 021** before
  **022+**.
- **028** (order coupon columns) requires **027** (coupons table).
- **030** (order points redemption) requires **029** (loyalty tables/columns).
- **031** (`increment_coupon_usage` RPC) requires **027** (coupons table).

## After applying

1. Confirm `shops` has the loyalty columns (`loyalty_enabled`,
   `loyalty_earn_per_1000`, `loyalty_redeem_value`) from **029**.
2. Confirm `orders` has `coupon_code`, `discount_amount`, `points_redeemed`,
   `points_value`.
3. Run `npm run check` and `npm run build` locally (or let CI do it).
