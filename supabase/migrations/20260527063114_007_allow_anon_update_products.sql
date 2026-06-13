/*
  # Allow anon to update products stock

  1. Security Changes
    - Add UPDATE policy on `products` table for `anon` role
    - This allows the AI service (using anon key) to decrease stock when orders are placed

  2. Important Notes
    - In production, this should be restricted to service role only
    - For demo purposes, anon can update product stock
*/

CREATE POLICY "Allow anon to update products"
  ON products FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);
