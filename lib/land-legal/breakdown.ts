import type { SupabaseClient } from "@supabase/supabase-js";
import { getFieldDisplayName, getFieldMetadata, getFieldTechnicalKey } from "@/lib/fields/display";
import { localizedName } from "@/lib/i18n/helpers";

export const STEM_LEGAL_ENTITY_NAME = 'ТОО "Астык-STEM"';
export const KARAGASH_LEGAL_ENTITY_NAME = 'ТОО "Астык-Караагаш"';
export const OWNER_NOT_SET_LABEL = "Нет данных";
export const DISTRICT_NOT_SET_LABEL = "Нет данных";
export const CROP_NOT_SET_LABEL = "Культура не указана";
export const CADASTRE_NOT_SET_LABEL = "Нет данных";

export type SourceKind = "stem" | "karagash" | "owner_sheet" | "other";

export type LandLegalFieldOption = {
  id: string;
  name: string;
  technical_key: string | null;
  original_field_key: string | null;
  area: number;
};

export type CanonicalLegalBreakdownRow = {
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
};

type BuildCanonicalRowsInput = {
  companyId: string;
  seasonId: string | null;
  fieldsRaw: any[];
  cropsRaw: any[];
  legalEntitiesRaw: any[];
  cadastresRaw: any[];
  linksRaw: any[];
  ownerAllocationsRaw: any[];
  cropStructureRowsRaw: any[];
};

type BuildCanonicalRowsResult = {
  fields: LandLegalFieldOption[];
  crops: Array<{ id: string; name: string }>;
  canonicalLegalRows: CanonicalLegalBreakdownRow[];
  gapRows: CanonicalLegalBreakdownRow[];
  canonicalRows: CanonicalLegalBreakdownRow[];
  sourceStats: {
    stem_links: number;
    karagash_links: number;
    owner_sheet_links: number;
    other_links: number;
  };
  ownerSourceStats: {
    owner_sheet_rows: number;
    partial_rows: number;
  };
};

function asText(value: unknown): string {
  return String(value || "").trim();
}

function asComparable(value: unknown): string {
  return asText(value)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ");
}

export function detectSourceKind(sourceDocument?: string | null): SourceKind {
  const value = asComparable(sourceDocument);
  const stemRu = "\u0441\u0442\u0435\u043c";
  const karagashRu = "\u043a\u0430\u0440\u0430\u0433\u0430\u0448";
  const karaagashRu = "\u043a\u0430\u0440\u0430\u0430\u0433\u0430\u0448";
  if (!value) return "other";
  if (value.includes("owner_sheet_handwritten_2026") || value.includes("handwritten_owner_sheet")) {
    return "owner_sheet";
  }
  if (value.includes(stemRu) || value.includes("astyk-stem") || value.includes("stem")) {
    return "stem";
  }
  if (value.includes(karagashRu) || value.includes(karaagashRu) || value.includes("astyk-karagash") || value.includes("karagash") || value.includes("karaagash")) {
    return "karagash";
  }
  if (value.includes("стем") || value.includes("astyk-stem") || value.includes("stem")) {
    return "stem";
  }
  if (
    value.includes("карагаш") ||
    value.includes("караагаш") ||
    value.includes("astyk-karagash") ||
    value.includes("karagash") ||
    value.includes("karaagash")
  ) {
    return "karagash";
  }
  return "other";
}

export function inferOwnerBySourceDocument(sourceDocument?: string | null): string | null {
  const kind = detectSourceKind(sourceDocument);
  if (kind === "stem") return 'ТОО "Астык-STEM"';
  if (kind === "karagash") return 'ТОО "Астык-Караагаш"';
  return null;
}

function signature(params: {
  fieldId: string;
  cadastreId: string | null;
  cropId: string | null;
  areaHa: number;
}): string {
  return [
    params.fieldId,
    params.cadastreId || "none",
    params.cropId || "none",
    Number(params.areaHa || 0).toFixed(3),
  ].join("|");
}

function groupSignature(params: { fieldId: string; cadastreId: string | null }): string {
  return [params.fieldId, params.cadastreId || "none"].join("|");
}

function allocationCompletenessScore(row: any): number {
  const hasCadastre = Boolean(row?.cadastral_parcel_id);
  const hasCrop = Boolean(row?.crop_id);
  const missingCadastre = Boolean(row?.missing_cadastre);
  const missingCrop = Boolean(row?.missing_crop);
  const status = asText(row?.allocation_status);
  let score = 0;
  if (hasCadastre) score += 100;
  if (hasCrop) score += 40;
  if (!missingCadastre) score += 20;
  if (!missingCrop) score += 10;
  if (status === "complete") score += 8;
  if (status === "partial_missing_crop") score += 4;
  if (status === "partial_missing_cadastre") score += 2;
  return score;
}

function dedupeOwnerAllocations(rows: any[]): any[] {
  const byHash = new Map<string, any[]>();
  const withoutHash: any[] = [];

  for (const row of rows || []) {
    const hash = asText(row?.source_row_hash);
    if (!hash) {
      withoutHash.push(row);
      continue;
    }
    const bucket = byHash.get(hash) || [];
    bucket.push(row);
    byHash.set(hash, bucket);
  }

  const deduped = [...withoutHash];
  byHash.forEach((bucket) => {
    if (bucket.length <= 1) {
      deduped.push(bucket[0]);
      return;
    }
    const sorted = [...bucket].sort((a, b) => allocationCompletenessScore(b) - allocationCompletenessScore(a));
    deduped.push(sorted[0]);
  });

  return deduped;
}

export function buildCanonicalRows(input: BuildCanonicalRowsInput): BuildCanonicalRowsResult {
  const fields = (input.fieldsRaw || []).map((field: any) => {
    const metadata = getFieldMetadata(field);
    return {
      id: String(field.id),
      name: getFieldDisplayName(field),
      technical_key: getFieldTechnicalKey(field) || null,
      original_field_key: metadata?.original_field_key || null,
      area: Number(field.area || 0),
    };
  });

  const crops = (input.cropsRaw || []).map((crop: any) => ({
    id: String(crop.id),
    name: localizedName(crop, "ru") || CROP_NOT_SET_LABEL,
  }));

  const fieldById = new Map<string, LandLegalFieldOption>(fields.map((field) => [field.id, field]));
  const cropNameById = new Map<string, string>(crops.map((crop) => [crop.id, crop.name]));
  const cadastreById = new Map<string, any>((input.cadastresRaw || []).map((cadastre: any) => [String(cadastre.id), cadastre]));
  const legalById = new Map<string, any>((input.legalEntitiesRaw || []).map((entity: any) => [String(entity.id), entity]));

  const resolveOwnerName = (params: {
    ownerLegalEntityId?: string | null;
    usageLegalEntityId?: string | null;
    rawOwnerName?: string | null;
    sourceDocument?: string | null;
  }): string | null => {
    const explicitOwner = legalById.get(String(params.ownerLegalEntityId || ""))?.name || null;
    if (explicitOwner) return explicitOwner;

    const rawOwnerName = asText(params.rawOwnerName);
    if (rawOwnerName) return rawOwnerName;

    const inferred = inferOwnerBySourceDocument(params.sourceDocument);
    if (inferred) return inferred;

    return legalById.get(String(params.usageLegalEntityId || ""))?.name || null;
  };

  const sourceStats = (input.linksRaw || []).reduce(
    (acc: { stem_links: number; karagash_links: number; owner_sheet_links: number; other_links: number }, row: any) => {
      const kind = detectSourceKind(row.source_document);
      if (kind === "stem") acc.stem_links += 1;
      else if (kind === "karagash") acc.karagash_links += 1;
      else if (kind === "owner_sheet") acc.owner_sheet_links += 1;
      else acc.other_links += 1;
      return acc;
    },
    { stem_links: 0, karagash_links: 0, owner_sheet_links: 0, other_links: 0 },
  );

  const ownerAllocations = dedupeOwnerAllocations(input.ownerAllocationsRaw || []);

  const ownerSourceStats = ownerAllocations.reduce(
    (acc: { owner_sheet_rows: number; partial_rows: number }, row: any) => {
      if (detectSourceKind(row.source_document) === "owner_sheet") acc.owner_sheet_rows += 1;
      if (String(row.allocation_status || "").startsWith("partial_")) acc.partial_rows += 1;
      return acc;
    },
    { owner_sheet_rows: 0, partial_rows: 0 },
  );

  const canonicalLegalRows: CanonicalLegalBreakdownRow[] = (input.linksRaw || []).map((link: any) => {
    const field = fieldById.get(String(link.field_id));
    const cadastre = cadastreById.get(String(link.cadastral_parcel_id || "")) || null;
    const district = asText(cadastre?.rural_district) || null;

    return {
      key: `link:${String(link.id)}`,
      row_source: "field_cadastre_link",
      company_id: input.companyId,
      season_id: link.season_id ? String(link.season_id) : null,
      field_id: String(link.field_id),
      field_display_name: field?.name || OWNER_NOT_SET_LABEL,
      technical_key: field?.technical_key || null,
      original_field_key: field?.original_field_key || null,
      owner_legal_entity_id: link.owner_legal_entity_id ? String(link.owner_legal_entity_id) : null,
      owner_name: resolveOwnerName({
        ownerLegalEntityId: link.owner_legal_entity_id,
        usageLegalEntityId: link.usage_legal_entity_id,
        sourceDocument: link.source_document,
      }),
      rural_district: district,
      rural_district_missing: !district,
      area_ha: Number(link.area_ha || 0),
      crop_id: link.crop_id ? String(link.crop_id) : null,
      crop_name: cropNameById.get(String(link.crop_id || "")) || asText(link.raw_crop_name) || null,
      cadastral_parcel_id: link.cadastral_parcel_id ? String(link.cadastral_parcel_id) : null,
      cadastral_number: asText(cadastre?.cadastral_number) || null,
      source_document: asText(link.source_document) || null,
      missing_cadastre: !link.cadastral_parcel_id,
      missing_crop: !link.crop_id,
      allocation_status: asText(link.status) || "active",
    };
  });

  const indexBySignature = new Map<string, number>();
  const indexBySourceHash = new Map<string, number>();
  const groupIndicesByFieldCadastre = new Map<string, number[]>();
  canonicalLegalRows.forEach((row, index) => {
    indexBySignature.set(
      signature({
        fieldId: row.field_id,
        cadastreId: row.cadastral_parcel_id,
        cropId: row.crop_id,
        areaHa: row.area_ha,
      }),
      index,
    );
    const rawSourceHash = asText((input.linksRaw || [])[index]?.source_row_hash);
    if (rawSourceHash) {
      indexBySourceHash.set(rawSourceHash, index);
    }

    const groupKey = groupSignature({
      fieldId: row.field_id,
      cadastreId: row.cadastral_parcel_id,
    });
    const bucket = groupIndicesByFieldCadastre.get(groupKey) || [];
    bucket.push(index);
    groupIndicesByFieldCadastre.set(groupKey, bucket);
  });

  ownerAllocations.forEach((allocation: any) => {
    const sig = signature({
      fieldId: String(allocation.field_id),
      cadastreId: allocation.cadastral_parcel_id ? String(allocation.cadastral_parcel_id) : null,
      cropId: allocation.crop_id ? String(allocation.crop_id) : null,
      areaHa: Number(allocation.area_ha || 0),
    });

    const ownerName = resolveOwnerName({
      ownerLegalEntityId: allocation.owner_legal_entity_id,
      rawOwnerName: allocation.raw_owner_name,
      sourceDocument: allocation.source_document,
    });

    const allocationCadastre =
      allocation.cadastral_parcel_id ? cadastreById.get(String(allocation.cadastral_parcel_id || "")) || null : null;
    const district = asText(allocationCadastre?.rural_district) || null;
    let existingIndex = indexBySignature.get(sig);
    if (typeof existingIndex !== "number") {
      const byHash = asText(allocation.source_row_hash);
      if (byHash && indexBySourceHash.has(byHash)) {
        existingIndex = indexBySourceHash.get(byHash);
      }
    }

    if (typeof existingIndex === "number") {
      const current = canonicalLegalRows[existingIndex];
      canonicalLegalRows[existingIndex] = {
        ...current,
        owner_name: ownerName || current.owner_name,
        owner_legal_entity_id:
          current.owner_legal_entity_id || (allocation.owner_legal_entity_id ? String(allocation.owner_legal_entity_id) : null),
        rural_district: district || current.rural_district,
        rural_district_missing: district ? false : current.rural_district_missing,
        missing_cadastre: current.missing_cadastre,
        missing_crop: Boolean(current.missing_crop || allocation.missing_crop),
        allocation_status:
          current.allocation_status === "active"
            ? asText(allocation.allocation_status) || current.allocation_status
            : current.allocation_status,
      };
      return;
    }

    const hasCadastre = Boolean(allocation.cadastral_parcel_id);
    if (hasCadastre) {
      const groupKey = groupSignature({
        fieldId: String(allocation.field_id),
        cadastreId: String(allocation.cadastral_parcel_id),
      });
      const groupIndexes = groupIndicesByFieldCadastre.get(groupKey) || [];
      if (groupIndexes.length > 0) {
        const groupArea = groupIndexes.reduce(
          (sum, rowIndex) => sum + Number(canonicalLegalRows[rowIndex]?.area_ha || 0),
          0,
        );
        const allocationArea = Number(allocation.area_ha || 0);
        if (Math.abs(groupArea - allocationArea) <= 0.01 || allocationArea <= 0) {
          groupIndexes.forEach((rowIndex) => {
            const current = canonicalLegalRows[rowIndex];
            canonicalLegalRows[rowIndex] = {
              ...current,
              owner_name: ownerName || current.owner_name,
              owner_legal_entity_id:
                current.owner_legal_entity_id ||
                (allocation.owner_legal_entity_id ? String(allocation.owner_legal_entity_id) : null),
              rural_district: district || current.rural_district,
              rural_district_missing: district ? false : current.rural_district_missing,
            };
          });
          return;
        }
      }
    }

    const field = fieldById.get(String(allocation.field_id));
    canonicalLegalRows.push({
      key: `owner:${String(allocation.id)}`,
      row_source: "owner_allocation_overlay",
      company_id: input.companyId,
      season_id: allocation.season_id ? String(allocation.season_id) : input.seasonId,
      field_id: String(allocation.field_id),
      field_display_name: field?.name || asText(allocation.raw_field_key) || OWNER_NOT_SET_LABEL,
      technical_key: field?.technical_key || null,
      original_field_key: field?.original_field_key || null,
      owner_legal_entity_id: allocation.owner_legal_entity_id ? String(allocation.owner_legal_entity_id) : null,
      owner_name: ownerName,
      rural_district: district,
      rural_district_missing: !district,
      area_ha: Number(allocation.area_ha || 0),
      crop_id: allocation.crop_id ? String(allocation.crop_id) : null,
      crop_name: cropNameById.get(String(allocation.crop_id || "")) || asText(allocation.raw_crop_name) || null,
      cadastral_parcel_id: allocation.cadastral_parcel_id ? String(allocation.cadastral_parcel_id) : null,
      cadastral_number: asText(allocationCadastre?.cadastral_number) || asText(allocation.raw_cadastral_number) || null,
      source_document: asText(allocation.source_document) || null,
      missing_cadastre: Boolean(allocation.missing_cadastre || !allocation.cadastral_parcel_id),
      missing_crop: Boolean(allocation.missing_crop || !allocation.crop_id),
      allocation_status: asText(allocation.allocation_status) || "manual_review",
    });
  });

  const expectedAreaByFieldCrop = new Map<string, { fieldId: string; cropId: string; expectedArea: number }>();
  (input.cropStructureRowsRaw || []).forEach((row: any) => {
    const fieldId = String(row.field_id || "");
    const cropId = String(row.crop_id || "");
    const area = Number(row.area || 0);
    if (!fieldId || !cropId || !(area > 0)) return;
    const key = `${fieldId}|${cropId}`;
    const current = expectedAreaByFieldCrop.get(key) || { fieldId, cropId, expectedArea: 0 };
    current.expectedArea += area;
    expectedAreaByFieldCrop.set(key, current);
  });

  const coveredAreaByFieldCrop = new Map<string, number>();
  canonicalLegalRows.forEach((row) => {
    if (!row.crop_id) return;
    const key = `${row.field_id}|${row.crop_id}`;
    coveredAreaByFieldCrop.set(key, (coveredAreaByFieldCrop.get(key) || 0) + Number(row.area_ha || 0));
  });

  const gapRows: CanonicalLegalBreakdownRow[] = [];
  expectedAreaByFieldCrop.forEach((expected) => {
    const covered = coveredAreaByFieldCrop.get(`${expected.fieldId}|${expected.cropId}`) || 0;
    const missing = Number((expected.expectedArea - covered).toFixed(3));
    if (missing <= 0.01) return;

    const field = fieldById.get(expected.fieldId);
    gapRows.push({
      key: `gap:${expected.fieldId}:${expected.cropId}`,
      row_source: "crop_structure_gap",
      company_id: input.companyId,
      season_id: input.seasonId,
      field_id: expected.fieldId,
      field_display_name: field?.name || OWNER_NOT_SET_LABEL,
      technical_key: field?.technical_key || null,
      original_field_key: field?.original_field_key || null,
      owner_legal_entity_id: null,
      owner_name: null,
      rural_district: null,
      rural_district_missing: true,
      area_ha: missing,
      crop_id: expected.cropId,
      crop_name: cropNameById.get(expected.cropId) || null,
      cadastral_parcel_id: null,
      cadastral_number: null,
      source_document: null,
      missing_cadastre: true,
      missing_crop: false,
      allocation_status: "partial_legal_coverage",
    });
  });

  return {
    fields,
    crops,
    canonicalLegalRows,
    gapRows,
    canonicalRows: [...canonicalLegalRows, ...gapRows],
    sourceStats,
    ownerSourceStats,
  };
}

export async function getBreakdownRowsForCompany(params: {
  supabase: SupabaseClient;
  companyId: string;
  seasonId: string | null;
}) {
  const { supabase, companyId, seasonId } = params;
  const [fieldsRes, cropsRes, legalEntitiesRes, cadastresRes, linksRes, ownerAllocRes, cropStructureRes] =
    await Promise.all([
      supabase.from("fields").select("id, name, notes, area").eq("company_id", companyId).eq("archived", false).order("name"),
      supabase
        .from("crops")
        .select("id, name, name_ru, company_id, archived, is_active")
        .or(`company_id.is.null,company_id.eq.${companyId}`)
        .eq("archived", false)
        .eq("is_active", true)
        .order("name"),
      supabase.from("legal_entities").select("*").eq("company_id", companyId).eq("archived", false).order("name"),
      supabase.from("cadastral_parcels").select("*").eq("company_id", companyId).eq("archived", false).order("cadastral_number"),
      (() => {
        let query = supabase
          .from("field_cadastre_links")
          .select("*")
          .eq("company_id", companyId)
          .neq("status", "archived")
          .order("created_at", { ascending: false });
        if (seasonId) query = query.eq("season_id", seasonId);
        return query;
      })(),
      (() => {
        let query = supabase
          .from("land_owner_allocations")
          .select("*")
          .eq("company_id", companyId)
          .eq("archived", false)
          .order("created_at", { ascending: false });
        if (seasonId) query = query.eq("season_id", seasonId);
        return query;
      })(),
      (() => {
        let query = supabase
          .from("crop_structure")
          .select("id, field_id, crop_id, area, season_id, status, notes")
          .eq("company_id", companyId)
          .eq("archived", false);
        if (seasonId) query = query.eq("season_id", seasonId);
        return query;
      })(),
    ]);

  const errors = [
    fieldsRes.error,
    cropsRes.error,
    legalEntitiesRes.error,
    cadastresRes.error,
    linksRes.error,
    ownerAllocRes.error && ownerAllocRes.error.code !== "42P01" ? ownerAllocRes.error : null,
    cropStructureRes.error,
  ].filter(Boolean);

  if (errors.length > 0) {
    throw new Error(errors[0]?.message || "Failed to build land legal breakdown");
  }

  const ownerAllocationsRaw = ownerAllocRes.error?.code === "42P01" ? [] : ownerAllocRes.data || [];

  const built = buildCanonicalRows({
    companyId,
    seasonId,
    fieldsRaw: fieldsRes.data || [],
    cropsRaw: cropsRes.data || [],
    legalEntitiesRaw: legalEntitiesRes.data || [],
    cadastresRaw: cadastresRes.data || [],
    linksRaw: linksRes.data || [],
    ownerAllocationsRaw,
    cropStructureRowsRaw: cropStructureRes.data || [],
  });

  return {
    ...built,
    legalEntitiesRaw: legalEntitiesRes.data || [],
    cadastresRaw: cadastresRes.data || [],
    linksRaw: linksRes.data || [],
    ownerAllocationsRaw,
    cropStructureRowsRaw: cropStructureRes.data || [],
  };
}
