-- 035: products.stock
--
-- ROOT CAUSE FIX. The `stock` column was referenced everywhere:
--   * routes/products.js POST/PATCH (insert/update stock)
--   * the orders embedding  orders?select=*,products(name,price,stock)
--   * the atomic_confirm_order() RPC (migration 019)
-- ...but it was never actually created on the products table. Because of this:
--   * Creating a product returned a Supabase error (Bug 1).
--   * The dashboard's order fetch (which embeds products(...,stock)) failed
--     with a PostgREST error, surfacing as "خطا در بارگذاری اطلاعات" (Bug 6).
--
-- Adding the column (idempotent) repairs both at the schema level.

alter table public.products
  add column if not exists stock integer not null default 0;

-- Keep stock non-negative at the DB level (defensive; the API already clamps).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'products_stock_nonneg'
  ) then
    alter table public.products
      add constraint products_stock_nonneg check (stock >= 0);
  end if;
end $$;
