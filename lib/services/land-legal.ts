import { supabase } from "@/lib/supabase/client";
import type {
  CadastralParcel,
  CanonicalLegalBreakdownRow,
  FieldCadastreLink,
  LandAreaMismatchRow,
  LandImportPreviewResult,
  LandOwnerAllocation,
  LandSowingByCadastreRow,
  LegalEntity,
} from "@/lib/types/land-legal";

async function buildAuthHeaders(contentType: "json" | "none" = "none") {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.access_token) {
    throw new Error("Session expired");
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${data.session.access_token}`,
  };
  if (contentType === "json") headers["Content-Type"] = "application/json";
  return headers;
}

async function parseJsonOrThrow(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || "Request failed");
  }
  return payload;
}

export async function getLandLegalBootstrap(seasonId?: string) {
  const query = new URLSearchParams();
  if (seasonId) query.set("seasonId", seasonId);
  const headers = await buildAuthHeaders("none");
  const response = await fetch(`/api/land-legal/bootstrap?${query.toString()}`, {
    method: "GET",
    headers,
    cache: "no-store",
  });
  return parseJsonOrThrow(response) as Promise<{
    company: { id: string; name: string };
    seasons: Array<{ id: string; year: number; name: string | null }>;
    fields: Array<{ id: string; name: string; technical_key?: string | null; original_field_key?: string | null; area: number }>;
    crops: Array<{ id: string; name: string }>;
    legalEntities: LegalEntity[];
    cadastres: CadastralParcel[];
    links: FieldCadastreLink[];
    mismatches: LandAreaMismatchRow[];
    sowingRows: LandSowingByCadastreRow[];
    ownerAllocations: LandOwnerAllocation[];
    breakdownRows?: CanonicalLegalBreakdownRow[];
    summary: {
      cadastral_count: number;
      legal_total_area_ha: number;
      agro_total_area_ha: number;
      mismatch_total_ha: number;
      active_documents: number;
      expiring_documents: number;
    };
    diagnostics?: {
      field_count: number;
      cadastral_count: number;
      links_total: number;
      owner_allocations_total: number;
      stem_links: number;
      karagash_links: number;
      owner_sheet_links: number;
      other_links: number;
      owner_sheet_rows: number;
      partial_owner_rows: number;
      legal_breakdown_rows_total: number;
      legal_breakdown_rows_with_rural_district: number;
      legal_breakdown_rows_missing_rural_district: number;
      legal_breakdown_distinct_rural_districts: number;
      cadastral_parcels_with_rural_district: number;
      cadastral_parcels_missing_rural_district: number;
    };
  }>;
}

export async function listCadastres(filters?: { search?: string; seasonId?: string }) {
  const query = new URLSearchParams();
  if (filters?.search) query.set("search", filters.search);
  if (filters?.seasonId) query.set("seasonId", filters.seasonId);
  const headers = await buildAuthHeaders("none");
  const response = await fetch(`/api/land-legal/cadastres?${query.toString()}`, { method: "GET", headers, cache: "no-store" });
  return parseJsonOrThrow(response) as Promise<{ cadastres: CadastralParcel[] }>;
}

export async function createCadastre(payload: Partial<CadastralParcel>) {
  const headers = await buildAuthHeaders("json");
  const response = await fetch("/api/land-legal/cadastres", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(response) as Promise<{ cadastre: CadastralParcel }>;
}

export async function updateCadastre(id: string, payload: Partial<CadastralParcel>) {
  const headers = await buildAuthHeaders("json");
  const response = await fetch(`/api/land-legal/cadastres/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(response) as Promise<{ cadastre: CadastralParcel }>;
}

export async function listLegalEntities(filters?: { search?: string }) {
  const query = new URLSearchParams();
  if (filters?.search) query.set("search", filters.search);
  const headers = await buildAuthHeaders("none");
  const response = await fetch(`/api/land-legal/legal-entities?${query.toString()}`, { method: "GET", headers, cache: "no-store" });
  return parseJsonOrThrow(response) as Promise<{ legalEntities: LegalEntity[] }>;
}

export async function createLegalEntity(payload: Partial<LegalEntity>) {
  const headers = await buildAuthHeaders("json");
  const response = await fetch("/api/land-legal/legal-entities", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(response) as Promise<{ legalEntity: LegalEntity }>;
}

export async function updateLegalEntity(id: string, payload: Partial<LegalEntity>) {
  const headers = await buildAuthHeaders("json");
  const response = await fetch(`/api/land-legal/legal-entities/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(response) as Promise<{ legalEntity: LegalEntity }>;
}

export async function listFieldCadastreLinks(filters?: {
  seasonId?: string;
  fieldId?: string;
  cadastralParcelId?: string;
  cropId?: string;
  status?: string;
}) {
  const query = new URLSearchParams();
  if (filters?.seasonId) query.set("seasonId", filters.seasonId);
  if (filters?.fieldId) query.set("fieldId", filters.fieldId);
  if (filters?.cadastralParcelId) query.set("cadastralParcelId", filters.cadastralParcelId);
  if (filters?.cropId) query.set("cropId", filters.cropId);
  if (filters?.status) query.set("status", filters.status);
  const headers = await buildAuthHeaders("none");
  const response = await fetch(`/api/land-legal/links?${query.toString()}`, { method: "GET", headers, cache: "no-store" });
  return parseJsonOrThrow(response) as Promise<{ links: FieldCadastreLink[] }>;
}

export async function createFieldCadastreLink(payload: Partial<FieldCadastreLink>) {
  const headers = await buildAuthHeaders("json");
  const response = await fetch("/api/land-legal/links", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(response) as Promise<{ link: FieldCadastreLink }>;
}

export async function updateFieldCadastreLink(id: string, payload: Partial<FieldCadastreLink>) {
  const headers = await buildAuthHeaders("json");
  const response = await fetch(`/api/land-legal/links/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(response) as Promise<{ link: FieldCadastreLink }>;
}

export async function getLandLegalReports(params?: { seasonId?: string; mode?: "sowing_by_cadastre" | "by_parcel" | "by_entity" | "mismatches" }) {
  const query = new URLSearchParams();
  if (params?.seasonId) query.set("seasonId", params.seasonId);
  if (params?.mode) query.set("mode", params.mode);
  const headers = await buildAuthHeaders("none");
  const response = await fetch(`/api/land-legal/reports?${query.toString()}`, { method: "GET", headers, cache: "no-store" });
  return parseJsonOrThrow(response) as Promise<{
    sowingRows: LandSowingByCadastreRow[];
    mismatches: LandAreaMismatchRow[];
    byParcel: Array<{
      cadastral_number: string;
      rural_district: string | null;
      rural_districts?: string[];
      has_rural_district_conflict?: boolean;
      declared_area_ha: number;
      linked_area_ha: number;
      fields: string[];
      crops: string[];
    }>;
    byEntity: Array<{ legal_entity_name: string; area_ha: number; cadastre_count: number; fields: string[]; crops: string[] }>;
  }>;
}

export async function previewLandImport(payload: {
  fileName: string;
  fileType: string;
  contentBase64: string;
  seasonId: string;
  sheetName?: string;
  options?: {
    ignore_document_year_mismatch?: boolean;
  };
}) {
  const headers = await buildAuthHeaders("json");
  const response = await fetch("/api/land-legal/import/preview", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(response) as Promise<LandImportPreviewResult>;
}

export async function confirmLandImport(payload: {
  fileName?: string;
  fileType?: string;
  sourceFilePath?: string;
  seasonId: string;
  rows: Array<{
    row_no: number;
    field_id: string | null;
    crop_id: string | null;
    cadastral_parcel_id: string | null;
    cadastral_number: string;
    rural_district: string;
    area_ha: number;
    crop: string;
    field: string;
    source_document?: string;
    source_mode?: "import_docx" | "import_excel" | "import_csv" | "manual" | "system_generated";
    inferred_usage_legal_entity_name?: string | null;
    raw?: Record<string, string>;
    field_candidates?: string[];
    crop_token?: string | null;
    can_insert?: boolean;
    warnings?: string[];
  }>;
  options?: {
    create_missing_cadastres?: boolean;
    create_missing_legal_entities?: boolean;
    usage_legal_entity_name?: string;
  };
  preview_report?: unknown;
}) {
  const headers = await buildAuthHeaders("json");
  const response = await fetch("/api/land-legal/import/confirm", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(response) as Promise<{
    import_batch_id: string;
    inserted_links: number;
    created_cadastres: number;
    created_legal_entities: number;
    skipped_rows: number;
    warnings: string[];
    errors: string[];
  }>;
}

export async function downloadLandLegalExport(params: {
  season_id?: string;
  season_year?: number;
  report_type:
    | "legal_breakdown"
    | "cadastres"
    | "owners"
    | "rural_districts"
    | "crops"
    | "missing_cadastre"
    | "missing_owner"
    | "mismatches";
  search?: string;
  field?: string;
  owner?: string;
  rural_district?: string;
  crop?: string;
  cadastre?: string;
  has_cadastre?: "yes" | "no" | "all";
  has_owner?: "yes" | "no" | "all";
  has_rural_district?: "yes" | "no" | "all";
}) {
  const query = new URLSearchParams();
  if (params.season_id) query.set("season_id", params.season_id);
  if (params.season_year) query.set("season_year", String(params.season_year));
  query.set("report_type", params.report_type);
  if (params.search) query.set("search", params.search);
  if (params.field) query.set("field", params.field);
  if (params.owner) query.set("owner", params.owner);
  if (params.rural_district) query.set("rural_district", params.rural_district);
  if (params.crop) query.set("crop", params.crop);
  if (params.cadastre) query.set("cadastre", params.cadastre);
  if (params.has_cadastre && params.has_cadastre !== "all") {
    query.set("has_cadastre", params.has_cadastre === "yes" ? "true" : "false");
  }
  if (params.has_owner && params.has_owner !== "all") {
    query.set("has_owner", params.has_owner === "yes" ? "true" : "false");
  }
  if (params.has_rural_district && params.has_rural_district !== "all") {
    query.set("has_rural_district", params.has_rural_district === "yes" ? "true" : "false");
  }

  const headers = await buildAuthHeaders("none");
  const response = await fetch(`/api/land-legal/export?${query.toString()}`, {
    method: "GET",
    headers,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error || "Export failed");
  }

  const blob = await response.blob();
  const contentDisposition = response.headers.get("content-disposition") || "";
  const fileNameMatch = contentDisposition.match(/filename=\"?([^\";]+)\"?/i);
  const fileName = fileNameMatch?.[1] || "land-legal-export.xlsx";
  return { blob, fileName };
}
