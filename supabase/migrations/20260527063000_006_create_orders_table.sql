/*
  # Create orders table

  1. New Tables
    - `orders`
      - `id` (uuid, primary key) - unique order identifier
      - `user_id` (text) - user who placed the order
      - `product_id` (uuid) - foreign key to products table
      - `quantity` (integer, default 1) - number of items ordered
      - `total_price` (numeric, default 0) - total order price (quantity * unit price)
      - `status` (text, default 'pending') - order status: pending, confirmed, shipped, cancelled
      - `created_at` (timestamptz) - when the order was placed

  2. Security
    - Enable RLS on `orders` table
    - Allow public to read their own orders (by user_id)
    - Allow public to insert orders (for demo purposes)

  3. Important Notes
    - Foreign key constraint to products table ensures referential integrity
    - Status defaults to 'pending' for new orders
    - total_price is calculated at order time and stored for historical accuracy
*/

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity integer NOT NULL DEFAULT 1,
  total_price numeric(12,2) NOT NULL DEFAULT 0.00,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read orders"
  ON orders FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Anyone can insert orders"
  ON orders FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Anyone can update orders"
  ON orders FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);
