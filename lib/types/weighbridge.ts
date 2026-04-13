export type TicketStatus = "draft" | "active" | "ready_to_close" | "finalized" | "voided";
export type TicketDirection = "incoming" | "outgoing" | "transfer" | "processing";
export type WeighMethod = "double_weighing" | "preset_tare" | "manual_override_with_reason";

export interface TicketLineInput {
  product_id: string;
  quantity: number;
  uom?: string;
  notes?: string;
  net_line_weight_kg?: number | null;
  moisture_percent?: number | null;
  dockage_percent?: number | null;
  dirt_tare_percent?: number | null;
  class_grade?: string | null;
  variety_id?: string | null;
  reproduction_id?: string | null;
}

export interface TicketInput {
  company_id: string;
  ticket_type: string;
  op_type: string;
  direction: TicketDirection;
  source_kind: string;
  source_id?: string | null;
  destination_kind: string;
  destination_id?: string | null;
  field_id?: string | null;
  warehouse_from_id?: string | null;
  warehouse_to_id?: string | null;
  processing_point_from_id?: string | null;
  processing_point_to_id?: string | null;
  vehicle_id?: string | null;
  driver_id?: string | null;
  responsible_user_id?: string | null;
  created_by: string;
  weigh_method?: WeighMethod;
  gross_weight_kg?: number | null;
  tare_weight_kg?: number | null;
  notes?: string | null;
  linked_operation_id?: string | null;
  linked_request_id?: string | null;
}

export interface WeighingInput {
  weighing_no: 1 | 2;
  measured_weight_kg: number;
  measured_at?: string;
  device_source?: "scale_device" | "manual";
  operator_user_id?: string | null;
  comment?: string | null;
}

export interface WeighbridgeTicket {
  id: string;
  company_id: string;
  ticket_no: string;
  ticket_type: string;
  op_type: string;
  status: TicketStatus;
  direction: TicketDirection;
  source_kind: string;
  destination_kind: string;
  field_id?: string | null;
  warehouse_from_id?: string | null;
  warehouse_to_id?: string | null;
  processing_point_from_id?: string | null;
  processing_point_to_id?: string | null;
  vehicle_id?: string | null;
  driver_id?: string | null;
  gross_weight_kg?: number | null;
  tare_weight_kg?: number | null;
  net_weight_kg?: number | null;
  weigh_method: WeighMethod;
  is_finalized: boolean;
  is_voided: boolean;
  finalized_at?: string | null;
  created_at: string;
  updated_at: string;
  notes?: string | null;
  lines?: Array<{
    id: string;
    product_id: string;
    product_name: string;
    quantity: number;
    uom: string;
    variety_id?: string | null;
    reproduction_id?: string | null;
  }>;
}
