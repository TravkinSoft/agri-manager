export type WarehouseIssueRequestStatus =
  | "new"
  | "ready"
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
  issued_quantity: number | null;
  unit: string;
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
  field_id: string;
  recipient_user_id: string;
  source_warehouse_id: string | null;
  planned_datetime: string | null;
  comment: string | null;
  status: WarehouseIssueRequestStatus;
  confirm_token: string | null;
  created_at: string;
  updated_at: string;
  ready_at: string | null;
  issued_at: string | null;
  received_confirmed_at?: string | null;
  cancelled_at: string | null;
  issued_by_user_id?: string | null;
  received_confirmed_by_user_id?: string | null;
  linked_ticket_id?: string | null;

  field_name?: string;
  operation_type?: string;
  operation_date?: string;
  recipient_email?: string;
  source_warehouse_name?: string;
  items: WarehouseIssueRequestItem[];
}
