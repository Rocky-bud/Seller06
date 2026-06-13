-- Migration 012: Add system_prompt to shops
-- Allows each shop owner to customize the AI assistant's tone and instructions.

ALTER TABLE shops ADD COLUMN IF NOT EXISTS system_prompt TEXT;

-- Grant anon UPDATE on system_prompt (backend uses anon key, filters by shop id via WHERE clause)
-- If a broader UPDATE grant already exists on shops this is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'shops' AND policyname = 'anon_update_shops'
  ) THEN
    CREATE POLICY anon_update_shops ON shops
      FOR UPDATE TO anon
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
