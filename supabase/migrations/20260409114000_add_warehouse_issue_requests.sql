/*
  # Warehouse issue requests linked to agronomy operations

  Adds:
  - warehouse_issue_requests
  - warehouse_issue_request_items
  - links from inventory_transactions to request/item/operation/field
  - SQL function issue_warehouse_request() to validate stock and create issue movements
*/

-- 1) Extend inventory transactions with links to request flow
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inventory_transactions' AND column_name = 'warehouse_issue_request_id'
  ) THEN
    ALTER TABLE public.inventory_transactions
      ADD COLUMN warehouse_issue_request_id uuid;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inventory_transactions' AND column_name = 'warehouse_issue_request_item_id'
  ) THEN
    ALTER TABLE public.inventory_transactions
      ADD COLUMN warehouse_issue_request_item_id uuid;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inventory_transactions' AND column_name = 'operation_id'
  ) THEN
    ALTER TABLE public.inventory_transactions
      ADD COLUMN operation_id uuid;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inventory_transactions' AND column_name = 'field_id'
  ) THEN
    ALTER TABLE public.inventory_transactions
      ADD COLUMN field_id uuid;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'inventory_transactions'
      AND constraint_name = 'inventory_transactions_operation_id_fkey'
  ) THEN
    ALTER TABLE public.inventory_transactions
      ADD CONSTRAINT inventory_transactions_operation_id_fkey
      FOREIGN KEY (operation_id) REFERENCES public.operations(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'inventory_transactions'
      AND constraint_name = 'inventory_transactions_field_id_fkey'
  ) THEN
    ALTER TABLE public.inventory_transactions
      ADD CONSTRAINT inventory_transactions_field_id_fkey
      FOREIGN KEY (field_id) REFERENCES public.fields(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 2) Request number sequence
CREATE SEQUENCE IF NOT EXISTS public.warehouse_issue_request_number_seq START 1;

-- 3) Warehouse issue request tables
CREATE TABLE IF NOT EXISTS public.warehouse_issue_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number text NOT NULL UNIQUE DEFAULT (
    'WR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.warehouse_issue_request_number_seq')::text, 6, '0')
  ),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL REFERENCES public.operations(id) ON DELETE RESTRICT,
  field_id uuid NOT NULL REFERENCES public.fields(id) ON DELETE RESTRICT,
  recipient_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  source_warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
  planned_datetime timestamptz,
  comment text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'ready', 'issued', 'cancelled')),
  confirm_token text,
  ready_at timestamptz,
  issued_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_warehouse_issue_requests_operation
  ON public.warehouse_issue_requests(operation_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_warehouse_issue_requests_confirm_token
  ON public.warehouse_issue_requests(confirm_token)
  WHERE confirm_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_warehouse_issue_requests_company_status
  ON public.warehouse_issue_requests(company_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.warehouse_issue_request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.warehouse_issue_requests(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_category text,
  required_quantity numeric(12, 4) NOT NULL CHECK (required_quantity > 0),
  issued_quantity numeric(12, 4),
  unit text NOT NULL DEFAULT 'kg',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_warehouse_issue_request_items_request
  ON public.warehouse_issue_request_items(request_id);

CREATE INDEX IF NOT EXISTS idx_warehouse_issue_request_items_product
  ON public.warehouse_issue_request_items(product_id);

-- link newly created request tables to inventory transactions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'inventory_transactions'
      AND constraint_name = 'inventory_transactions_warehouse_issue_request_id_fkey'
  ) THEN
    ALTER TABLE public.inventory_transactions
      ADD CONSTRAINT inventory_transactions_warehouse_issue_request_id_fkey
      FOREIGN KEY (warehouse_issue_request_id) REFERENCES public.warehouse_issue_requests(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'inventory_transactions'
      AND constraint_name = 'inventory_transactions_warehouse_issue_request_item_id_fkey'
  ) THEN
    ALTER TABLE public.inventory_transactions
      ADD CONSTRAINT inventory_transactions_warehouse_issue_request_item_id_fkey
      FOREIGN KEY (warehouse_issue_request_item_id) REFERENCES public.warehouse_issue_request_items(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_request_id
  ON public.inventory_transactions(warehouse_issue_request_id);

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_request_item_id
  ON public.inventory_transactions(warehouse_issue_request_item_id);

-- 4) updated_at trigger helper
CREATE OR REPLACE FUNCTION public.set_updated_at_timestamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_warehouse_issue_requests_updated_at ON public.warehouse_issue_requests;
CREATE TRIGGER trg_warehouse_issue_requests_updated_at
BEFORE UPDATE ON public.warehouse_issue_requests
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();

-- 5) RLS
ALTER TABLE public.warehouse_issue_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_issue_request_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view company warehouse issue requests" ON public.warehouse_issue_requests;
CREATE POLICY "Users can view company warehouse issue requests"
  ON public.warehouse_issue_requests FOR SELECT
  TO authenticated
  USING (company_id = get_user_company_id());

DROP POLICY IF EXISTS "Users can insert company warehouse issue requests" ON public.warehouse_issue_requests;
CREATE POLICY "Users can insert company warehouse issue requests"
  ON public.warehouse_issue_requests FOR INSERT
  TO authenticated
  WITH CHECK (company_id = get_user_company_id());

DROP POLICY IF EXISTS "Users can update company warehouse issue requests" ON public.warehouse_issue_requests;
CREATE POLICY "Users can update company warehouse issue requests"
  ON public.warehouse_issue_requests FOR UPDATE
  TO authenticated
  USING (
    company_id = get_user_company_id()
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.company_id = public.warehouse_issue_requests.company_id
        AND p.role = 'warehouse'
        AND p.status = 'active'
    )
  )
  WITH CHECK (company_id = get_user_company_id());

DROP POLICY IF EXISTS "Users can view company warehouse issue request items" ON public.warehouse_issue_request_items;
CREATE POLICY "Users can view company warehouse issue request items"
  ON public.warehouse_issue_request_items FOR SELECT
  TO authenticated
  USING (company_id = get_user_company_id());

DROP POLICY IF EXISTS "Users can insert company warehouse issue request items" ON public.warehouse_issue_request_items;
DROP POLICY IF EXISTS "Users can update company warehouse issue request items" ON public.warehouse_issue_request_items;

-- 6) Stock balance helper used by issue function
CREATE OR REPLACE FUNCTION public.get_warehouse_product_balance(
  p_company_id uuid,
  p_warehouse_id uuid,
  p_product_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance numeric := 0;
BEGIN
  SELECT COALESCE(SUM(delta), 0) INTO v_balance
  FROM (
    SELECT
      CASE
        WHEN it.movement_type = 'transfer' AND it.source_warehouse_id = p_warehouse_id THEN -it.quantity
        WHEN it.movement_type = 'transfer' AND it.destination_warehouse_id = p_warehouse_id THEN it.quantity
        WHEN it.movement_type = 'receipt' AND COALESCE(it.destination_warehouse_id, it.warehouse_id) = p_warehouse_id THEN it.quantity
        WHEN it.movement_type IN ('issue', 'writeoff') AND COALESCE(it.source_warehouse_id, it.warehouse_id) = p_warehouse_id THEN -it.quantity
        WHEN it.movement_type = 'adjustment' AND it.transaction_type = 'in'
             AND COALESCE(it.destination_warehouse_id, it.warehouse_id) = p_warehouse_id THEN it.quantity
        WHEN it.movement_type = 'adjustment' AND it.transaction_type = 'out'
             AND COALESCE(it.source_warehouse_id, it.warehouse_id) = p_warehouse_id THEN -it.quantity
        WHEN it.movement_type IS NULL AND it.transaction_type = 'in' AND it.warehouse_id = p_warehouse_id THEN it.quantity
        WHEN it.movement_type IS NULL AND it.transaction_type = 'out' AND it.warehouse_id = p_warehouse_id THEN -it.quantity
        ELSE 0
      END AS delta
    FROM public.inventory_transactions it
    WHERE it.company_id = p_company_id
      AND it.product_id = p_product_id
      AND COALESCE(it.status, 'confirmed') = 'confirmed'
  ) x;

  RETURN COALESCE(v_balance, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_warehouse_product_balance(uuid, uuid, uuid) TO authenticated;

-- 7) Issue request processing
CREATE OR REPLACE FUNCTION public.issue_warehouse_request(
  p_request_id uuid,
  p_actor_user_id uuid,
  p_source_warehouse_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.warehouse_issue_requests%ROWTYPE;
  v_actor_company_id uuid;
  v_actor_role text;
  v_actor_status text;
  v_now timestamptz := now();
  v_item record;
  v_balance numeric;
BEGIN
  SELECT * INTO v_request
  FROM public.warehouse_issue_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Warehouse issue request not found';
  END IF;

  SELECT company_id, role, status INTO v_actor_company_id, v_actor_role, v_actor_status
  FROM public.profiles
  WHERE id = p_actor_user_id
  LIMIT 1;

  IF v_actor_company_id IS NULL THEN
    RAISE EXCEPTION 'Actor profile not found';
  END IF;

  IF v_actor_company_id <> v_request.company_id THEN
    RAISE EXCEPTION 'Company mismatch for issue request';
  END IF;

  IF COALESCE(v_actor_role, '') <> 'warehouse' OR COALESCE(v_actor_status, '') <> 'active' THEN
    RAISE EXCEPTION 'Only active warehouse user can issue this request';
  END IF;

  IF v_request.status = 'issued' THEN
    RETURN jsonb_build_object('success', true, 'already_issued', true, 'request_id', v_request.id);
  END IF;

  IF v_request.status = 'cancelled' THEN
    RAISE EXCEPTION 'Request is cancelled';
  END IF;

  IF v_request.status <> 'ready' THEN
    RAISE EXCEPTION 'Request must be in ready status before issue';
  END IF;

  PERFORM 1
  FROM public.warehouses w
  WHERE w.id = p_source_warehouse_id
    AND w.company_id = v_request.company_id
    AND w.archived = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source warehouse not found in current company';
  END IF;

  -- validate stock first
  FOR v_item IN
    SELECT *
    FROM public.warehouse_issue_request_items
    WHERE request_id = v_request.id
    ORDER BY created_at ASC
  LOOP
    v_balance := public.get_warehouse_product_balance(
      v_request.company_id,
      p_source_warehouse_id,
      v_item.product_id
    );

    IF v_balance < v_item.required_quantity THEN
      RAISE EXCEPTION 'Insufficient stock for product %. Available: %, required: %',
        v_item.product_id, v_balance, v_item.required_quantity;
    END IF;
  END LOOP;

  -- create movements
  FOR v_item IN
    SELECT *
    FROM public.warehouse_issue_request_items
    WHERE request_id = v_request.id
    ORDER BY created_at ASC
  LOOP
    INSERT INTO public.inventory_transactions (
      warehouse_id,
      source_warehouse_id,
      destination_warehouse_id,
      product_id,
      quantity,
      transaction_type,
      movement_type,
      status,
      operation_datetime,
      date,
      notes,
      responsible_user_id,
      confirmed_at,
      user_id,
      company_id,
      warehouse_issue_request_id,
      warehouse_issue_request_item_id,
      operation_id,
      field_id
    ) VALUES (
      p_source_warehouse_id,
      p_source_warehouse_id,
      NULL,
      v_item.product_id,
      v_item.required_quantity,
      'out',
      'issue',
      'confirmed',
      v_now,
      v_now::date,
      format(
        'Issued by request %s for operation %s',
        v_request.request_number,
        v_request.operation_id
      ),
      v_request.recipient_user_id,
      v_now,
      p_actor_user_id,
      v_request.company_id,
      v_request.id,
      v_item.id,
      v_request.operation_id,
      v_request.field_id
    );

    UPDATE public.warehouse_issue_request_items
    SET issued_quantity = required_quantity
    WHERE id = v_item.id;
  END LOOP;

  UPDATE public.warehouse_issue_requests
  SET
    status = 'issued',
    source_warehouse_id = p_source_warehouse_id,
    issued_at = v_now,
    updated_at = v_now
  WHERE id = v_request.id;

  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_request.id,
    'status', 'issued',
    'issued_at', v_now
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.issue_warehouse_request(uuid, uuid, uuid) TO authenticated;
