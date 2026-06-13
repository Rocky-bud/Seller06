-- 034: Access codes for shop members
-- Adds a login ACCESS CODE to each shop member so the super-admin / owner can
-- hand out a single short code instead of provisioning Supabase users by hand.
--
-- Each code is backed by a real Supabase auth user whose email + password are
-- DERIVED from the code (see services/accessCodes.js). We store the code and the
-- derived auth email here so the panel can display / copy / revoke it later.

alter table public.shop_members add column if not exists access_code text;
alter table public.shop_members add column if not exists auth_email  text;
alter table public.shop_members add column if not exists label       text;

-- Codes must be globally unique (they map 1:1 to a derived login email).
create unique index if not exists idx_shop_members_access_code
  on public.shop_members (access_code)
  where access_code is not null;
