/*
  # Migration 031 -- atomic, capped coupon-usage increment

  PHASE: bug-fix pass (subsystem: orders/payments)

  Previously services/couponService.js bumped coupons.used_count with a
  NON-atomic read-modify-write:
     read used_count -> compute used_count + 1 -> write used_count
  Two checkouts committing at the same time would both read the same
  used_count and both write the SAME +1, so:
    - increments were LOST (lost-update), and
    - a coupon with max_uses could be redeemed PAST its limit, because the
      cap was only checked at validate time, never atomically at increment.

  This function performs a single guarded UPDATE: the row is incremented ONLY
  while it is still below max_uses (NULL = unlimited). Postgres evaluates the
  WHERE against the latest committed row under a row lock, so two racing
  checkouts can never both pass the cap. Mirrors the confirm_order pattern
  from migration 019.

  Run this whole block in the Supabase SQL Editor -> Run. Depends on migration
  027 (coupons table).
*/

CREATE OR REPLACE FUNCTION increment_coupon_usage(p_coupon_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_used integer;
BEGIN
  -- Atomic, capped increment: succeeds only while still under the limit.
  UPDATE coupons
     SET used_count = used_count + 1
   WHERE id = p_coupon_id
     AND (max_uses IS NULL OR used_count < max_uses)
   RETURNING used_count INTO v_used;

  IF NOT FOUND THEN
    -- Distinguish "already at capacity" from "no such coupon".
    IF EXISTS (SELECT 1 FROM coupons WHERE id = p_coupon_id) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'capacity_reached');
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  RETURN jsonb_build_object('ok', true, 'used_count', v_used);
END;
$$;

-- Allow the API roles to call it via PostgREST (/rest/v1/rpc/increment_coupon_usage).
GRANT EXECUTE ON FUNCTION increment_coupon_usage(uuid) TO anon, authenticated, service_role;
