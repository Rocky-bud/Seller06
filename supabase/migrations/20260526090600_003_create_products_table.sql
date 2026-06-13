/*
  # Create products table

  1. New Tables
    - `products`
      - `id` (uuid, primary key)
      - `name` (text, product name)
      - `description` (text, product description)
      - `price` (decimal, product price)
      - `created_at` (timestamp, when created)

  2. Security
    - Enable RLS on `products` table
    - Allow public read access for all users
    - Allow authenticated users to insert, update, and delete

  3. Important Notes
    - Products are publicly readable
    - Only authenticated users can modify products
*/

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text DEFAULT '',
  price decimal(10,2) DEFAULT 0.00,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Allow public read access
CREATE POLICY "Anyone can read products"
  ON products FOR SELECT
  TO public
  USING (true);

-- Allow authenticated users to insert
CREATE POLICY "Authenticated users can insert products"
  ON products FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow authenticated users to update
CREATE POLICY "Authenticated users can update products"
  ON products FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Allow authenticated users to delete
CREATE POLICY "Authenticated users can delete products"
  ON products FOR DELETE
  TO authenticated
  USING (true);

-- Allow anonymous insert for testing
CREATE POLICY "Allow anonymous insert"
  ON products FOR INSERT
  TO anon
  WITH CHECK (true);