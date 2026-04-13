/*
  # Two-step warehouse issue confirmation

  Changes:
  - warehouse_issue_requests statuses:
    new -> ready -> issued_by_warehouse -> received_confirmed (or cancelled)
  - inventory is deducted only after recipient confirmation
  - issue_warehouse_request() now creates draft issue movements
  - confirm_warehouse_request_receipt() finalizes draft movements to confirmed
*/

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'warehouse_issue_requests'
      AND constraint_name = 'warehouse_issue_requests_status_check'
  ) THEN
    ALTER TABLE public.warehouse_issue_requests
      DROP CONSTRAINT warehouse_issue_requests_status_check;
  END IF;
END $$;

ALTER TABLE public.warehouse_issue_requests
  ADD CONSTRAINT warehouse_issue_requests_status_check
  CHECK (status IN ('new', 'ready', 'issued_by_warehouse', 'received_confirmed', 'cancelled'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'warehouse_issue_requests' AND column_name = 'received_confirmed_at'
  ) THEN
    ALTER TABLE public.warehouse_issue_requests
      ADD COLUMN received_confirmed_at timestamptz;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'warehouse_issue_requests' AND column_name = 'issued_by_user_id'
  ) THEN
    ALTER TABLE public.warehouse_issue_requests
      ADD COLUMN issued_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'warehouse_issue_requests' AND column_name = 'received_confirmed_by_user_id'
  ) THEN
    ALTER TABLE public.warehouse_issue_requests
      ADD COLUMN received_confirmed_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

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
  v_auth_uid uuid;
  v_actor_company_id uuid;
  v_actor_role text;
  v_actor_status text;
  v_now timestamptz := now();
  v_item record;
  v_balance numeric;
BEGIN
  v_auth_uid := auth.uid();
  IF v_auth_uid IS NULL OR v_auth_uid <> p_actor_user_id THEN
    RAISE EXCEPTION 'Unauthorized actor';
  END IF;

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
    RAISE EXCEPTION 'Only active warehouse user can mark issue';
  END IF;

  IF v_request.status = 'received_confirmed' THEN
    RETURN jsonb_build_object('success', true, 'already_confirmed', true, 'request_id', v_request.id);
  END IF;

  IF v_request.status = 'issued_by_warehouse' THEN
    RETURN jsonb_build_object('success', true, 'already_issued_by_warehouse', true, 'request_id', v_request.id);
  END IF;

  IF v_request.status = 'cancelled' THEN
    RAISE EXCEPTION 'Request is cancelled';
  END IF;

  IF v_request.status <> 'ready' THEN
    RAISE EXCEPTION 'Request must be in ready status before issuing';
  END IF;

  PERFORM 1
  FROM public.warehouses w
  WHERE w.id = p_source_warehouse_id
    AND w.company_id = v_request.company_id
    AND w.archived = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source warehouse not found in current company';
  END IF;

  -- Validate against currently confirmed stock.
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

  -- Create draft issue movements (NOT deducted yet).
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
      'draft',
      v_now,
      v_now::date,
      format(
        'Issued by warehouse, pending recipient confirmation. Request %s, operation %s',
        v_request.request_number,
        v_request.operation_id
      ),
      v_request.recipient_user_id,
      NULL,
      p_actor_user_id,
      v_request.company_id,
      v_request.id,
      v_item.id,
      v_request.operation_id,
      v_request.field_id
    );
  END LOOP;

  UPDATE public.warehouse_issue_request_items
  SET issued_quantity = required_quantity
  WHERE request_id = v_request.id;

  UPDATE public.warehouse_issue_requests
  SET
    status = 'issued_by_warehouse',
    source_warehouse_id = p_source_warehouse_id,
    issued_at = v_now,
    issued_by_user_id = p_actor_user_id,
    updated_at = v_now
  WHERE id = v_request.id;

  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_request.id,
    'status', 'issued_by_warehouse',
    'issued_at', v_now
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.issue_warehouse_request(uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_warehouse_request_receipt(
  p_request_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.warehouse_issue_requests%ROWTYPE;
  v_auth_uid uuid;
  v_actor_company_id uuid;
  v_actor_status text;
  v_now timestamptz := now();
  v_item record;
  v_balance numeric;
BEGIN
  v_auth_uid := auth.uid();
  IF v_auth_uid IS NULL OR v_auth_uid <> p_actor_user_id THEN
    RAISE EXCEPTION 'Unauthorized actor';
  END IF;

  SELECT * INTO v_request
  FROM public.warehouse_issue_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Warehouse issue request not found';
  END IF;

  SELECT company_id, status INTO v_actor_company_id, v_actor_status
  FROM public.profiles
  WHERE id = p_actor_user_id
  LIMIT 1;

  IF v_actor_company_id IS NULL THEN
    RAISE EXCEPTION 'Actor profile not found';
  END IF;

  IF v_actor_company_id <> v_request.company_id THEN
    RAISE EXCEPTION 'Company mismatch for request';
  END IF;

  IF COALESCE(v_actor_status, '') <> 'active' THEN
    RAISE EXCEPTION 'Only active recipient can confirm receipt';
  END IF;

  IF v_request.recipient_user_id <> p_actor_user_id THEN
    RAISE EXCEPTION 'Only assigned recipient can confirm receipt';
  END IF;

  IF v_request.status = 'received_confirmed' THEN
    RETURN jsonb_build_object('success', true, 'already_confirmed', true, 'request_id', v_request.id);
  END IF;

  IF v_request.status <> 'issued_by_warehouse' THEN
    RAISE EXCEPTION 'Request must be issued by warehouse before recipient confirmation';
  END IF;

  IF v_request.source_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Source warehouse is not set for request';
  END IF;

  -- Revalidate stock at final confirmation time.
  FOR v_item IN
    SELECT product_id, COALESCE(SUM(quantity), 0)::numeric AS qty
    FROM public.inventory_transactions
    WHERE warehouse_issue_request_id = v_request.id
      AND company_id = v_request.company_id
      AND status = 'draft'
    GROUP BY product_id
  LOOP
    v_balance := public.get_warehouse_product_balance(
      v_request.company_id,
      v_request.source_warehouse_id,
      v_item.product_id
    );

    IF v_balance < v_item.qty THEN
      RAISE EXCEPTION 'Insufficient stock at receipt confirmation for product %. Available: %, required: %',
        v_item.product_id, v_balance, v_item.qty;
    END IF;
  END LOOP;

  -- Finalize deduction.
  UPDATE public.inventory_transactions
  SET
    status = 'confirmed',
    confirmed_at = v_now
  WHERE warehouse_issue_request_id = v_request.id
    AND company_id = v_request.company_id
    AND status = 'draft';

  UPDATE public.warehouse_issue_requests
  SET
    status = 'received_confirmed',
    received_confirmed_at = v_now,
    received_confirmed_by_user_id = p_actor_user_id,
    updated_at = v_now
  WHERE id = v_request.id;

  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_request.id,
    'status', 'received_confirmed',
    'received_confirmed_at', v_now
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_warehouse_request_receipt(uuid, uuid) TO authenticated;
