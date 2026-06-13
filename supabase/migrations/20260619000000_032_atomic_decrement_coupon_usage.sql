/*
  # Migration 032 -- atomic, clamped coupon-usage decrement (release on reject)

  PHASE: bug-fix pass (subsystem: orders/payments)

  Companion to migration 031 (increment_coupon_usage). When a merchant REJECTS
  an order that had a coupon applied, the use that order consumed must be
  returned to the coupon; otherwise a rejected order permanently burns a use and
  a coupon reaches max_uses early, blocking legitimate customers.

  This function performs a single guarded UPDATE that lowers used_count by one,
  clamped at 0 (GREATEST) so a double-call or an out-of-order reject can never
  drive the counter negative. Postgres evaluates the UPDATE under a row lock, so
  concurrent rejects are lost-update safe. Mirrors the increment_coupon_usage
  pattern from migration 031.

  Run this whole block in the Supabase SQL Editor -> Run. Depends on migration
  027 (coupons table).
*/

CREATE OR REPLACE FUNCTION decrement_coupon_usage(p_coupon_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_used integer;
BEGIN
  -- Atomic, clamped decrement: never drops below zero.
  UPDATE coupons
     SET used_count = GREATEST(used_count - 1, 0)
   WHERE id = p_coupon_id
   RETURNING used_count INTO v_used;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  RETURN jsonb_build_object('ok', true, 'used_count', v_used);
END;
$$;

-- Allow the API roles to call it via PostgREST (/rest/v1/rpc/decrement_coupon_usage).
GRANT EXECUTE ON FUNCTION decrement_coupon_usage(uuid) TO anon, authenticated, service_role;
