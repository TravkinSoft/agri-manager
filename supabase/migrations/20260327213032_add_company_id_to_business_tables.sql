/*
  # Add company_id to Business Tables
  
  1. Changes
    - Add company_id to: fields, crop_structure, seasons, operations, warehouses, products, inventory_transactions
    - Add company_id to reference tables: crops, varieties, seed_reproductions
    - Create indexes for performance
    - Keep user_id for now (will be removed after migration)
  
  2. Notes
    - company_id will be NOT NULL after migration
    - Foreign keys reference companies table
*/

-- Add company_id to fields
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fields' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE fields ADD COLUMN company_id uuid REFERENCES companies(id);
  END IF;
END $$;

-- Add company_id to crop_structure
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'crop_structure' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE crop_structure ADD COLUMN company_id uuid REFERENCES companies(id);
  END IF;
END $$;

-- Add company_id to seasons
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'seasons' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE seasons ADD COLUMN company_id uuid REFERENCES companies(id);
  END IF;
END $$;

-- Add company_id to operations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'operations' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE operations ADD COLUMN company_id uuid REFERENCES companies(id);
  END IF;
END $$;

-- Add company_id to warehouses
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'warehouses' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE warehouses ADD COLUMN company_id uuid REFERENCES companies(id);
  END IF;
END $$;

-- Add company_id to products
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE products ADD COLUMN company_id uuid REFERENCES companies(id);
  END IF;
END $$;

-- Add company_id to inventory_transactions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_transactions' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE inventory_transactions ADD COLUMN company_id uuid REFERENCES companies(id);
  END IF;
END $$;

-- Add company_id to reference tables (crops remains nullable for global crops)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'crops' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE crops ADD COLUMN company_id uuid REFERENCES companies(id);
  END IF;
END $$;

-- Add company_id to varieties
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'varieties' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE varieties ADD COLUMN company_id uuid REFERENCES companies(id);
  END IF;
END $$;

-- Add company_id to seed_reproductions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'seed_reproductions' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE seed_reproductions ADD COLUMN company_id uuid REFERENCES companies(id);
  END IF;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_fields_company_id ON fields(company_id);
CREATE INDEX IF NOT EXISTS idx_crop_structure_company_id ON crop_structure(company_id);
CREATE INDEX IF NOT EXISTS idx_seasons_company_id ON seasons(company_id);
CREATE INDEX IF NOT EXISTS idx_operations_company_id ON operations(company_id);
CREATE INDEX IF NOT EXISTS idx_warehouses_company_id ON warehouses(company_id);
CREATE INDEX IF NOT EXISTS idx_products_company_id ON products(company_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_company_id ON inventory_transactions(company_id);
CREATE INDEX IF NOT EXISTS idx_crops_company_id ON crops(company_id);
CREATE INDEX IF NOT EXISTS idx_varieties_company_id ON varieties(company_id);
CREATE INDEX IF NOT EXISTS idx_seed_reproductions_company_id ON seed_reproductions(company_id);