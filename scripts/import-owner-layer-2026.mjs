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

const CROP_ALIASES = [
  { rx: /пшениц/, canonical: "пшеница" },
  { rx: /ячмен/, canonical: "ячмень" },
  { rx: /лен/, canonical: "лен" },
  { rx: /многолетк|многолетн|мн\.?трав/, canonical: "многолетние травы" },
  { rx: /пар/, canonical: "пары" },
];

const FIELD_HARD_RULES = new Map([
  ["12", "12-1"],
  ["14-1", "14-1"],
  ["10", "10-1"],
  ["22", "22-1"],
  ["22т", "22-1"],
]);

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
    } else {
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ");
}

function normalizeCadastre(value) {
  return normalizeText(value)
    .replace(/[–—−]/g, "-")
    .replace(/[^0-9a-zа-я-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeFieldToken(raw) {
  let token = normalizeText(raw);
  token = token.replace(/\(т\)|\(ку\)/g, "");
  token = token.replace(/\(.*?\)/g, "");
  token = token.replace(/[№]/g, "");
  token = token.replace(/\bполе\b/g, "");
  token = token.replace(/[^0-9a-zа-я-]/g, "");
  token = token.replace(/-+/g, "-").replace(/^-|-$/g, "");
  return token;
}

function isValidCadastreFormat(value) {
  return /^\d{2,3}-\d{3}-\d{3}-\d{3}$/.test(value);
}

function parsePositive(value) {
  const n = Number(String(value || "").replace(",", ".").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function rowHash(row) {
  return createHash("sha256")
    .update(JSON.stringify(row))
    .digest("hex");
}

function resolveCropToken(raw, crops) {
  const token = normalizeText(raw);
  if (!token || token.includes("unreadable")) return { cropId: null, canonical: null, reason: "crop_unreadable" };
  let canonical = token;
  for (const alias of CROP_ALIASES) {
    if (alias.rx.test(token)) {
      canonical = alias.canonical;
      break;
    }
  }
  const matched = crops.find((c) => normalizeText(c.name) === canonical);
  if (!matched) return { cropId: null, canonical, reason: "crop_not_found" };
  return { cropId: matched.id, canonical: matched.name, reason: null };
}

function deterministicFieldResolve(rawField, fields) {
  const token = normalizeFieldToken(rawField);
  const hard = FIELD_HARD_RULES.get(token);
  if (hard) {
    const matchedHard = fields.find((f) => normalizeFieldToken(f.name) === normalizeFieldToken(hard));
    if (matchedHard) return { field: matchedHard, confidence: 1, reason: "hard_rule_match", candidates: [matchedHard.name] };
  }
  const exact = fields.filter((f) => normalizeFieldToken(f.name) === token);
  if (exact.length === 1) return { field: exact[0], confidence: 1, reason: "exact_field_match", candidates: exact.map((x) => x.name) };
  if (exact.length > 1) return { field: null, confidence: 0, reason: "field_ambiguous_exact", candidates: exact.map((x) => x.name) };

  const starts = fields.filter((f) => normalizeFieldToken(f.name).startsWith(`${token}-`) || normalizeFieldToken(f.name).startsWith(token));
  if (starts.length === 1) return { field: starts[0], confidence: 0.9, reason: "single_prefix_match", candidates: starts.map((x) => x.name) };
  if (starts.length > 1) return { field: null, confidence: 0, reason: "field_ambiguous_prefix", candidates: starts.map((x) => x.name) };
  return { field: null, confidence: 0, reason: "field_not_found", candidates: [] };
}

async function main() {
  const args = parseArgs(process.argv);
  const doExecute = String(args.execute || "").toLowerCase() === "yes";
  const projectRoot = process.cwd();
  loadEnv(projectRoot);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const [{ data: seasons, error: eSeasons }, { data: fields, error: eFields }, { data: crops, error: eCrops }, { data: cadastres, error: eCad }, { data: legalEntities, error: eLe }] =
    await Promise.all([
      supabase.from("seasons").select("id,year").eq("company_id", COMPANY_ID).eq("year", SEASON_YEAR).limit(1),
      supabase.from("fields").select("id,name,area,archived").eq("company_id", COMPANY_ID).eq("archived", false),
      supabase.from("crops").select("id,name,archived").eq("archived", false),
      supabase.from("cadastral_parcels").select("id,cadastral_number,archived").eq("company_id", COMPANY_ID).eq("archived", false),
      supabase.from("legal_entities").select("id,name,entity_type,archived").eq("company_id", COMPANY_ID).eq("archived", false),
    ]);
  if (eSeasons || eFields || eCrops || eCad || eLe) throw eSeasons || eFields || eCrops || eCad || eLe;
  if (!seasons?.length) throw new Error("Season 2026 not found");
  const seasonId = seasons[0].id;

  const cadastreByNorm = new Map(cadastres.map((c) => [normalizeCadastre(c.cadastral_number), c]));
  const legalByNorm = new Map(legalEntities.map((l) => [normalizeText(l.name), l]));
  const dryRows = [];
  const unresolved = [];
  const warnings = [];
  const ownerNamesToCreate = new Set();

  for (const row of OWNER_ROWS) {
    const normalizedOwner = normalizeText(row.owner);
    const hash = rowHash(row);
    const areaHa = parsePositive(row.area_ha);
    const fieldResolved = deterministicFieldResolve(row.field, fields);
    const cropResolved = resolveCropToken(row.crop, crops);
    const cadNorm = normalizeCadastre(row.cadastral_number);
    const cadUnreadable = normalizeText(row.cadastral_number).includes("unreadable");
    const cad = cadUnreadable ? null : cadastreByNorm.get(cadNorm) || null;
    const owner = legalByNorm.get(normalizedOwner) || null;

    const rowWarnings = [];
    if (!areaHa) rowWarnings.push("invalid_area");
    if (!fieldResolved.field) rowWarnings.push(fieldResolved.reason);
    if (cropResolved.reason) rowWarnings.push(cropResolved.reason);
    if (!cad && !cadUnreadable) rowWarnings.push(isValidCadastreFormat(cadNorm) ? "cadastre_to_create" : "cadastre_invalid_format");
    if (cadUnreadable) rowWarnings.push("cadastre_unreadable");
    if (!owner) ownerNamesToCreate.add(row.owner);

    const canExecute = Boolean(areaHa && fieldResolved.field);
    const missingCadastre = !cad;
    const missingCrop = !cropResolved.cropId;
    let allocationStatus = "complete";
    if (missingCadastre && missingCrop) allocationStatus = "manual_review";
    else if (missingCadastre) allocationStatus = "partial_missing_cadastre";
    else if (missingCrop) allocationStatus = "partial_missing_crop";
    if (!canExecute) {
      unresolved.push({
        ...row,
        source_document: SOURCE_DOCUMENT,
        source_row_hash: hash,
        warnings: rowWarnings,
        field_candidates: fieldResolved.candidates,
      });
    }

    dryRows.push({
      ...row,
      source_document: SOURCE_DOCUMENT,
      source_row_hash: hash,
      area_ha: areaHa,
      season_id: seasonId,
      field_id: fieldResolved.field?.id || null,
      field_name_match: fieldResolved.field?.name || null,
      crop_id: cropResolved.cropId,
      crop_name_match: cropResolved.canonical,
      cadastral_parcel_id: cad?.id || null,
      cadastral_number_match: cad?.cadastral_number || null,
      owner_legal_entity_id: owner?.id || null,
      owner_name_match: owner?.name || null,
      warnings: rowWarnings,
      missing_cadastre: missingCadastre,
      missing_crop: missingCrop,
      allocation_status: allocationStatus,
      can_execute: canExecute,
    });
  }

  const drySummary = {
    rows_total: dryRows.length,
    can_execute: dryRows.filter((r) => r.can_execute).length,
    unresolved: dryRows.filter((r) => !r.can_execute).length,
    complete_candidate: dryRows.filter((r) => r.can_execute && r.allocation_status === "complete").length,
    partial_missing_cadastre_candidate: dryRows.filter((r) => r.can_execute && r.allocation_status === "partial_missing_cadastre").length,
    partial_missing_crop_candidate: dryRows.filter((r) => r.can_execute && r.allocation_status === "partial_missing_crop").length,
    ambiguous: dryRows.filter((r) => r.warnings.some((w) => w.includes("ambiguous"))).length,
    cadastre_unreadable: dryRows.filter((r) => r.warnings.includes("cadastre_unreadable")).length,
    crop_unreadable: dryRows.filter((r) => r.warnings.includes("crop_unreadable")).length,
    owners_to_create: [...ownerNamesToCreate],
  };

  let executeResult = null;
  if (doExecute) {
    const insertable = dryRows.filter((r) => r.can_execute);
    const ownerAllocTableCheck = await supabase.from("land_owner_allocations").select("id").limit(1);
    if (ownerAllocTableCheck.error) {
      throw new Error(
        "Table public.land_owner_allocations is missing. Apply migration 20260515102000_add_land_owner_allocations.sql first.",
      );
    }
    const { data: afterLegal, error: eAfterLegal } = await supabase.from("legal_entities").select("id,name").eq("company_id", COMPANY_ID).eq("archived", false);
    if (eAfterLegal) throw eAfterLegal;
    const legalMap = new Map(afterLegal.map((l) => [normalizeText(l.name), l]));
    let createdOwners = 0;
    for (const ownerName of ownerNamesToCreate) {
      const key = normalizeText(ownerName);
      if (legalMap.has(key)) continue;
      const ins = await supabase.from("legal_entities").insert({
        company_id: COMPANY_ID,
        name: ownerName.trim(),
        short_name: null,
        entity_type: "individual",
        notes: `source=${SOURCE_DOCUMENT}; normalized_name=${key}`,
        is_active: true,
        archived: false,
      }).select("id,name").single();
      if (ins.error) throw ins.error;
      legalMap.set(key, ins.data);
      createdOwners += 1;
    }

    let createdCadastres = 0;
    let updatedLinks = 0;
    let insertedLinks = 0;
    let insertedOwnerAllocations = 0;
    let skippedDuplicates = 0;
    const mutationWarnings = [];
    const { data: existingLinks, error: eLinks } = await supabase
      .from("field_cadastre_links")
      .select("id,season_id,field_id,cadastral_parcel_id,crop_id,area_ha,owner_legal_entity_id,source_document")
      .eq("company_id", COMPANY_ID)
      .eq("season_id", seasonId)
      .eq("status", "active");
    if (eLinks) throw eLinks;

    for (const row of insertable) {
      const ownerId = legalMap.get(normalizeText(row.owner))?.id || null;
      if (!ownerId) {
        mutationWarnings.push({ row, reason: "owner_not_resolved_after_create" });
        continue;
      }
      const ownerAllocPayload = {
        company_id: COMPANY_ID,
        season_id: seasonId,
        owner_legal_entity_id: ownerId,
        field_id: row.field_id,
        cadastral_parcel_id: null,
        crop_id: row.crop_id || null,
        area_ha: row.area_ha,
        source: "owner_sheet_import",
        source_document: SOURCE_DOCUMENT,
        raw_owner_name: row.owner,
        raw_field_key: row.field,
        raw_cadastral_number: row.cadastral_number,
        raw_crop_name: row.crop,
        allocation_status: row.allocation_status,
        missing_cadastre: Boolean(row.missing_cadastre),
        missing_crop: Boolean(row.missing_crop),
        notes: `owner_sheet_import;status=${row.allocation_status}`,
        source_row_hash: row.source_row_hash,
        archived: false,
      };
      let cadastreId = row.cadastral_parcel_id;
      if (!cadastreId) {
        const cadNorm = normalizeCadastre(row.cadastral_number);
        if (!isValidCadastreFormat(cadNorm)) {
          mutationWarnings.push({ row, reason: "cadastre_invalid_format_skip" });
          continue;
        }
        const existingCad = await supabase
          .from("cadastral_parcels")
          .select("id,cadastral_number")
          .eq("company_id", COMPANY_ID)
          .eq("archived", false)
          .eq("cadastral_number", cadNorm)
          .maybeSingle();
        if (existingCad.error) throw existingCad.error;
        if (existingCad.data?.id) {
          cadastreId = existingCad.data.id;
        } else {
          const insCad = await supabase.from("cadastral_parcels").insert({
            company_id: COMPANY_ID,
            cadastral_number: cadNorm,
            declared_area_ha: Number(row.area_ha),
            source: "import_excel",
            source_document: SOURCE_DOCUMENT,
            notes: `owner_sheet_import;owner=${row.owner};raw_field=${row.field}`,
            is_active: true,
            archived: false,
          }).select("id").single();
          if (insCad.error) throw insCad.error;
          cadastreId = insCad.data.id;
          createdCadastres += 1;
        }
      }
      const dup = existingLinks.find((l) =>
        l.season_id === seasonId &&
        l.field_id === row.field_id &&
        l.cadastral_parcel_id === cadastreId &&
        (l.crop_id || null) === (row.crop_id || null) &&
        Number(l.area_ha) === Number(row.area_ha)
      );
      if (dup) {
        if (!dup.owner_legal_entity_id) {
          const upd = await supabase
            .from("field_cadastre_links")
            .update({
              owner_legal_entity_id: ownerId,
              source_document: SOURCE_DOCUMENT,
              notes: `owner_sheet_linked:${row.owner};raw_field=${row.field};raw_crop=${row.crop};hash=${row.source_row_hash}`,
            })
            .eq("id", dup.id)
            .select("id")
            .single();
          if (upd.error) throw upd.error;
          updatedLinks += 1;
          const insOwner = await supabase.from("land_owner_allocations").insert({
            ...ownerAllocPayload,
            cadastral_parcel_id: cadastreId,
            allocation_status: row.missing_crop ? "partial_missing_crop" : "complete",
            missing_cadastre: false,
          }).select("id").maybeSingle();
          if (insOwner.error && insOwner.error.code !== "23505") throw insOwner.error;
          if (!insOwner.error) insertedOwnerAllocations += 1;
        } else if (dup.owner_legal_entity_id !== ownerId) {
          mutationWarnings.push({ row, reason: "owner_conflict_existing_link", existing_owner_legal_entity_id: dup.owner_legal_entity_id });
        } else {
          skippedDuplicates += 1;
        }
        continue;
      }

      const ins = await supabase.from("field_cadastre_links").insert({
        company_id: COMPANY_ID,
        season_id: seasonId,
        field_id: row.field_id,
        cadastral_parcel_id: cadastreId,
        crop_plan_allocation_id: null,
        crop_id: row.crop_id,
        variety_id: null,
        reproduction_id: null,
        area_ha: row.area_ha,
        legal_entity_id: null,
        owner_legal_entity_id: ownerId,
        usage_legal_entity_id: null,
        allocation_method: "manual_adjusted",
        source: "import_excel",
        source_document: SOURCE_DOCUMENT,
        raw_field_key: row.field,
        raw_crop_name: row.crop,
        source_row_hash: row.source_row_hash,
        confidence: 1,
        status: "active",
        notes: `owner_sheet_import;owner=${row.owner};cadastre=${row.cadastral_number}`,
      }).select("id").single();
      if (ins.error) throw ins.error;
      insertedLinks += 1;
      const insOwner = await supabase.from("land_owner_allocations").insert({
        ...ownerAllocPayload,
        cadastral_parcel_id: cadastreId,
        allocation_status: row.missing_crop ? "partial_missing_crop" : "complete",
        missing_cadastre: false,
      }).select("id").maybeSingle();
      if (insOwner.error && insOwner.error.code !== "23505") throw insOwner.error;
      if (!insOwner.error) insertedOwnerAllocations += 1;
    }

    for (const row of insertable.filter((r) => r.missing_cadastre)) {
      const ownerId = legalMap.get(normalizeText(row.owner))?.id || null;
      if (!ownerId) continue;
      const insOwner = await supabase.from("land_owner_allocations").insert({
        company_id: COMPANY_ID,
        season_id: seasonId,
        owner_legal_entity_id: ownerId,
        field_id: row.field_id,
        cadastral_parcel_id: null,
        crop_id: row.crop_id || null,
        area_ha: row.area_ha,
        source: "owner_sheet_import",
        source_document: SOURCE_DOCUMENT,
        raw_owner_name: row.owner,
        raw_field_key: row.field,
        raw_cadastral_number: row.cadastral_number,
        raw_crop_name: row.crop,
        allocation_status: row.missing_crop ? "manual_review" : "partial_missing_cadastre",
        missing_cadastre: true,
        missing_crop: Boolean(row.missing_crop),
        notes: `owner_sheet_import;status=${row.missing_crop ? "manual_review" : "partial_missing_cadastre"}`,
        source_row_hash: row.source_row_hash,
        archived: false,
      }).select("id").maybeSingle();
      if (insOwner.error && insOwner.error.code !== "23505") throw insOwner.error;
      if (!insOwner.error) insertedOwnerAllocations += 1;
    }

    executeResult = {
      created_owner_legal_entities: createdOwners,
      created_cadastral_parcels: createdCadastres,
      updated_existing_links_with_owner: updatedLinks,
      inserted_owner_links: insertedLinks,
      inserted_owner_allocations: insertedOwnerAllocations,
      skipped_duplicates: skippedDuplicates,
      skipped_unresolved: unresolved.length,
      mutation_warnings: mutationWarnings,
    };
  }

  const output = {
    ok: true,
    mode: doExecute ? "execute" : "dry-run",
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
  const outPath = path.join(outputDir, `owner-layer-import-${doExecute ? "execute" : "dry-run"}-${stamp}.json`);
  writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");
  process.stdout.write(JSON.stringify({ ok: true, output_path: outPath, summary: drySummary, execute_result: executeResult }, null, 2));
}

main().catch((error) => {
  console.error("[import-owner-layer-2026] failed:", error.message);
  process.exit(1);
});
