export const LEGAL_ENTITY_TYPES = ["company", "individual", "ip", "government", "other"] as const;
export const LAND_DOCUMENT_RIGHT_TYPES = [
  "ownership",
  "lease",
  "sublease",
  "use",
  "service",
  "other",
] as const;
export const LAND_DOCUMENT_TYPES = ["contract", "certificate", "act", "agreement", "other"] as const;
export const LAND_DOCUMENT_STATUSES = ["active", "expired", "draft", "terminated"] as const;
export const FIELD_LINK_ALLOCATION_METHODS = [
  "direct",
  "proportional_by_area",
  "imported",
  "manual_adjusted",
] as const;
export const FIELD_LINK_SOURCES = [
  "manual",
  "import_docx",
  "import_excel",
  "import_csv",
  "system_generated",
] as const;
export const FIELD_LINK_STATUSES = ["active", "draft", "archived"] as const;

export const LAND_MISMATCH_STATUSES = ["ok", "warning", "mismatch", "missing_cadastre"] as const;

