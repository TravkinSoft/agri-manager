export type WarehouseIssueRequestStatus =
  | "new"
  | "active"
  | "preparing"
  | "ready"
  | "issued"
  | "partially_issued"
  | "issued_by_warehouse"
  | "received_confirmed"
  | "cancelled";

export type WarehouseRequestV5Status =
  | "pending"
  | "collecting"
  | "ready_for_pickup"
  | "picked_up_by_specialist"
  | "issued"
  | "return_expected"
  | "return_received"
  | "closed"
  | "cancelled";

export interface WarehouseIssueRequestItem {
  id: string;
  request_id: string;
  company_id: string;
  product_id: string;
  product_category: string | null;
  required_quantity: number;
  planned_quantity?: number | null;
  prepared_quantity?: number | null;
  prepared_unit?: string | null;
  issued_quantity: number | null;
  issued_unit?: string | null;
  received_quantity?: number | null;
  received_unit?: string | null;
  consumed_quantity?: number | null;
  returned_quantity?: number | null;
  unit: string;
  planned_rate_per_ha?: number | null;
  actual_rate_per_ha?: number | null;
  expected_consumed_quantity?: number | null;
  expected_return_quantity?: number | null;
  return_received_quantity?: number | null;
  shortage_quantity?: number | null;
  loss_quantity?: number | null;
  loss_reason?: string | null;
  loss_comment?: string | null;
  return_comment?: string | null;
  package_size?: number | null;
  package_count?: number | null;
  package_unit?: string | null;
  reconciliation_status?:
    | "not_required"
    | "pending"
    | "prepared"
    | "issued"
    | "received"
    | "in_progress"
    | "return_required"
    | "shortage"
    | "return_declared"
    | "return_received"
    | "loss_review"
    | "reconciled"
    | "blocked"
    | "cancelled"
    | string
    | null;
  substitution_status?: "none" | "proposed" | "approved" | "rejected" | string | null;
  planned_product_id?: string | null;
  actual_product_id?: string | null;
  substitution_reason?: string | null;
  substitution_requested_by?: string | null;
  substitution_approved_by?: string | null;
  substitution_approved_at?: string | null;
  batch_id?: string | null;
  created_at: string;
  product_name?: string;
  product_type?: string;
  product_unit?: string;
}

export interface WarehouseIssueRequest {
  id: string;
  request_number: string;
  company_id: string;
  operation_id: string;
  operation_line_id?: string | null;
  field_id: string;
  crop_id?: string | null;
  variety_id?: string | null;
  reproduction_id?: string | null;
  recipient_user_id: string;
  assigned_specialist_id?: string | null;
  source_warehouse_id: string | null;
  planned_datetime: string | null;
  comment: string | null;
  status: WarehouseIssueRequestStatus;
  warehouse_request_status?: WarehouseRequestV5Status | null;
  workflow_status?: "active" | "preparing" | "ready" | "issued" | "closed" | "partially_issued" | "cancelled";
  confirm_token: string | null;
  created_at: string;
  updated_at: string;
  prepared_at?: string | null;
  ready_at: string | null;
  issued_at: string | null;
  collecting_at?: string | null;
  picked_up_at?: string | null;
  return_expected_at?: string | null;
  return_received_at?: string | null;
  return_closed_at?: string | null;
  received_confirmed_at?: string | null;
  specialist_confirmed_at?: string | null;
  cancelled_at: string | null;
  issued_by_user_id?: string | null;
  return_requested_by_user_id?: string | null;
  return_received_by_user_id?: string | null;
  received_confirmed_by_user_id?: string | null;
  specialist_confirmed_by_user_id?: string | null;
  linked_ticket_id?: string | null;

  field_name?: string;
  crop_name?: string | null;
  variety_name?: string | null;
  reproduction_name?: string | null;
  operation_type?: string;
  operation_date?: string;
  operation_notes?: string | null;
  operation_work_status?: string | null;
  recipient_email?: string;
  recipient_name?: string;
  assigned_specialist_name?: string | null;
  source_warehouse_name?: string;
  total_planned_quantity?: number;
  total_issued_quantity?: number;
  fully_issued?: boolean;
  items: WarehouseIssueRequestItem[];
}
