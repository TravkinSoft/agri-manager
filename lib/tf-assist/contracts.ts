/** No model-selected table, column, filter, URL or RPC is accepted by this contract. */
export const SOURCES = {
  seasons: "id,company_id,name,year,start_date,end_date,archived",
  fields: "id,company_id,name,field_code,area,archived",
  crop_structure:
    "id,company_id,field_id,season_id,crop_id,variety_id,reproduction_id,area,status,archived,identity_review_required",
  crops: "id,company_id,name,name_ru",
  varieties: "id,company_id,crop_id,name,name_ru",
  seed_reproductions: "id,company_id,name,name_ru,code",
  tickets:
    "id,company_id,ticket_no,op_type,status,is_finalized,is_voided,replacement_ticket_id,correction_of_ticket_id,field_id,crop_structure_allocation_id,season_id,vehicle_id,driver_id,combine_operator_person_id,warehouse_to_id,net_weight_kg,accepted_weight_kg,finalized_at,created_at,updated_at,requires_review,weighing_2_at,paper_source:audit_json->paper_backfill->>source,paper_recorded_at:audit_json->paper_backfill->>recorded_at",
  ticket_lines:
    "id,company_id,ticket_id,crop_id,variety_id,reproduction_id,is_mixed_harvest,quantity,uom",
  harvest_lots:
    "id,company_id,lot_code,season_id,source_field_id,crop_id,variety_id,reproduction_id,status,review_state,merged_into_lot_id",
  harvest_lot_batches:
    "id,company_id,harvest_lot_id,inventory_batch_id,source_ticket_id,crop_structure_id",
  inventory_batches:
    "id,company_id,season_id,crop_structure_id,source_field_id,source_ticket_id,parent_batch_id,crop_id,variety_id,reproduction_id,warehouse_id,status,batch_class,batch_code,physical_state",
  stock_ledger_entries:
    "id,company_id,ticket_id,warehouse_id,direction,quantity,uom,delta_qty_signed,reason_type,batch_id,inventory_batch_id,occurred_at,is_storno,storno_of_entry_id,mass_kg",
  warehouses: "id,company_id,name,archived,is_archived,place_type",
  weighbridge_shared_impurity_groups:
    "id,company_id,ticket_id,state,member_resolution_status,source_total_kg,impurity_weight_kg,clean_total_kg,finalized_at,pool_inventory_batch_id",
  weighbridge_shared_impurity_members:
    "id,company_id,group_id,crop_structure_id,field_id,source_total_snapshot_kg,clean_balance_status,yield_status",
  weighbridge_shared_impurity_source_batches:
    "id,company_id,group_id,member_id,crop_structure_id,source_ticket_id,harvest_lot_id,inventory_batch_id,warehouse_id,source_balance_snapshot_kg,state",
  reference_vehicles:
    "id,company_id,name,custom_name,license_plate,plate_number,status,archived,ptc_enabled,primary_responsible_personnel_id,source_machine_id",
  reference_machines: "id,company_id,name,license_plate,status,archived",
  reference_specialists: "id,company_id,person_id,full_name,role,archived",
  company_people: "id,company_id,full_name,role_type,status,deleted_at",
  ptc_flows: "company_id,enabled,field_id,updated_at",
  ptc_vehicle_states:
    "company_id,vehicle_id,assigned,state,version,cycle,since",
  ptc_events:
    "id,company_id,vehicle_id,field_id,from_state,to_state,cycle,created_at",
  ptc_combine_shifts:
    "id,company_id,operator_person_id,operator_name,field_id,opened_at,closed_at,hectares_shift,hectares_field_total",
  ptc_combine_operator_statuses:
    "company_id,operator_user_id,operator_person_id,is_broken,version,changed_at",
  fleet_vehicle_repairs: "company_id,vehicle_id,in_repair,version,changed_at",
} as const;

export type SourceName = keyof typeof SOURCES;
export type Row = Record<string, unknown>;
export type SourceRead = {
  table: SourceName;
  state: "complete" | "unavailable" | "truncated";
  rows: Row[];
  startedAt: string;
  endedAt: string;
  digest: string;
  reason?: string;
  schema: "base" | "settlement_v2";
};
export type Snapshot = {
  companyId: string;
  startedAt: string;
  endedAt: string;
  sources: Partial<Record<SourceName, SourceRead>>;
};
export type Scope = { userId: string; companyId: string };
export type Intent =
  | "harvest"
  | "yield"
  | "stock"
  | "traffic"
  | "fleet"
  | "reconcile";
export type Question = {
  companyId: string;
  message: string;
  seasonId?: string;
  sourceId?: string;
  harvestedHa?: string;
  remainingHa?: string;
};
export type Evidence = {
  table: SourceName;
  id: string;
  status: string;
  occurredAt?: string;
  value?: string;
};
export type Metric = {
  label: string;
  value: string;
  kind: "fact" | "calculation" | "forecast";
  evidence: Evidence[];
  formula?: string;
};
export type Choice = { id: string; label: string };
export type Answer = {
  conclusion: string;
  metrics: Metric[];
  warnings: string[];
  choices?: Choice[];
  seasons?: Choice[];
  sourceId?: string;
  seasonId?: string;
  companyId: string;
  readInterval: { from: string; to: string };
  requestId?: string;
  sourceAudit: Omit<SourceRead, "rows">[];
};
export const str = (r: Row, key: string): string =>
  typeof r[key] === "string" ? (r[key] as string) : "";
export const label = (r: Row | undefined): string =>
  r
    ? (
        str(r, "name_ru") ||
        str(r, "name") ||
        str(r, "full_name") ||
        str(r, "id")
      ).slice(0, 120)
    : "не указано";
export const rows = (s: Snapshot, table: SourceName): Row[] =>
  s.sources[table]?.state === "complete" ? s.sources[table]!.rows : [];
export const complete = (s: Snapshot, tables: SourceName[]): boolean =>
  tables.every((t) => s.sources[t]?.state === "complete");
