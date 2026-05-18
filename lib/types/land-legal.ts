export type LegalEntityType = "company" | "individual" | "ip" | "government" | "other";

export type LandRightType = "ownership" | "lease" | "sublease" | "use" | "service" | "other";
export type LandDocumentType = "contract" | "certificate" | "act" | "agreement" | "other";
export type LandDocumentStatus = "active" | "expired" | "draft" | "terminated";

export type AllocationMethod = "direct" | "proportional_by_area" | "imported" | "manual_adjusted";
export type LinkSource = "manual" | "import_docx" | "import_excel" | "import_csv" | "system_generated";
export type LinkStatus = "active" | "draft" | "archived";
export type OwnerAllocationStatus = "complete" | "partial_missing_cadastre" | "partial_missing_crop" | "manual_review";

export interface LegalEntity {
  id: string;
  company_id: string;
  name: string;
  short_name: string | null;
  entity_type: LegalEntityType;
  bin_iin: string | null;
  legal_address: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  is_active: boolean;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface CadastralParcel {
  id: string;
  company_id: string;
  cadastral_number: string;
  region: string | null;
  district: string | null;
  rural_district: string | null;
  locality: string | null;
  declared_area_ha: number;
  land_category: string | null;
  land_use_purpose: string | null;
  ownership_status: string | null;
  owner_legal_entity_id: string | null;
  current_user_legal_entity_id: string | null;
  source: string;
  source_document: string | null;
  notes: string | null;
  is_active: boolean;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface LandDocument {
  id: string;
  company_id: string;
  cadastral_parcel_id: string;
  legal_entity_id: string | null;
  right_type: LandRightType;
  document_type: LandDocumentType;
  document_number: string | null;
  document_date: string | null;
  valid_from: string | null;
  valid_to: string | null;
  status: LandDocumentStatus;
  file_url: string | null;
  notes: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface FieldCadastreLink {
  id: string;
  company_id: string;
  season_id: string | null;
  field_id: string;
  cadastral_parcel_id: string;
  crop_plan_allocation_id: string | null;
  crop_id: string | null;
  variety_id: string | null;
  reproduction_id: string | null;
  area_ha: number;
  legal_entity_id: string | null;
  owner_legal_entity_id: string | null;
  usage_legal_entity_id: string | null;
  allocation_method: AllocationMethod;
  source: LinkSource;
  source_document: string | null;
  raw_field_key: string | null;
  raw_crop_name: string | null;
  source_row_hash: string | null;
  import_batch_id: string | null;
  confidence: number | null;
  status: LinkStatus;
  valid_from: string | null;
  valid_to: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface LandAreaMismatchRow {
  company_id: string;
  season_id: string | null;
  season_year: number | null;
  field_id: string;
  field_name: string;
  agro_area_ha: number;
  legal_area_ha: number;
  diff_area_ha: number;
  link_count: number;
  mismatch_status: "ok" | "warning" | "mismatch" | "missing_cadastre";
}

export interface LandSowingByCadastreRow {
  company_id: string;
  season_id: string | null;
  season_year: number | null;
  field_id: string;
  field_name: string;
  cadastral_parcel_id: string;
  cadastral_number: string;
  region: string | null;
  district: string | null;
  rural_district: string | null;
  locality: string | null;
  area_ha: number;
  crop_plan_allocation_id: string | null;
  crop_id: string | null;
  crop_name: string | null;
  variety_id: string | null;
  variety_name: string | null;
  reproduction_id: string | null;
  reproduction_name: string | null;
  legal_entity_id: string | null;
  legal_entity_name: string | null;
  owner_legal_entity_id: string | null;
  owner_legal_entity_name: string | null;
  usage_legal_entity_id: string | null;
  usage_legal_entity_name: string | null;
  allocation_method: AllocationMethod;
  source: LinkSource;
  source_document: string | null;
  status: LinkStatus;
  valid_from: string | null;
  valid_to: string | null;
  notes: string | null;
}

export interface LandOwnerAllocation {
  id: string;
  company_id: string;
  season_id: string;
  owner_legal_entity_id: string;
  field_id: string;
  cadastral_parcel_id: string | null;
  crop_id: string | null;
  area_ha: number;
  source: string;
  source_document: string | null;
  raw_owner_name: string | null;
  raw_field_key: string | null;
  raw_cadastral_number: string | null;
  raw_crop_name: string | null;
  allocation_status: OwnerAllocationStatus;
  missing_cadastre: boolean;
  missing_crop: boolean;
  notes: string | null;
  source_row_hash: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface CanonicalLegalBreakdownRow {
  key: string;
  row_source: "field_cadastre_link" | "owner_allocation_overlay" | "crop_structure_gap";
  company_id: string;
  season_id: string | null;
  field_id: string;
  field_display_name: string;
  technical_key: string | null;
  original_field_key: string | null;
  owner_legal_entity_id: string | null;
  owner_name: string | null;
  rural_district: string | null;
  rural_district_missing: boolean;
  area_ha: number;
  crop_id: string | null;
  crop_name: string | null;
  cadastral_parcel_id: string | null;
  cadastral_number: string | null;
  source_document: string | null;
  missing_cadastre: boolean;
  missing_crop: boolean;
  allocation_status: string;
}

export interface LandImportRawRow {
  row_no: number;
  field: string;
  cadastral_number: string;
  rural_district: string;
  area_ha: number | null;
  crop: string;
  source_document: string;
  source_company_hint: string | null;
  inferred_usage_legal_entity_name: string | null;
  raw: Record<string, string>;
}

export interface LandImportPreviewRow extends LandImportRawRow {
  field_id: string | null;
  crop_id: string | null;
  cadastral_parcel_id: string | null;
  source_mode: LinkSource;
  field_candidates: string[];
  crop_token: string | null;
  area_valid: boolean;
  season_valid: boolean;
  can_insert: boolean;
  warnings: string[];
}

export interface LandImportPreviewResult {
  normalized: LandImportPreviewRow[];
  warnings: string[];
  stats: {
    total_rows: number;
    valid_rows: number;
    warning_rows: number;
    unknown_fields: number;
    unknown_crops: number;
    unknown_cadastres: number;
    ambiguous_fields: number;
    skipped_by_season_rule: number;
    links_to_create: number;
    cadastres_to_create: number;
  };
  detected?: {
    source_document: string;
    source_mode: LinkSource;
    inferred_usage_legal_entity_name: string | null;
    inferred_document_year: number | null;
    season_year: number | null;
    season_match: boolean;
  };
}
