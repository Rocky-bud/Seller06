-- 020: Role-Based Access Control (RBAC) — shop_members
-- Phase 1 · Step 2
--
-- Maps authenticated admin users to a shop with a role:
--   owner  > staff > viewer
-- Run this in the SERVER Supabase project (the one holding shops/orders/products).
--
-- Backward compatibility: the Express RBAC middleware runs in "legacy mode"
-- (logs warnings but allows requests) until RBAC_ENFORCED=true. Populate this
-- table and set the env flag to fully enforce access control.

create table if not exists public.shop_members (
  id         uuid primary key default gen_random_uuid(),
  shop_id    text not null references public.shops(id) on delete cascade,
  user_id    uuid,
  email      text,
  role       text not null default 'viewer' check (role in ('owner', 'staff', 'viewer')),
  created_at timestamptz not null default now(),
  unique (shop_id, user_id),
  unique (shop_id, email)
);

create index if not exists idx_shop_members_shop  on public.shop_members (shop_id);
create index if not exists idx_shop_members_user  on public.shop_members (user_id);
create index if not exists idx_shop_members_email on public.shop_members (email);

-- Seed your first owner(s) manually, e.g.:
--   insert into public.shop_members (shop_id, email, role)
--   values ('SHOP-LKGU6U', 'you@example.com', 'owner')
--   on conflict (shop_id, email) do update set role = excluded.role;
--
-- Full Row-Level Security policies are added in Phase 1 · Step 3 (migration 021).
