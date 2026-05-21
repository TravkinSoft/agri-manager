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

export interface WarehouseIssueRequestItem {
  id: string;
  request_id: string;
  company_id: string;
  product_id: string;
  product_category: string | null;
  required_quantity: number;
  planned_quantity?: number | null;
  issued_quantity: number | null;
  consumed_quantity?: number | null;
  returned_quantity?: number | null;
  unit: string;
  planned_rate_per_ha?: number | null;
  actual_rate_per_ha?: number | null;
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
  workflow_status?: "active" | "preparing" | "ready" | "issued" | "partially_issued" | "cancelled";
  confirm_token: string | null;
  created_at: string;
  updated_at: string;
  prepared_at?: string | null;
  ready_at: string | null;
  issued_at: string | null;
  received_confirmed_at?: string | null;
  specialist_confirmed_at?: string | null;
  cancelled_at: string | null;
  issued_by_user_id?: string | null;
  received_confirmed_by_user_id?: string | null;
  specialist_confirmed_by_user_id?: string | null;
  linked_ticket_id?: string | null;

  field_name?: string;
  crop_name?: string | null;
  variety_name?: string | null;
  reproduction_name?: string | null;
  operation_type?: string;
  operation_date?: string;
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
