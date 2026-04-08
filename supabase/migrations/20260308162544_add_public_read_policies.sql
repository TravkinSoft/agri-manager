/*
  # Add Public Read Policies for Demo Access

  ## Purpose
  Allow unauthenticated (anonymous) users to read all data for demo purposes.
  This enables the application to display demo data without requiring authentication.

  ## Changes
  
  Add SELECT policies for anonymous users on all tables:
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
  
  - Policies only allow SELECT (read) operations for anonymous users
  - INSERT, UPDATE, DELETE still require authentication
  - Suitable for demo/development environments
  - For production, implement proper authentication
*/

-- Fields: Allow anonymous read access
CREATE POLICY "Allow anonymous users to view all fields"
  ON fields
  FOR SELECT
  TO anon
  USING (true);

-- Crops: Allow anonymous read access
CREATE POLICY "Allow anonymous users to view all crops"
  ON crops
  FOR SELECT
  TO anon
  USING (true);

-- Varieties: Allow anonymous read access
CREATE POLICY "Allow anonymous users to view all varieties"
  ON varieties
  FOR SELECT
  TO anon
  USING (true);

-- Seed Reproductions: Allow anonymous read access
CREATE POLICY "Allow anonymous users to view all seed reproductions"
  ON seed_reproductions
  FOR SELECT
  TO anon
  USING (true);

-- Seasons: Allow anonymous read access
CREATE POLICY "Allow anonymous users to view all seasons"
  ON seasons
  FOR SELECT
  TO anon
  USING (true);

-- Crop Structure: Allow anonymous read access
CREATE POLICY "Allow anonymous users to view all crop structures"
  ON crop_structure
  FOR SELECT
  TO anon
  USING (true);

-- Operations: Allow anonymous read access
CREATE POLICY "Allow anonymous users to view all operations"
  ON operations
  FOR SELECT
  TO anon
  USING (true);

-- Warehouses: Allow anonymous read access
CREATE POLICY "Allow anonymous users to view all warehouses"
  ON warehouses
  FOR SELECT
  TO anon
  USING (true);

-- Products: Allow anonymous read access
CREATE POLICY "Allow anonymous users to view all products"
  ON products
  FOR SELECT
  TO anon
  USING (true);

-- Inventory Transactions: Allow anonymous read access
CREATE POLICY "Allow anonymous users to view all inventory transactions"
  ON inventory_transactions
  FOR SELECT
  TO anon
  USING (true);
