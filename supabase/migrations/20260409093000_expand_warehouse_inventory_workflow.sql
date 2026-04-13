/*
  # Expand warehouse inventory workflow for warehouse workspace MVP

  Adds:
  - products: category support for 'produce', unit, description
  - inventory_transactions: movement_type, status, source/destination warehouses, datetime, responsible, audit timestamps
*/

-- 1) Products: allow produce category + add unit/description
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_type_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_type_check CHECK (type IN ('produce', 'seed', 'fertilizer', 'pesticide'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'unit'
  ) THEN
    ALTER TABLE public.products ADD COLUMN unit text NOT NULL DEFAULT 'kg';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'description'
  ) THEN
    ALTER TABLE public.products ADD COLUMN description text;
  END IF;
END $$;

-- 2) Inventory transactions: operation model fields
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inventory_transactions' AND column_name = 'movement_type'
  ) THEN
    ALTER TABLE public.inventory_transactions
      ADD COLUMN movement_type text
      CHECK (movement_type IN ('receipt', 'issue', 'transfer', 'writeoff', 'adjustment'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inventory_transactions' AND column_name = 'status'
  ) THEN
    ALTER TABLE public.inventory_transactions
      ADD COLUMN status text NOT NULL DEFAULT 'confirmed'
      CHECK (status IN ('draft', 'confirmed', 'cancelled'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inventory_transactions' AND column_name = 'source_warehouse_id'
  ) THEN
    ALTER TABLE public.inventory_transactions
      ADD COLUMN source_warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inventory_transactions' AND column_name = 'destination_warehouse_id'
  ) THEN
    ALTER TABLE public.inventory_transactions
      ADD COLUMN destination_warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inventory_transactions' AND column_name = 'operation_datetime'
  ) THEN
    ALTER TABLE public.inventory_transactions
      ADD COLUMN operation_datetime timestamptz DEFAULT now();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inventory_transactions' AND column_name = 'responsible_user_id'
  ) THEN
    ALTER TABLE public.inventory_transactions
      ADD COLUMN responsible_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inventory_transactions' AND column_name = 'confirmed_at'
  ) THEN
    ALTER TABLE public.inventory_transactions ADD COLUMN confirmed_at timestamptz;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inventory_transactions' AND column_name = 'cancelled_at'
  ) THEN
    ALTER TABLE public.inventory_transactions ADD COLUMN cancelled_at timestamptz;
  END IF;
END $$;

-- 3) Backfill legacy rows
UPDATE public.inventory_transactions
SET movement_type = CASE WHEN transaction_type = 'in' THEN 'receipt' ELSE 'issue' END
WHERE movement_type IS NULL;

UPDATE public.inventory_transactions
SET status = 'confirmed'
WHERE status IS NULL;

UPDATE public.inventory_transactions
SET source_warehouse_id = warehouse_id
WHERE source_warehouse_id IS NULL
  AND movement_type IN ('issue', 'writeoff', 'transfer');

UPDATE public.inventory_transactions
SET destination_warehouse_id = warehouse_id
WHERE destination_warehouse_id IS NULL
  AND movement_type IN ('receipt', 'adjustment');

UPDATE public.inventory_transactions
SET operation_datetime = COALESCE(operation_datetime, date::timestamptz, created_at, now())
WHERE operation_datetime IS NULL;

UPDATE public.inventory_transactions
SET confirmed_at = COALESCE(confirmed_at, created_at, now())
WHERE status = 'confirmed' AND confirmed_at IS NULL;

-- 4) Indexes
CREATE INDEX IF NOT EXISTS idx_products_type_company_id ON public.products(type, company_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_status ON public.inventory_transactions(status);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_movement_type ON public.inventory_transactions(movement_type);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_source_warehouse_id ON public.inventory_transactions(source_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_destination_warehouse_id ON public.inventory_transactions(destination_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_operation_datetime ON public.inventory_transactions(operation_datetime DESC);
