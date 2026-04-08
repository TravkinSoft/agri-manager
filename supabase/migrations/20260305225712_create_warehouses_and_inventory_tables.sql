/*
  # Create Warehouses and Inventory Management Tables

  ## Purpose
  Track warehouses, products, and inventory transactions for seeds, fertilizers, and pesticides.

  ## New Tables

  ### `warehouses`
  - `id` (uuid, primary key) - Unique identifier for each warehouse
  - `name` (text, required) - Name of the warehouse
  - `created_at` (timestamptz) - Timestamp when warehouse was created
  - `archived` (boolean, default false) - Soft delete flag
  - `user_id` (uuid, required) - Reference to the user who owns this warehouse

  ### `products`
  - `id` (uuid, primary key) - Unique identifier for each product
  - `name` (text, required) - Name of the product
  - `type` (text, required) - Type of product (seed, fertilizer, pesticide)
  - `created_at` (timestamptz) - Timestamp when product was created
  - `archived` (boolean, default false) - Soft delete flag
  - `user_id` (uuid, required) - Reference to the user who owns this product

  ### `inventory_transactions`
  - `id` (uuid, primary key) - Unique identifier for each transaction
  - `warehouse_id` (uuid, required) - Reference to warehouse
  - `product_id` (uuid, required) - Reference to product
  - `quantity` (numeric, required) - Quantity moved (positive for all transactions)
  - `transaction_type` (text, required) - Type of transaction (in or out)
  - `date` (date, required) - Date of transaction
  - `notes` (text, optional) - Additional notes
  - `created_at` (timestamptz) - Timestamp when transaction was created
  - `updated_at` (timestamptz) - Timestamp when transaction was last updated
  - `user_id` (uuid, required) - Reference to the user who owns this transaction

  ## Security

  1. Enable RLS on all tables
  2. Users can only view/modify their own data
  3. Separate policies for SELECT, INSERT, UPDATE, DELETE operations

  ## Constraints

  - Warehouse name must not be empty
  - Product name must not be empty
  - Product type must be one of: seed, fertilizer, pesticide
  - Transaction quantity must be positive
  - Transaction type must be one of: in, out

  ## Indexes

  - Indexes for fast filtering by warehouse, product, date
  - Indexes for user_id on all tables
  - Indexes for archived status

  ## Notes

  - Inventory balance is calculated from transactions (sum of in - sum of out)
  - All tables use soft delete pattern with archived field
*/

-- Create warehouses table
CREATE TABLE IF NOT EXISTS warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  created_at timestamptz DEFAULT now(),
  archived boolean DEFAULT false,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Create indexes for warehouses
CREATE INDEX IF NOT EXISTS idx_warehouses_user_id ON warehouses(user_id);
CREATE INDEX IF NOT EXISTS idx_warehouses_archived ON warehouses(archived);
CREATE INDEX IF NOT EXISTS idx_warehouses_created_at ON warehouses(created_at DESC);

-- Enable RLS on warehouses
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;

-- Warehouses policies
CREATE POLICY "Users can view own warehouses"
  ON warehouses FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own warehouses"
  ON warehouses FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own warehouses"
  ON warehouses FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own warehouses"
  ON warehouses FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Create products table
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  type text NOT NULL CHECK (type IN ('seed', 'fertilizer', 'pesticide')),
  created_at timestamptz DEFAULT now(),
  archived boolean DEFAULT false,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Create indexes for products
CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id);
CREATE INDEX IF NOT EXISTS idx_products_type ON products(type);
CREATE INDEX IF NOT EXISTS idx_products_archived ON products(archived);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at DESC);

-- Enable RLS on products
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Products policies
CREATE POLICY "Users can view own products"
  ON products FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own products"
  ON products FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own products"
  ON products FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own products"
  ON products FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Create inventory_transactions table
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity numeric NOT NULL CHECK (quantity > 0),
  transaction_type text NOT NULL CHECK (transaction_type IN ('in', 'out')),
  date date NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Create indexes for inventory_transactions
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_user_id ON inventory_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_warehouse_id ON inventory_transactions(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_product_id ON inventory_transactions(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_date ON inventory_transactions(date DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_created_at ON inventory_transactions(created_at DESC);

-- Enable RLS on inventory_transactions
ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;

-- Inventory transactions policies
CREATE POLICY "Users can view own inventory transactions"
  ON inventory_transactions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own inventory transactions"
  ON inventory_transactions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own inventory transactions"
  ON inventory_transactions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own inventory transactions"
  ON inventory_transactions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Trigger to update updated_at on inventory_transactions
DROP TRIGGER IF EXISTS update_inventory_transactions_updated_at ON inventory_transactions;
CREATE TRIGGER update_inventory_transactions_updated_at
  BEFORE UPDATE ON inventory_transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
