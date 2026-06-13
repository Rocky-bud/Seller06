-- 016_add_is_active_to_shops.sql
-- Adds an is_active flag so the platform super-admin can enable/disable shops.
alter table if exists public.shops
  add column if not exists is_active boolean not null default true;

comment on column public.shops.is_active is 'Whether the shop is active on the platform. Inactive shops are disabled by the super-admin.';
