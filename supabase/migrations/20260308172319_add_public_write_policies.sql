/*
  # Add Public Write Policies for Demo Access

  ## Purpose
  Allow unauthenticated (anonymous) users to create, update, and delete records
  for demo purposes. This enables full CRUD functionality without authentication.

  ## Changes
  
  Add INSERT, UPDATE, and DELETE policies for anonymous users on all tables:
  - fields
  - crops
  - varieties
  - seed_reproductions
  - seasons
  - crop_structure
  - operations
  - warehouses
  - products
  - inventory_transactions

  ## Security Notes
  
  - Policies allow full CRUD for anonymous users
  - Suitable for demo/development environments only
  - For production, implement proper authentication and restrict by user_id
  - Anonymous users can only modify records with the demo user_id
*/

-- Fields: Allow anonymous write access for demo user
CREATE POLICY "Allow anonymous users to insert fields"
  ON fields
  FOR INSERT
  TO anon
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001');

CREATE POLICY "Allow anonymous users to update fields"
  ON fields
  FOR UPDATE
  TO anon
  USING (user_id = '00000000-0000-0000-0000-000000000001')
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001');

CREATE POLICY "Allow anonymous users to delete fields"
  ON fields
  FOR DELETE
  TO anon
  USING (user_id = '00000000-0000-0000-0000-000000000001');

-- Crops: Allow anonymous write access for demo user
CREATE POLICY "Allow anonymous users to insert crops"
  ON crops
  FOR INSERT
  TO anon
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001');

CREATE POLICY "Allow anonymous users to update crops"
  ON crops
  FOR UPDATE
  TO anon
  USING (user_id = '00000000-0000-0000-0000-000000000001')
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001');

CREATE POLICY "Allow anonymous users to delete crops"
  ON crops
  FOR DELETE
  TO anon
  USING (user_id = '00000000-0000-0000-0000-000000000001');

-- Varieties: Allow anonymous write access for demo user
CREATE POLICY "Allow anonymous users to insert varieties"
  ON varieties
  FOR INSERT
  TO anon
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001');

CREATE POLICY "Allow anonymous users to update varieties"
  ON varieties
  FOR UPDATE
  TO anon
  USING (user_id = '00000000-0000-0000-0000-000000000001')
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001');

CREATE POLICY "Allow anonymous users to delete varieties"
  ON varieties
  FOR DELETE
  TO anon
  USING (user_id = '00000000-0000-0000-0000-000000000001');

-- Seed Reproductions: Allow anonymous write access for demo user
CREATE POLICY "Allow anonymous users to insert seed reproductions"
  ON seed_reproductions
  FOR INSERT
  TO anon
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001');

CREATE POLICY "Allow anonymous users to update seed reproductions"
  ON seed_reproductions
  FOR UPDATE
  TO anon
  USING (user_id = '00000000-0000-0000-0000-000000000001')
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001');

CREATE POLICY "Allow anonymous users to delete seed reproductions"
  ON seed_reproductions
  FOR DELETE
  TO anon
  USING (user_id = '00000000-0000-0000-0000-000000000001');

-- Seasons: Allow anonymous write access for demo user
CREATE POLICY "Allow anonymous users to insert seasons"
  ON seasons
  FOR INSERT
  TO anon
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001');

CREATE POLICY "Allow anonymous users to update seasons"
  ON seasons
  FOR UPDATE
  TO anon
  USING (user_id = '00000000-0000-0000-0000-000000000001')
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001');

CREATE POLICY "Allow anonymous users to delete seasons"
  ON seasons
  FOR DELETE
  TO anon
  USING (user_id = '00000000-0000-0000-0000-000000000001');

-- Crop Structure: Allow anonymous write access for demo user
CREATE POLICY "Allow anonymous users to insert crop structures"
  ON crop_structure
  FOR INSERT
  TO anon
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001');

CREATE POLICY "Allow anonymous users to update crop structures"
  ON crop_structure
  FOR UPDATE
  TO anon
  USING (user_id = '00000000-0000-0000-0000-000000000001')
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001');

CREATE POLICY "Allow anonymous users to delete crop structures"
  ON crop_structure
  FOR DELETE
  TO anon
  USING (user_id = '00000000-0000-0000-0000-000000000001');

-- Operations: Allow anonymous write access for demo user
CREATE POLICY "Allow anonymous users to insert operations"
  ON operations
  FOR INSERT
  TO anon
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001');

CREATE POLICY "Allow anonymous users to update operations"
  ON operations
  FOR UPDATE
  TO anon
  USING (user_id = '00000000-0000-0000-0000-000000000001')
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001');

CREATE POLICY "Allow anonymous users to delete operations"
  ON operations
  FOR DELETE
  TO anon
  USING (user_id = '00000000-0000-0000-0000-000000000001');

-- Warehouses: Allow anonymous write access for demo user
CREATE POLICY "Allow anonymous users to insert warehouses"
  ON warehouses
  FOR INSERT
  TO anon
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001');

CREATE POLICY "Allow anonymous users to update warehouses"
  ON warehouses
  FOR UPDATE
  TO anon
  USING (user_id = '00000000-0000-0000-0000-000000000001')
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001');

CREATE POLICY "Allow anonymous users to delete warehouses"
  ON warehouses
  FOR DELETE
  TO anon
  USING (user_id = '00000000-0000-0000-0000-000000000001');

-- Products: Allow anonymous write access for demo user
CREATE POLICY "Allow anonymous users to insert products"
  ON products
  FOR INSERT
  TO anon
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001');

CREATE POLICY "Allow anonymous users to update products"
  ON products
  FOR UPDATE
  TO anon
  USING (user_id = '00000000-0000-0000-0000-000000000001')
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001');

CREATE POLICY "Allow anonymous users to delete products"
  ON products
  FOR DELETE
  TO anon
  USING (user_id = '00000000-0000-0000-0000-000000000001');

-- Inventory Transactions: Allow anonymous write access for demo user
CREATE POLICY "Allow anonymous users to insert inventory transactions"
  ON inventory_transactions
  FOR INSERT
  TO anon
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001');

CREATE POLICY "Allow anonymous users to update inventory transactions"
  ON inventory_transactions
  FOR UPDATE
  TO anon
  USING (user_id = '00000000-0000-0000-0000-000000000001')
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001');

CREATE POLICY "Allow anonymous users to delete inventory transactions"
  ON inventory_transactions
  FOR DELETE
  TO anon
  USING (user_id = '00000000-0000-0000-0000-000000000001');
