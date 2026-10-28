export const MTM_CATEGORIES = ["part", "lubricant", "ppe", "tire", "consumable"] as const;
export type MtmCategory = typeof MTM_CATEGORIES[number];
export const MTM_MODEL_KINDS = ["machine", "equipment", "transport"] as const;
export type MtmModelKind = typeof MTM_MODEL_KINDS[number];
export type MtmConfirmationStatus = "pending" | "confirmed" | "rejected";

export interface MtmApplicability {
  model_kind: MtmModelKind;
  model_id: string;
  node: string;
  status: MtmConfirmationStatus;
  source: string | null;
  restrictions: string | null;
}

export interface MtmMetadataInput {
  category: MtmCategory;
  part_number: string | null;
  barcode: string | null;
  internal_code: string | null;
  specifications: string;
  accounting_unit_note: string;
  applicability: MtmApplicability[];
}

export interface MtmProductOption {
  id: string;
  name: string;
  type: string;
  base_uom: string | null;
  pack_uom: string | null;
  units_per_pack: number | null;
}

export interface MtmCatalogItem extends MtmMetadataInput {
  applicability: Array<MtmApplicability & { model_name?: string }>;
  company_id: string;
  product_id: string;
  revision: number;
  updated_at: string;
  updated_by: string;
  product: MtmProductOption;
}

export interface MtmCatalogResponse {
  items: MtmCatalogItem[];
  total: number;
  offset: number;
  limit: number;
  can_edit: boolean;
}

export interface MtmModelOption { id: string; name: string; model_kind: MtmModelKind }
export interface MtmOptionsResponse<T> { items: T[]; total: number; offset: number; limit: number }

export interface MtmSaveRequest extends MtmMetadataInput {
  companyId: string;
  expected_revision: number;
}
