export const MTM_OPERATION_KINDS = ["receipt", "issue", "return"] as const;
export const MTM_ASSET_KINDS = ["machine", "equipment", "transport"] as const;
export const MTM_STOCK_OPTION_KINDS = ["warehouse", "employee", ...MTM_ASSET_KINDS, "task"] as const;
export type MtmOperationKind = typeof MTM_OPERATION_KINDS[number];
export type MtmAssetKind = typeof MTM_ASSET_KINDS[number];
export type MtmStockOptionKind = typeof MTM_STOCK_OPTION_KINDS[number];
export type MtmStockUom = "kg" | "l" | "pcs";
export type MtmStockItem = {
  company_id: string; warehouse_id: string; warehouse_name: string;
  product_id: string; product_name: string; uom: MtmStockUom;
  balance: string; reserved: string; available: string;
  minimum_quantity: string | null; minimum_revision: number; below_minimum: boolean;
  product_archived: boolean; warehouse_archived: boolean; stock_blocked: boolean;
};
export type MtmStockResponse = {
  items: MtmStockItem[]; total: number; offset: number; limit: number;
  can_operate: boolean; can_manage_minimums: boolean;
};
export type MtmOperationPayload = {
  kind: MtmOperationKind; warehouse_id: string; product_id: string; quantity: string;
  uom: MtmStockUom; purpose: string; recipient_id: string | null;
  asset_kind: MtmAssetKind | null; asset_id: string | null;
  task_id: string | null; original_issue_id: string | null;
};
export type MtmOperationRequest = MtmOperationPayload & { companyId: string };
export type MtmOperation = MtmOperationPayload & {
  id: string; company_id: string; created_by: string; created_at: string;
  inventory_transaction_id: string; ledger_entry_id: string;
  remaining_returnable: string; product_name?: string; warehouse_name?: string;
  recipient_name?: string | null; asset_name?: string | null; task_name?: string | null;
  created_by_name?: string | null;
};
export type MtmOperationsResponse = { items: MtmOperation[]; total: number; offset: number; limit: number };
export type MtmStockOption = { id: string; name: string };
export type MtmStockOptionsResponse = { items: MtmStockOption[]; total: number; offset: number; limit: number };
export type MtmMinimumRequest = {
  companyId: string; warehouse_id: string; product_id: string; quantity: string; expected_revision: number;
};
export type MtmMinimumResponse = { minimum_quantity: string; minimum_revision: number };
