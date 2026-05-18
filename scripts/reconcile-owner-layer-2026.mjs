#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const COMPANY_ID = "10000000-0000-0000-0000-000000000001";
const SEASON_YEAR = 2026;
const SOURCE_DOCUMENT = "owner_sheet_handwritten_2026";

const OWNER_ROWS = [
  { owner: "Даулбаев", field: "12", area_ha: 146, crop: "пшеница", cadastral_number: "15-164-086-017" },
  { owner: "Сыздыков", field: "14-1", area_ha: 39, crop: "пшеница", cadastral_number: "15-164-086-186" },
  { owner: "Амергалиев", field: "10", area_ha: 70, crop: "ячмень", cadastral_number: "15-164-086-148" },
  { owner: "Ертайлаков", field: "16", area_ha: 200, crop: "ячмень", cadastral_number: "cadastral unreadable" },
  { owner: "Магзеев", field: "16", area_ha: 50, crop: "ячмень", cadastral_number: "cadastral unreadable" },
  { owner: "Звольский", field: "66", area_ha: 23, crop: "ячмень", cadastral_number: "cadastral unreadable" },
  { owner: "Звольский", field: "66", area_ha: 48, crop: "пары", cadastral_number: "cadastral unreadable" },
  { owner: "Мантаева", field: "3", area_ha: 40, crop: "пары", cadastral_number: "15-164-086-219" },
  { owner: "Грицук", field: "3", area_ha: 122, crop: "пары", cadastral_number: "15-164-086-086" },
  { owner: "Сатымгалиев", field: "22", area_ha: 107, crop: "лен", cadastral_number: "15-164-086-186" },
  { owner: "Сатымгалиев", field: "22", area_ha: 97, crop: "лен", cadastral_number: "15-164-086-129" },
  { owner: "Каппасов", field: "66", area_ha: 65, crop: "многолетка", cadastral_number: "15-164-086-250" },
  { owner: "Ваховский", field: "22(Т)", area_ha: 88, crop: "crop unreadable", cadastral_number: "15-164-018-020" },
];

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) args[key] = "true";
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function loadEnv(projectRoot) {
  const envPath = path.join(projectRoot, ".env");
  const text = readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function parseNotesJson(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return {};
  }
}

function asText(value) {
  return String(value || "").trim();
}

function normalizeText(value) {
  return asText(value)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ");
}

function normalizeFieldToken(value) {
  let token = normalizeText(value);
  token = token.replace(/\(.*?\)/g, "");
  token = token.replace(/\bполе\b/g, "");
  token = token.replace(/№/g, "");
  token = token.replace(/[^0-9a-zа-я-]/g, "");
  token = token.replace(/-+/g, "-").replace(/^-|-$/g, "");
  return token;
}

function normalizeCadastre(value) {
  return normalizeText(value)
    .replace(/[–—−]/g, "-")
    .replace(/[^0-9a-zа-я-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function isCadastreReadable(raw) {
  const token = normalizeText(raw);
  if (!token) return false;
  if (token.includes("unreadable")) return false;
  if (token.includes("нетдан")) return false;
  return true;
}

function isCadastreFormatValid(value) {
  return /^\d{2,3}-\d{3}-\d{3}-\d{3}$/.test(value);
}

function toPositiveNumber(value) {
  const parsed = Number(String(value || "").replace(",", ".").trim());
  return Number.isFinite(parsed) && parsed > 0 ? Number(parsed.toFixed(3)) : null;
}

function makeSourceRowHash(row) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        owner: asText(row.owner),
        field: asText(row.field),
        area_ha: toPositiveNumber(row.area_ha),
        crop: asText(row.crop),
        cadastral_number: asText(row.cadastral_number),
        source_document: SOURCE_DOCUMENT,
      }),
    )
    .digest("hex");
}

function suffixIndex(technicalKey) {
  const match = asText(technicalKey).match(/-(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function buildFieldProjection(fieldsRaw, linkRowsRaw) {
  const linkCountByField = new Map();
  for (const link of linkRowsRaw || []) {
    const fieldId = asText(link.field_id);
    if (!fieldId) continue;
    linkCountByField.set(fieldId, (linkCountByField.get(fieldId) || 0) + 1);
  }

  return (fieldsRaw || []).map((field) => {
    const metadata = parseNotesJson(field.notes);
    const technicalKey = asText(metadata.technical_key || field.name);
    const originalFieldKey = asText(metadata.original_field_key || "");
    const displayName = asText(metadata.display_name || originalFieldKey || technicalKey);
    const aliases = new Set(
      [technicalKey, originalFieldKey, displayName, field.name]
        .map(normalizeFieldToken)
        .filter(Boolean),
    );

    return {
      id: String(field.id),
      technicalKey,
      originalFieldKey,
      displayName,
      area: toPositiveNumber(field.area) || 0,
      aliases,
      linkCount: linkCountByField.get(String(field.id)) || 0,
    };
  });
}

function resolveField(row, fields) {
  const token = normalizeFieldToken(row.field);
  const area = toPositiveNumber(row.area_ha);
  const candidates = fields.filter((field) => field.aliases.has(token));
  if (candidates.length === 1) {
    return { field: candidates[0], confidence: 1, reason: "single_alias_match", candidates: [candidates[0].technicalKey] };
  }

  if (candidates.length > 1 && area) {
    const byArea = candidates.filter((field) => Math.abs(Number(field.area || 0) - area) <= 0.001);
    if (byArea.length === 1) {
      return { field: byArea[0], confidence: 0.98, reason: "exact_area_match", candidates: candidates.map((c) => c.technicalKey) };
    }
  }

  if (candidates.length > 1) {
    const linked = candidates.filter((field) => field.linkCount > 0);
    if (linked.length === 1) {
      return { field: linked[0], confidence: 0.92, reason: "single_linked_candidate", candidates: candidates.map((c) => c.technicalKey) };
    }
  }

  if (candidates.length > 1) {
    const sorted = [...candidates].sort((a, b) => {
      if (b.linkCount !== a.linkCount) return b.linkCount - a.linkCount;
      const aSuffix = suffixIndex(a.technicalKey);
      const bSuffix = suffixIndex(b.technicalKey);
      if (aSuffix !== bSuffix) return aSuffix - bSuffix;
      return a.technicalKey.localeCompare(b.technicalKey, "ru");
    });
    return {
      field: sorted[0],
      confidence: 0.75,
      reason: "deterministic_priority_sort",
      candidates: candidates.map((c) => c.technicalKey),
    };
  }

  return { field: null, confidence: 0, reason: "field_not_found", candidates: [] };
}

function pickCropByNames(crops, predicates) {
  for (const predicate of predicates) {
    const found = crops.find(predicate);
    if (found) return found;
  }
  return null;
}

function resolveCrop(rawCrop, crops) {
  const token = normalizeText(rawCrop);
  if (!token || token.includes("unreadable") || token === "нет данных") {
    return { crop: null, reason: "crop_unreadable" };
  }

  const normalizedCrops = crops.map((crop) => ({
    ...crop,
    ru: normalizeText(crop.name_ru || crop.name),
    en: normalizeText(crop.name),
  }));

  let resolved = null;
  if (/пшениц/.test(token)) resolved = pickCropByNames(normalizedCrops, [(c) => c.ru.includes("пшениц") || c.en.includes("wheat")]);
  else if (/ячмен/.test(token)) resolved = pickCropByNames(normalizedCrops, [(c) => c.ru.includes("ячмен") || c.en.includes("barley")]);
  else if (/(лен|лён)/.test(token)) resolved = pickCropByNames(normalizedCrops, [(c) => c.ru.includes("лен") || c.ru.includes("лён") || c.en.includes("flax")]);
  else if (/многолет/.test(token)) resolved = pickCropByNames(normalizedCrops, [(c) => c.ru.includes("многолетние травы") || c.en.includes("perennial")]);
  else if (/^пар(ы)?$/.test(token) || /^пар\b/.test(token)) resolved = pickCropByNames(normalizedCrops, [(c) => c.ru === "пар" || c.ru.includes("пар")]);
  else if (/кукуруз/.test(token) && /силос/.test(token)) {
    resolved = pickCropByNames(normalizedCrops, [(c) => c.ru.includes("кукуруза на силос"), (c) => c.ru.includes("кукуруза")]);
  } else if (/кукуруз/.test(token)) {
    resolved = pickCropByNames(normalizedCrops, [(c) => c.ru.includes("кукуруза"), (c) => c.en.includes("corn")]);
  }

  if (!resolved) {
    resolved = normalizedCrops.find((crop) => crop.ru === token || crop.en === token) || null;
  }

  if (!resolved) {
    return { crop: null, reason: "crop_not_found" };
  }

  return { crop: resolved, reason: null };
}

function allocationScore(row) {
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

function naturalOwnerAllocationKey(row) {
  const ownerId = asText(row.owner_legal_entity_id);
  const fieldId = asText(row.field_id);
  const cadastre = normalizeCadastre(row.raw_cadastral_number || "");
  const area = Number(row.area_ha || 0).toFixed(3);
  const rawField = normalizeFieldToken(row.raw_field_key || "");
  const rawOwner = normalizeText(row.raw_owner_name || "");
  const rawCrop = normalizeText(row.raw_crop_name || "");
  return [ownerId, fieldId, cadastre, area, rawField, rawOwner, rawCrop].join("|");
}

async function main() {
  const args = parseArgs(process.argv);
  const execute = String(args.execute || "").toLowerCase() === "yes";
  const projectRoot = process.cwd();
  loadEnv(projectRoot);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const seasonRes = await supabase.from("seasons").select("id, year").eq("company_id", COMPANY_ID).eq("year", SEASON_YEAR).single();
  if (seasonRes.error || !seasonRes.data) throw seasonRes.error || new Error("Season not found");
  const seasonId = String(seasonRes.data.id);

  const [fieldsRes, cropsRes, entitiesRes, linksRes, cadastresRes, ownerAllocRes] = await Promise.all([
    supabase.from("fields").select("id, name, area, notes").eq("company_id", COMPANY_ID).eq("archived", false),
    supabase
      .from("crops")
      .select("id, name, name_ru, company_id, archived, is_active")
      .or(`company_id.is.null,company_id.eq.${COMPANY_ID}`)
      .eq("archived", false)
      .eq("is_active", true),
    supabase.from("legal_entities").select("id, name").eq("company_id", COMPANY_ID).eq("archived", false),
    supabase
      .from("field_cadastre_links")
      .select("id, season_id, field_id, crop_id, cadastral_parcel_id, area_ha, owner_legal_entity_id, source_document, source_row_hash, status")
      .eq("company_id", COMPANY_ID)
      .eq("season_id", seasonId)
      .neq("status", "archived"),
    supabase
      .from("cadastral_parcels")
      .select("id, cadastral_number, rural_district")
      .eq("company_id", COMPANY_ID)
      .eq("archived", false),
    supabase
      .from("land_owner_allocations")
      .select("*")
      .eq("company_id", COMPANY_ID)
      .eq("season_id", seasonId)
      .eq("archived", false),
  ]);

  const loadError = fieldsRes.error || cropsRes.error || entitiesRes.error || linksRes.error || cadastresRes.error || ownerAllocRes.error;
  if (loadError) throw loadError;

  const fields = buildFieldProjection(fieldsRes.data || [], linksRes.data || []);
  const crops = cropsRes.data || [];
  const legalByNorm = new Map((entitiesRes.data || []).map((entity) => [normalizeText(entity.name), entity]));
  const cadastreByNorm = new Map((cadastresRes.data || []).map((cad) => [normalizeCadastre(cad.cadastral_number), cad]));
  const linkByHash = new Map(
    (linksRes.data || [])
      .filter((row) => asText(row.source_row_hash))
      .map((row) => [asText(row.source_row_hash), row]),
  );
  const ownerAllocByHash = new Map(
    (ownerAllocRes.data || [])
      .filter((row) => asText(row.source_row_hash))
      .map((row) => [asText(row.source_row_hash), row]),
  );

  const dryRows = [];
  const unresolved = [];
  const ownersToCreate = new Set();
  const cadastresToCreate = new Map();

  for (const row of OWNER_ROWS) {
    const sourceRowHash = makeSourceRowHash(row);
    const ownerNorm = normalizeText(row.owner);
    const owner = legalByNorm.get(ownerNorm) || null;
    if (!owner) ownersToCreate.add(row.owner);

    const areaHa = toPositiveNumber(row.area_ha);
    const fieldMatch = resolveField(row, fields);
    const cropMatch = resolveCrop(row.crop, crops);

    const cadReadable = isCadastreReadable(row.cadastral_number);
    const cadNorm = normalizeCadastre(row.cadastral_number);
    const cadFormatValid = cadReadable && isCadastreFormatValid(cadNorm);
    const existingCadastre = cadFormatValid ? cadastreByNorm.get(cadNorm) || null : null;
    if (cadFormatValid && !existingCadastre) {
      const currentArea = cadastresToCreate.get(cadNorm) || null;
      const nextArea = areaHa || currentArea || 1;
      cadastresToCreate.set(cadNorm, nextArea);
    }

    const missingCadastre = !cadReadable || !cadFormatValid || !existingCadastre;
    const missingCrop = !cropMatch.crop;

    let allocationStatus = "complete";
    if (missingCadastre && missingCrop) allocationStatus = "manual_review";
    else if (missingCadastre) allocationStatus = "partial_missing_cadastre";
    else if (missingCrop) allocationStatus = "partial_missing_crop";

    const warnings = [];
    if (!areaHa) warnings.push("invalid_area");
    if (!fieldMatch.field) warnings.push(fieldMatch.reason);
    if (cropMatch.reason) warnings.push(cropMatch.reason);
    if (cadReadable && !cadFormatValid) warnings.push("cadastre_invalid_format");
    if (cadReadable && cadFormatValid && !existingCadastre) warnings.push("cadastre_missing_in_db");
    if (!cadReadable) warnings.push("cadastre_unreadable");

    const canExecute = Boolean(areaHa && fieldMatch.field);
    const rowData = {
      owner: row.owner,
      raw_field_key: row.field,
      raw_crop_name: row.crop,
      raw_cadastral_number: row.cadastral_number,
      area_ha: areaHa,
      source_row_hash: sourceRowHash,
      field_id: fieldMatch.field?.id || null,
      field_technical_key: fieldMatch.field?.technicalKey || null,
      field_display_name: fieldMatch.field?.displayName || null,
      field_confidence: fieldMatch.confidence,
      field_reason: fieldMatch.reason,
      field_candidates: fieldMatch.candidates,
      crop_id: cropMatch.crop?.id || null,
      crop_name_match: cropMatch.crop?.name_ru || cropMatch.crop?.name || null,
      cadastral_parcel_id: existingCadastre?.id || null,
      cadastral_number_match: existingCadastre?.cadastral_number || null,
      owner_legal_entity_id: owner?.id || null,
      owner_name_match: owner?.name || null,
      source_document: SOURCE_DOCUMENT,
      missing_cadastre: missingCadastre,
      missing_crop: missingCrop,
      allocation_status: allocationStatus,
      warnings,
      can_execute: canExecute,
      linked_field_cadastre_hash_exists: linkByHash.has(sourceRowHash),
      existing_owner_allocation_hash_exists: ownerAllocByHash.has(sourceRowHash),
    };

    dryRows.push(rowData);
    if (!canExecute) unresolved.push(rowData);
  }

  const drySummary = {
    rows_total: dryRows.length,
    can_execute: dryRows.filter((row) => row.can_execute).length,
    unresolved: dryRows.filter((row) => !row.can_execute).length,
    complete_candidate: dryRows.filter((row) => row.can_execute && row.allocation_status === "complete").length,
    partial_missing_cadastre_candidate: dryRows.filter((row) => row.can_execute && row.allocation_status === "partial_missing_cadastre").length,
    partial_missing_crop_candidate: dryRows.filter((row) => row.can_execute && row.allocation_status === "partial_missing_crop").length,
    manual_review_candidate: dryRows.filter((row) => row.can_execute && row.allocation_status === "manual_review").length,
    owners_to_create: [...ownersToCreate],
    cadastres_to_create: [...cadastresToCreate.keys()],
  };

  let executeResult = null;

  if (execute) {
    let createdOwners = 0;
    for (const ownerName of ownersToCreate) {
      const existing = legalByNorm.get(normalizeText(ownerName));
      if (existing) continue;
      const insert = await supabase
        .from("legal_entities")
        .insert({
          company_id: COMPANY_ID,
          name: ownerName,
          short_name: null,
          entity_type: "individual",
          notes: `source=${SOURCE_DOCUMENT}; owner-layer reconciliation`,
          is_active: true,
          archived: false,
        })
        .select("id, name")
        .single();
      if (insert.error) throw insert.error;
      legalByNorm.set(normalizeText(insert.data.name), insert.data);
      createdOwners += 1;
    }

    let createdCadastres = 0;
    for (const [cadNumber, declaredArea] of cadastresToCreate.entries()) {
      const existing = cadastreByNorm.get(cadNumber);
      if (existing) continue;
      const insert = await supabase
        .from("cadastral_parcels")
        .insert({
          company_id: COMPANY_ID,
          cadastral_number: cadNumber,
          declared_area_ha: Number(declaredArea || 1),
          source: "import_excel",
          source_document: SOURCE_DOCUMENT,
          notes: "created by owner-layer reconciliation (no fake cadastre)",
          is_active: true,
          archived: false,
        })
        .select("id, cadastral_number")
        .single();
      if (insert.error) throw insert.error;
      cadastreByNorm.set(normalizeCadastre(insert.data.cadastral_number), insert.data);
      createdCadastres += 1;
    }

    const ownerAllocationsLive = await supabase
      .from("land_owner_allocations")
      .select("*")
      .eq("company_id", COMPANY_ID)
      .eq("season_id", seasonId)
      .eq("archived", false);
    if (ownerAllocationsLive.error) throw ownerAllocationsLive.error;

    const rowsByHash = new Map();
    for (const row of ownerAllocationsLive.data || []) {
      const hash = asText(row.source_row_hash);
      if (!hash) continue;
      const bucket = rowsByHash.get(hash) || [];
      bucket.push(row);
      rowsByHash.set(hash, bucket);
    }

    let archivedDuplicates = 0;
    for (const [, bucket] of rowsByHash) {
      if (bucket.length <= 1) continue;
      const sorted = [...bucket].sort((a, b) => allocationScore(b) - allocationScore(a));
      const keep = sorted[0];
      for (const loser of sorted.slice(1)) {
        const archive = await supabase.from("land_owner_allocations").update({ archived: true }).eq("id", loser.id);
        if (archive.error) throw archive.error;
        archivedDuplicates += 1;
      }
      ownerAllocByHash.set(asText(keep.source_row_hash), keep);
    }

    let insertedAllocations = 0;
    let updatedAllocations = 0;
    let skippedUnresolved = 0;
    let updatedLinks = 0;

    for (const row of dryRows) {
      if (!row.can_execute) {
        skippedUnresolved += 1;
        continue;
      }

      const ownerEntity = legalByNorm.get(normalizeText(row.owner));
      const ownerLegalEntityId = ownerEntity?.id || null;
      if (!ownerLegalEntityId) {
        skippedUnresolved += 1;
        continue;
      }

      const cadNorm = normalizeCadastre(row.raw_cadastral_number);
      const cadReadable = isCadastreReadable(row.raw_cadastral_number);
      const cadFormatValid = cadReadable && isCadastreFormatValid(cadNorm);
      const cadastre = cadFormatValid ? cadastreByNorm.get(cadNorm) || null : null;
      const cadastralParcelId = cadastre?.id || null;

      const payload = {
        company_id: COMPANY_ID,
        season_id: seasonId,
        owner_legal_entity_id: ownerLegalEntityId,
        field_id: row.field_id,
        cadastral_parcel_id: cadastralParcelId,
        crop_id: row.crop_id || null,
        area_ha: row.area_ha,
        source: "owner_sheet_import",
        source_document: SOURCE_DOCUMENT,
        raw_owner_name: row.owner,
        raw_field_key: row.raw_field_key,
        raw_cadastral_number: row.raw_cadastral_number,
        raw_crop_name: row.raw_crop_name,
        allocation_status: row.allocation_status,
        missing_cadastre: Boolean(row.missing_cadastre || !cadastralParcelId),
        missing_crop: Boolean(row.missing_crop || !row.crop_id),
        notes: `reconciled_owner_sheet_2026; field_reason=${row.field_reason}; confidence=${row.field_confidence}`,
        source_row_hash: row.source_row_hash,
        archived: false,
      };

      const existingAllocation = ownerAllocByHash.get(row.source_row_hash);
      if (existingAllocation) {
        const update = await supabase.from("land_owner_allocations").update(payload).eq("id", existingAllocation.id);
        if (update.error) throw update.error;
        updatedAllocations += 1;
      } else {
        const insert = await supabase.from("land_owner_allocations").insert(payload);
        if (insert.error) throw insert.error;
        insertedAllocations += 1;
      }

      const link = linkByHash.get(row.source_row_hash);
      if (link) {
        const patch = {};
        if (!link.owner_legal_entity_id) patch.owner_legal_entity_id = ownerLegalEntityId;
        if (!link.crop_id && row.crop_id) patch.crop_id = row.crop_id;
        if (Object.keys(patch).length > 0) {
          const updateLink = await supabase.from("field_cadastre_links").update(patch).eq("id", link.id);
          if (updateLink.error) throw updateLink.error;
          updatedLinks += 1;
        }
      }
    }

    const liveAfterUpsert = await supabase
      .from("land_owner_allocations")
      .select("*")
      .eq("company_id", COMPANY_ID)
      .eq("season_id", seasonId)
      .eq("archived", false)
      .eq("source_document", SOURCE_DOCUMENT);
    if (liveAfterUpsert.error) throw liveAfterUpsert.error;

    const byNaturalKey = new Map();
    for (const row of liveAfterUpsert.data || []) {
      const key = naturalOwnerAllocationKey(row);
      const bucket = byNaturalKey.get(key) || [];
      bucket.push(row);
      byNaturalKey.set(key, bucket);
    }

    let archivedNaturalDuplicates = 0;
    for (const [, bucket] of byNaturalKey) {
      if (bucket.length <= 1) continue;
      const sorted = [...bucket].sort((a, b) => allocationScore(b) - allocationScore(a));
      for (const loser of sorted.slice(1)) {
        const archive = await supabase.from("land_owner_allocations").update({ archived: true }).eq("id", loser.id);
        if (archive.error) throw archive.error;
        archivedNaturalDuplicates += 1;
      }
    }

    const ownerAllocFinal = await supabase
      .from("land_owner_allocations")
      .select("id,owner_legal_entity_id,field_id,cadastral_parcel_id,crop_id,area_ha,source_document,season_id")
      .eq("company_id", COMPANY_ID)
      .eq("season_id", seasonId)
      .eq("archived", false)
      .eq("source_document", SOURCE_DOCUMENT);
    if (ownerAllocFinal.error) throw ownerAllocFinal.error;

    const linksForPatch = await supabase
      .from("field_cadastre_links")
      .select("id,owner_legal_entity_id,field_id,cadastral_parcel_id,crop_id,area_ha,season_id,source_document,status")
      .eq("company_id", COMPANY_ID)
      .eq("season_id", seasonId)
      .eq("source_document", SOURCE_DOCUMENT)
      .neq("status", "archived");
    if (linksForPatch.error) throw linksForPatch.error;

    for (const link of linksForPatch.data || []) {
      if (link.crop_id) continue;
      const matched = (ownerAllocFinal.data || []).find((allocation) => {
        return (
          allocation.owner_legal_entity_id === link.owner_legal_entity_id &&
          allocation.field_id === link.field_id &&
          allocation.cadastral_parcel_id === link.cadastral_parcel_id &&
          Math.abs(Number(allocation.area_ha || 0) - Number(link.area_ha || 0)) <= 0.001 &&
          Boolean(allocation.crop_id)
        );
      });
      if (!matched?.crop_id) continue;
      const patch = await supabase.from("field_cadastre_links").update({ crop_id: matched.crop_id }).eq("id", link.id);
      if (patch.error) throw patch.error;
      updatedLinks += 1;
    }

    executeResult = {
      created_owner_entities: createdOwners,
      created_cadastral_parcels: createdCadastres,
      archived_duplicate_owner_allocations: archivedDuplicates,
      archived_natural_duplicates: archivedNaturalDuplicates,
      inserted_owner_allocations: insertedAllocations,
      updated_owner_allocations: updatedAllocations,
      updated_field_links: updatedLinks,
      skipped_unresolved: skippedUnresolved,
    };
  }

  const output = {
    ok: true,
    mode: execute ? "execute" : "dry-run",
    company_id: COMPANY_ID,
    season_year: SEASON_YEAR,
    season_id: seasonId,
    source_document: SOURCE_DOCUMENT,
    summary: drySummary,
    unresolved_rows: unresolved,
    rows: dryRows,
    execute_result: executeResult,
  };

  const outputDir = path.join(projectRoot, "scripts", "output");
  mkdirSync(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  const outputPath = path.join(outputDir, `owner-layer-reconcile-${execute ? "execute" : "dry-run"}-${stamp}.json`);
  writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf8");

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        output_path: outputPath,
        summary: drySummary,
        execute_result: executeResult,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("[reconcile-owner-layer-2026] failed:", error.message);
  process.exit(1);
});
