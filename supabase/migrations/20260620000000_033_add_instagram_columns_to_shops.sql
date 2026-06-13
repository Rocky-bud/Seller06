-- Migration 033: Add Instagram integration columns to shops
--
-- WHY: The application code reads these columns, but no earlier migration ever
-- created them. This caused the runtime error:
--   "column shops.instagram_access_token does not exist" (Postgres 42703)
--
-- Referenced by:
--   routes/shops.js          (select + allowed update fields)
--   services/instagramService.js (resolve shop by page id, send messages)
--   services/abandonedCart.js (getEnabledShops select)
--
-- Safe to run multiple times (IF NOT EXISTS). Run in the SERVER Supabase
-- project (the one holding shops/orders/products).

alter table public.shops
  add column if not exists instagram_page_id text;

alter table public.shops
  add column if not exists instagram_access_token text;

alter table public.shops
  add column if not exists instagram_verify_token text;
