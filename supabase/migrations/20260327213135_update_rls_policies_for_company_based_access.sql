/*
  # Update RLS Policies for Company-Based Access
  
  1. Changes
    - Drop old user_id-based policies
    - Create new company_id-based policies for all tables
    - Users can only access data belonging to their company
  
  2. Security
    - All queries filter by: company_id = (SELECT company_id FROM profiles WHERE id = auth.uid())
    - Restrictive by default
*/

-- Helper function to get current user's company_id
CREATE OR REPLACE FUNCTION get_user_company_id()
RETURNS uuid AS $$
  SELECT company_id FROM profiles WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- ============================================
-- FIELDS
-- ============================================

DROP POLICY IF EXISTS "Users can view own fields" ON fields;
DROP POLICY IF EXISTS "Users can insert own fields" ON fields;
DROP POLICY IF EXISTS "Users can update own fields" ON fields;
DROP POLICY IF EXISTS "Users can delete own fields" ON fields;
DROP POLICY IF EXISTS "Allow anonymous users to view all fields" ON fields;
DROP POLICY IF EXISTS "Allow anonymous users to insert fields" ON fields;
DROP POLICY IF EXISTS "Allow anonymous users to update fields" ON fields;
DROP POLICY IF EXISTS "Allow anonymous users to delete fields" ON fields;

CREATE POLICY "Users can view company fields"
  ON fields FOR SELECT
  TO authenticated
  USING (company_id = get_user_company_id());

CREATE POLICY "Users can insert company fields"
  ON fields FOR INSERT
  TO authenticated
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Users can update company fields"
  ON fields FOR UPDATE
  TO authenticated
  USING (company_id = get_user_company_id())
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Users can delete company fields"
  ON fields FOR DELETE
  TO authenticated
  USING (company_id = get_user_company_id());

-- ============================================
-- CROP_STRUCTURE
-- ============================================

DROP POLICY IF EXISTS "Users can view own crop structure" ON crop_structure;
DROP POLICY IF EXISTS "Users can insert own crop structure" ON crop_structure;
DROP POLICY IF EXISTS "Users can update own crop structure" ON crop_structure;
DROP POLICY IF EXISTS "Users can delete own crop structure" ON crop_structure;
DROP POLICY IF EXISTS "Allow anonymous users to view all crop_structure" ON crop_structure;
DROP POLICY IF EXISTS "Allow anonymous users to insert crop_structure" ON crop_structure;
DROP POLICY IF EXISTS "Allow anonymous users to update crop_structure" ON crop_structure;
DROP POLICY IF EXISTS "Allow anonymous users to delete crop_structure" ON crop_structure;

CREATE POLICY "Users can view company crop structure"
  ON crop_structure FOR SELECT
  TO authenticated
  USING (company_id = get_user_company_id());

CREATE POLICY "Users can insert company crop structure"
  ON crop_structure FOR INSERT
  TO authenticated
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Users can update company crop structure"
  ON crop_structure FOR UPDATE
  TO authenticated
  USING (company_id = get_user_company_id())
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Users can delete company crop structure"
  ON crop_structure FOR DELETE
  TO authenticated
  USING (company_id = get_user_company_id());

-- ============================================
-- SEASONS
-- ============================================

DROP POLICY IF EXISTS "Users can view own seasons" ON seasons;
DROP POLICY IF EXISTS "Users can insert own seasons" ON seasons;
DROP POLICY IF EXISTS "Users can update own seasons" ON seasons;
DROP POLICY IF EXISTS "Users can delete own seasons" ON seasons;
DROP POLICY IF EXISTS "Allow anonymous users to view all seasons" ON seasons;
DROP POLICY IF EXISTS "Allow anonymous users to insert seasons" ON seasons;
DROP POLICY IF EXISTS "Allow anonymous users to update seasons" ON seasons;
DROP POLICY IF EXISTS "Allow anonymous users to delete seasons" ON seasons;

CREATE POLICY "Users can view company seasons"
  ON seasons FOR SELECT
  TO authenticated
  USING (company_id = get_user_company_id());

CREATE POLICY "Users can insert company seasons"
  ON seasons FOR INSERT
  TO authenticated
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Users can update company seasons"
  ON seasons FOR UPDATE
  TO authenticated
  USING (company_id = get_user_company_id())
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Users can delete company seasons"
  ON seasons FOR DELETE
  TO authenticated
  USING (company_id = get_user_company_id());

-- ============================================
-- OPERATIONS
-- ============================================

DROP POLICY IF EXISTS "Users can view own operations" ON operations;
DROP POLICY IF EXISTS "Users can insert own operations" ON operations;
DROP POLICY IF EXISTS "Users can update own operations" ON operations;
DROP POLICY IF EXISTS "Users can delete own operations" ON operations;
DROP POLICY IF EXISTS "Allow anonymous users to view all operations" ON operations;
DROP POLICY IF EXISTS "Allow anonymous users to insert operations" ON operations;
DROP POLICY IF EXISTS "Allow anonymous users to update operations" ON operations;
DROP POLICY IF EXISTS "Allow anonymous users to delete operations" ON operations;

CREATE POLICY "Users can view company operations"
  ON operations FOR SELECT
  TO authenticated
  USING (company_id = get_user_company_id());

CREATE POLICY "Users can insert company operations"
  ON operations FOR INSERT
  TO authenticated
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Users can update company operations"
  ON operations FOR UPDATE
  TO authenticated
  USING (company_id = get_user_company_id())
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Users can delete company operations"
  ON operations FOR DELETE
  TO authenticated
  USING (company_id = get_user_company_id());

-- ============================================
-- WAREHOUSES
-- ============================================

DROP POLICY IF EXISTS "Users can view own warehouses" ON warehouses;
DROP POLICY IF EXISTS "Users can insert own warehouses" ON warehouses;
DROP POLICY IF EXISTS "Users can update own warehouses" ON warehouses;
DROP POLICY IF EXISTS "Users can delete own warehouses" ON warehouses;
DROP POLICY IF EXISTS "Allow anonymous users to view all warehouses" ON warehouses;
DROP POLICY IF EXISTS "Allow anonymous users to insert warehouses" ON warehouses;
DROP POLICY IF EXISTS "Allow anonymous users to update warehouses" ON warehouses;
DROP POLICY IF EXISTS "Allow anonymous users to delete warehouses" ON warehouses;

CREATE POLICY "Users can view company warehouses"
  ON warehouses FOR SELECT
  TO authenticated
  USING (company_id = get_user_company_id());

CREATE POLICY "Users can insert company warehouses"
  ON warehouses FOR INSERT
  TO authenticated
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Users can update company warehouses"
  ON warehouses FOR UPDATE
  TO authenticated
  USING (company_id = get_user_company_id())
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Users can delete company warehouses"
  ON warehouses FOR DELETE
  TO authenticated
  USING (company_id = get_user_company_id());

-- ============================================
-- PRODUCTS
-- ============================================

DROP POLICY IF EXISTS "Users can view own products" ON products;
DROP POLICY IF EXISTS "Users can insert own products" ON products;
DROP POLICY IF EXISTS "Users can update own products" ON products;
DROP POLICY IF EXISTS "Users can delete own products" ON products;
DROP POLICY IF EXISTS "Allow anonymous users to view all products" ON products;
DROP POLICY IF EXISTS "Allow anonymous users to insert products" ON products;
DROP POLICY IF EXISTS "Allow anonymous users to update products" ON products;
DROP POLICY IF EXISTS "Allow anonymous users to delete products" ON products;

CREATE POLICY "Users can view company products"
  ON products FOR SELECT
  TO authenticated
  USING (company_id = get_user_company_id());

CREATE POLICY "Users can insert company products"
  ON products FOR INSERT
  TO authenticated
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Users can update company products"
  ON products FOR UPDATE
  TO authenticated
  USING (company_id = get_user_company_id())
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Users can delete company products"
  ON products FOR DELETE
  TO authenticated
  USING (company_id = get_user_company_id());

-- ============================================
-- INVENTORY_TRANSACTIONS
-- ============================================

DROP POLICY IF EXISTS "Users can view own inventory transactions" ON inventory_transactions;
DROP POLICY IF EXISTS "Users can insert own inventory transactions" ON inventory_transactions;
DROP POLICY IF EXISTS "Users can update own inventory transactions" ON inventory_transactions;
DROP POLICY IF EXISTS "Users can delete own inventory transactions" ON inventory_transactions;
DROP POLICY IF EXISTS "Allow anonymous users to view all inventory_transactions" ON inventory_transactions;
DROP POLICY IF EXISTS "Allow anonymous users to insert inventory_transactions" ON inventory_transactions;
DROP POLICY IF EXISTS "Allow anonymous users to update inventory_transactions" ON inventory_transactions;
DROP POLICY IF EXISTS "Allow anonymous users to delete inventory_transactions" ON inventory_transactions;

CREATE POLICY "Users can view company inventory transactions"
  ON inventory_transactions FOR SELECT
  TO authenticated
  USING (company_id = get_user_company_id());

CREATE POLICY "Users can insert company inventory transactions"
  ON inventory_transactions FOR INSERT
  TO authenticated
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Users can update company inventory transactions"
  ON inventory_transactions FOR UPDATE
  TO authenticated
  USING (company_id = get_user_company_id())
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Users can delete company inventory transactions"
  ON inventory_transactions FOR DELETE
  TO authenticated
  USING (company_id = get_user_company_id());

-- ============================================
-- REFERENCE TABLES (crops, varieties, seed_reproductions)
-- ============================================

-- Crops: Allow global (NULL company_id) + company-specific
DROP POLICY IF EXISTS "Users can manage own crops" ON crops;
DROP POLICY IF EXISTS "Users can read crops" ON crops;
DROP POLICY IF EXISTS "Users can view own crops" ON crops;
DROP POLICY IF EXISTS "Users can insert own crops" ON crops;
DROP POLICY IF EXISTS "Users can update own crops" ON crops;
DROP POLICY IF EXISTS "Users can delete own crops" ON crops;
DROP POLICY IF EXISTS "Allow anonymous users to view all crops" ON crops;
DROP POLICY IF EXISTS "Allow anonymous users to insert crops" ON crops;
DROP POLICY IF EXISTS "Allow anonymous users to update crops" ON crops;
DROP POLICY IF EXISTS "Allow anonymous users to delete crops" ON crops;

CREATE POLICY "Users can view global and company crops"
  ON crops FOR SELECT
  TO authenticated
  USING (company_id IS NULL OR company_id = get_user_company_id());

CREATE POLICY "Users can insert company crops"
  ON crops FOR INSERT
  TO authenticated
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Users can update company crops"
  ON crops FOR UPDATE
  TO authenticated
  USING (company_id = get_user_company_id())
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Users can delete company crops"
  ON crops FOR DELETE
  TO authenticated
  USING (company_id = get_user_company_id());

-- Varieties
DROP POLICY IF EXISTS "Users can view own varieties" ON varieties;
DROP POLICY IF EXISTS "Users can insert own varieties" ON varieties;
DROP POLICY IF EXISTS "Users can update own varieties" ON varieties;
DROP POLICY IF EXISTS "Users can delete own varieties" ON varieties;
DROP POLICY IF EXISTS "Allow anonymous users to view all varieties" ON varieties;
DROP POLICY IF EXISTS "Allow anonymous users to insert varieties" ON varieties;
DROP POLICY IF EXISTS "Allow anonymous users to update varieties" ON varieties;
DROP POLICY IF EXISTS "Allow anonymous users to delete varieties" ON varieties;

CREATE POLICY "Users can view company varieties"
  ON varieties FOR SELECT
  TO authenticated
  USING (company_id = get_user_company_id());

CREATE POLICY "Users can insert company varieties"
  ON varieties FOR INSERT
  TO authenticated
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Users can update company varieties"
  ON varieties FOR UPDATE
  TO authenticated
  USING (company_id = get_user_company_id())
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Users can delete company varieties"
  ON varieties FOR DELETE
  TO authenticated
  USING (company_id = get_user_company_id());

-- Seed Reproductions
DROP POLICY IF EXISTS "Users can view own seed reproductions" ON seed_reproductions;
DROP POLICY IF EXISTS "Users can insert own seed reproductions" ON seed_reproductions;
DROP POLICY IF EXISTS "Users can update own seed reproductions" ON seed_reproductions;
DROP POLICY IF EXISTS "Users can delete own seed reproductions" ON seed_reproductions;
DROP POLICY IF EXISTS "Allow anonymous users to view all seed_reproductions" ON seed_reproductions;
DROP POLICY IF EXISTS "Allow anonymous users to insert seed_reproductions" ON seed_reproductions;
DROP POLICY IF EXISTS "Allow anonymous users to update seed_reproductions" ON seed_reproductions;
DROP POLICY IF EXISTS "Allow anonymous users to delete seed_reproductions" ON seed_reproductions;

CREATE POLICY "Users can view company seed reproductions"
  ON seed_reproductions FOR SELECT
  TO authenticated
  USING (company_id = get_user_company_id());

CREATE POLICY "Users can insert company seed reproductions"
  ON seed_reproductions FOR INSERT
  TO authenticated
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Users can update company seed reproductions"
  ON seed_reproductions FOR UPDATE
  TO authenticated
  USING (company_id = get_user_company_id())
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Users can delete company seed reproductions"
  ON seed_reproductions FOR DELETE
  TO authenticated
  USING (company_id = get_user_company_id());