-- 021: Row-Level Security (RLS) — Phase 1 · Step 3
--
-- Defence in depth: even if the API layer is bypassed, the database itself
-- refuses cross-shop reads/writes. Access is decided by membership in
-- shop_members (migration 020).
--
-- !!! RUN ORDER MATTERS !!!
-- The server/bot must use the SERVICE ROLE key (which BYPASSES RLS) BEFORE you
-- run this migration, otherwise the anon-key server gets locked out:
--   1. Deploy the out24 code (it now prefers SUPABASE_SERVICE_ROLE_KEY).
--   2. Set SUPABASE_SERVICE_ROLE_KEY in the server env and restart.
--   3. Confirm the bot still works.
--   4. THEN run this migration.
--
-- Roles: owner > staff > viewer. The `authenticated` role (admin panel users
-- hitting Supabase REST directly) is gated by these policies. `service_role`
-- bypasses RLS automatically. `anon` is left with NO policies => no access.

-- ─── Helper functions ─────────────────────────────────────────────────
-- SECURITY DEFINER so it can read shop_members regardless of RLS (prevents
-- recursive policy evaluation on shop_members itself).
create or replace function public.current_member_role(p_shop_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role
  from public.shop_members m
  where m.shop_id = p_shop_id
    and (
      (m.user_id is not null and m.user_id = auth.uid())
      or (m.email is not null and lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
    )
  order by case m.role
             when 'owner' then 3
             when 'staff' then 2
             when 'viewer' then 1
             else 0
           end desc
  limit 1
$$;

create or replace function public.has_shop_access(p_shop_id text, p_min text)
returns boolean
language sql
stable
as $$
  select coalesce(
    (case public.current_member_role(p_shop_id)
       when 'owner' then 3 when 'staff' then 2 when 'viewer' then 1 else 0 end)
    >=
    (case p_min
       when 'owner' then 3 when 'staff' then 2 when 'viewer' then 1 else 0 end),
    false
  )
$$;

-- ─── Enable RLS ───────────────────────────────────────────────────
alter table public.shops         enable row level security;
alter table public.products      enable row level security;
alter table public.orders        enable row level security;
alter table public.chats         enable row level security;
alter table public.carts         enable row level security;
alter table public.shop_members  enable row level security;

-- ─── shops ──────────────────────────────────────────────────────
drop policy if exists shops_select on public.shops;
create policy shops_select on public.shops
  for select to authenticated
  using (public.has_shop_access(id, 'viewer'));

drop policy if exists shops_update on public.shops;
create policy shops_update on public.shops
  for update to authenticated
  using (public.has_shop_access(id, 'owner'))
  with check (public.has_shop_access(id, 'owner'));

-- ─── products ────────────────────────────────────────────────
drop policy if exists products_select on public.products;
create policy products_select on public.products
  for select to authenticated
  using (public.has_shop_access(shop_id, 'viewer'));

drop policy if exists products_insert on public.products;
create policy products_insert on public.products
  for insert to authenticated
  with check (public.has_shop_access(shop_id, 'staff'));

drop policy if exists products_update on public.products;
create policy products_update on public.products
  for update to authenticated
  using (public.has_shop_access(shop_id, 'staff'))
  with check (public.has_shop_access(shop_id, 'staff'));

drop policy if exists products_delete on public.products;
create policy products_delete on public.products
  for delete to authenticated
  using (public.has_shop_access(shop_id, 'owner'));

-- ─── orders ───────────────────────────────────────────────────
-- Orders are created by the bot via the service role (bypasses RLS), so no
-- authenticated INSERT policy. Admins may view (viewer) and change status (staff).
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders
  for select to authenticated
  using (public.has_shop_access(shop_id, 'viewer'));

drop policy if exists orders_update on public.orders;
create policy orders_update on public.orders
  for update to authenticated
  using (public.has_shop_access(shop_id, 'staff'))
  with check (public.has_shop_access(shop_id, 'staff'));

-- ─── chats ─────────────────────────────────────────────────────
-- Bot writes via service role. Admins read for analytics/history.
drop policy if exists chats_select on public.chats;
create policy chats_select on public.chats
  for select to authenticated
  using (public.has_shop_access(shop_id, 'viewer'));

-- ─── carts ─────────────────────────────────────────────────────
drop policy if exists carts_select on public.carts;
create policy carts_select on public.carts
  for select to authenticated
  using (public.has_shop_access(shop_id, 'viewer'));

-- ─── shop_members ─────────────────────────────────────────────
-- Members can see the roster; only owners can modify it.
drop policy if exists shop_members_select on public.shop_members;
create policy shop_members_select on public.shop_members
  for select to authenticated
  using (public.has_shop_access(shop_id, 'viewer'));

drop policy if exists shop_members_manage on public.shop_members;
create policy shop_members_manage on public.shop_members
  for all to authenticated
  using (public.has_shop_access(shop_id, 'owner'))
  with check (public.has_shop_access(shop_id, 'owner'));
