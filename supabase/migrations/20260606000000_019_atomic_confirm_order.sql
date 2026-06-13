/*
  # Stage 35 -- atomic, idempotent order confirmation

  Previously routes/orders.js confirmed an order with a NON-atomic
  read-modify-write on products.stock:
     read stock -> compute max(0, stock - qty) -> write stock
  Two approvals running at the same time (two admins, a double-click, or a
  duplicate request) could therefore:
    - deduct stock twice for the same order (lost-update), or
    - oversell the last unit when two DIFFERENT orders were approved together,
      because both read the same "stock = 1" before either wrote.

  This function performs the whole confirmation inside ONE transaction with
  row locks, so stock can never go negative and a re-confirm is a no-op.

  Run this whole block in Supabase SQL Editor -> Run.
*/

CREATE OR REPLACE FUNCTION confirm_order(p_order_id uuid, p_shop_id text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_product_id uuid;
  v_quantity   integer;
  v_status     text;
  v_new_stock  integer;
BEGIN
  -- Lock the order row for this shop so concurrent confirms serialize.
  SELECT product_id, quantity, status
    INTO v_product_id, v_quantity, v_status
    FROM orders
   WHERE id = p_order_id AND shop_id = p_shop_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  -- Idempotent: a second confirm of the same order changes nothing.
  IF v_status = 'approved' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_approved');
  END IF;

  -- Atomic, guarded decrement: succeeds ONLY if enough stock remains. The
  -- WHERE clause is re-evaluated against the latest committed row after the
  -- row lock is acquired, so two racing confirms cannot both pass it.
  UPDATE products
     SET stock = stock - v_quantity
   WHERE id = v_product_id AND stock >= v_quantity
   RETURNING stock INTO v_new_stock;

  IF NOT FOUND THEN
    -- Not enough stock (the last unit was already sold to someone else).
    RETURN jsonb_build_object('ok', false, 'code', 'insufficient_stock');
  END IF;

  UPDATE orders SET status = 'approved' WHERE id = p_order_id;

  RETURN jsonb_build_object('ok', true, 'stock', v_new_stock);
END;
$$;

-- Allow the API roles to call the function via PostgREST (/rest/v1/rpc/confirm_order).
GRANT EXECUTE ON FUNCTION confirm_order(uuid, text) TO anon, authenticated, service_role;
