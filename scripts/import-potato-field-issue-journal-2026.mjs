#!/usr/bin/env node
/* eslint-disable no-console */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_COMPANY_ID = "10000000-0000-0000-0000-000000000001";
const SEASON_YEAR = 2026;
const SOURCE_TYPE = "manual_historical_issue";
const SOURCE_DOCUMENT = "potato_field_issue_journal_2026";

const JOURNAL_ROWS = [
  { field: "9", variety: "Baltic Rose", reproduction: "1 репродукция", seedsKg: "95 410", areaHa: "36", seedsRate: "2700", fertilizerKg: "9 750", fertilizerRate: "270.8" },
  { field: "9", variety: "Soraya", reproduction: "1 репродукция", seedsKg: "34 720", areaHa: "12", seedsRate: "2700", fertilizerKg: "3 250", fertilizerRate: "270.8" },
  { field: "28", variety: "Soraya", reproduction: "1 репродукция", seedsKg: "31 640", areaHa: "12", seedsRate: "2600", fertilizerKg: "3 540", fertilizerRate: "296.0" },
  { field: "1", variety: "Коломбо(Импала)", reproduction: "Элита", seedsKg: "19 500", areaHa: "8.3", seedsRate: "2300", fertilizerKg: "3 240", fertilizerRate: "294.6" },
  { field: "1", variety: "Gala", reproduction: "1 репродукция", seedsKg: "5 360", areaHa: "2.1", seedsRate: "2600", fertilizerKg: "—", fertilizerRate: "—" },
  { field: "4 Сад", variety: "Gala", reproduction: "1 репродукция", seedsKg: "57 340", areaHa: "22", seedsRate: "2600", fertilizerKg: "6 140", fertilizerRate: "293.6" },
  { field: "28", variety: "Gala", reproduction: "1 репродукция", seedsKg: "84 820", areaHa: "30", seedsRate: "2800", fertilizerKg: "8 860", fertilizerRate: "295.3" },
  { field: "49 Плотина", variety: "Gala", reproduction: "Элита", seedsKg: "81 220", areaHa: "23.1", seedsRate: "3500", fertilizerKg: "11 000", fertilizerRate: "295.7" },
  { field: "49 Плотина", variety: "Soraya", reproduction: "Элита", seedsKg: "40 800", areaHa: "10.8", seedsRate: "3800", fertilizerKg: "—", fertilizerRate: "—" },
  { field: "4 Сад", variety: "Азилит", reproduction: "Элита", seedsKg: "21 000", areaHa: "8", seedsRate: "2600", fertilizerKg: "2 420", fertilizerRate: "268.9" },
  { field: "4 Сад", variety: "Gala", reproduction: "1 репродукция", seedsKg: "2 860", areaHa: "1", seedsRate: "2700", fertilizerKg: "—", fertilizerRate: "—" },
  { field: "49 Плотина", variety: "Gala", reproduction: "1 репродукция", seedsKg: "17 960", areaHa: "7.2", seedsRate: "2500", fertilizerKg: "—", fertilizerRate: "—" },
];

const PRODUCT_TYPES = {
  SEED: "seed",
  FERTILIZER: "fertilizer",
};

const FIELD_HARD_RULES = new Map([
  ["1", "1-1"],
  ["28", "28-1"], // deterministic: текущий картофельный операционный контур в системе
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
    .replace(/ё/gu, "е")
    .replace(/[()]/gu, " ")
    .replace(/[.,]/gu, " ")
    .replace(/\s+/gu, " ");
}

function normalizeFieldToken(value) {
  return normalizeText(value).replace(/[^a-zа-я0-9 -]/giu, "").trim();
}

function numericOrNull(value) {
  const raw = String(value || "")
    .replace(/\s+/gu, "")
    .replace(",", ".")
    .trim();
  if (!raw || raw === "-" || raw === "—") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function hashKey(parts) {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

function makeIdempotencyKey(payload) {
  return hashKey([
    String(payload.seasonYear),
    String(payload.fieldId || "none"),
    String(payload.varietyId || `raw:${payload.rawVariety || ""}`),
    String(payload.reproductionId || `raw:${payload.rawReproduction || ""}`),
    String(payload.productKind || "none"),
    String(payload.quantityKg || "0"),
    SOURCE_DOCUMENT,
  ]);
}

function formatPreviewRow(base, extra) {
  return {
    row_no: base.rowNo,
    field_raw: base.raw.field,
    variety_raw: base.raw.variety,
    reproduction_raw: base.raw.reproduction,
    area_ha: base.areaHa,
    seeds_kg: base.seedsKg,
    seeds_rate_kg_ha: base.seedsRate,
    fertilizer_kg: base.fertilizerKg,
    fertilizer_rate_kg_ha: base.fertilizerRate,
    ...extra,
  };
}

function pickWarehouseByType(warehouses, wantedType) {
  const typed = warehouses.filter((w) => normalizeText(w.warehouse_type) === wantedType);
  if (!typed.length) return { status: "unresolved", warehouse: null, candidates: [] };

  const nonQa = typed.filter((w) => !normalizeText(w.name).includes("qa_test"));
  const pool = nonQa.length ? nonQa : typed;
  const active = pool.filter((w) => w.archived !== true && w.is_archived !== true);
  if (active.length === 1) return { status: "resolved_active", warehouse: active[0], candidates: [active[0].name] };

  if (active.length > 1) {
    const sorted = [...active].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    return { status: "resolved_active_latest", warehouse: sorted[0], candidates: active.map((x) => x.name) };
  }

  if (pool.length === 1) {
    return {
      status: "resolved_archived",
      warehouse: pool[0],
      candidates: [pool[0].name],
    };
  }

  const canonicalNames = wantedType === "seed"
    ? ["семенной склад", "seed warehouse"]
    : ["склад удобрений", "fertilizer warehouse"];
  for (const canonical of canonicalNames) {
    const found = pool.find((w) => normalizeText(w.name) === canonical);
    if (found) {
      return {
        status: "resolved_archived_named",
        warehouse: found,
        candidates: pool.map((x) => x.name),
      };
    }
  }

  const sorted = [...pool].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  return {
    status: "resolved_archived_latest",
    warehouse: sorted[0],
    candidates: pool.map((x) => x.name),
  };
}

function resolveVariety(rawVariety, varieties, potatoCropId) {
  const rawNorm = normalizeText(rawVariety);
  const potatoVarieties = varieties.filter((v) => String(v.crop_id || "") === String(potatoCropId || ""));

  const exact = potatoVarieties.filter((v) => normalizeText(v.name) === rawNorm);
  if (exact.length === 1) return { status: "matched", value: exact[0], match_type: "exact" };
  if (exact.length > 1) return { status: "ambiguous", candidates: exact, reason: "exact_multiple" };

  const hasColombo = /(коломбо|colombo)/iu.test(rawVariety);
  const hasImpala = /(импала|impala)/iu.test(rawVariety);
  if (hasColombo && hasImpala) {
    const candidates = potatoVarieties.filter((v) => /(коломбо|colombo|импала|impala)/iu.test(v.name));
    return { status: "ambiguous", candidates, reason: "colombo_impala_pair" };
  }

  const aliasRules = [
    { key: "gala", pattern: /(^|\s)(gala|гала)(\s|$)/iu, match: /(gala|гала)/iu },
    { key: "soraya", pattern: /(^|\s)(soraya|сорая)(\s|$)/iu, match: /(soraya|сорая)/iu },
    { key: "baltic_rose", pattern: /(baltic|балтик).*?(rose|роуз)|(?:rose|роуз).*?(?:baltic|балтик)/iu, match: /(baltic|балтик).*?(rose|роуз)|(?:rose|роуз).*?(?:baltic|балтик)/iu },
    { key: "colombo", pattern: /(коломбо|colombo)/iu, match: /(коломбо|colombo)/iu },
    { key: "impala", pattern: /(импала|impala)/iu, match: /(импала|impala)/iu },
    { key: "azilit", pattern: /(азилит|azilit)/iu, match: /(азилит|azilit)/iu },
  ];

  const alias = aliasRules.find((x) => x.pattern.test(rawVariety));
  if (!alias) return { status: "to_create", value: null, alias_key: null };

  const candidates = potatoVarieties.filter((v) => alias.match.test(v.name));
  if (candidates.length === 1) return { status: "matched", value: candidates[0], alias_key: alias.key, match_type: "alias" };
  if (candidates.length > 1) return { status: "ambiguous", candidates, alias_key: alias.key, reason: "alias_multiple" };
  return { status: "to_create", value: null, alias_key: alias.key };
}

function resolveReproduction(rawReproduction, reproductions) {
  const rawNorm = normalizeText(rawReproduction);
  const exact = reproductions.filter((r) => normalizeText(r.name) === rawNorm);
  if (exact.length === 1) return { status: "matched", value: exact[0], match_type: "exact" };
  if (exact.length > 1) return { status: "ambiguous", candidates: exact, reason: "exact_multiple" };

  const aliasRules = [
    { key: "elite", pattern: /(элита|elite)\b/iu, match: /(элита|elite)\b/iu },
    { key: "r1", pattern: /(1[\s-]*репр|первая[\s-]*репр|r1|first\s*repro)/iu, match: /(первая|1[\s-]*репр|r1|first)/iu },
  ];
  const alias = aliasRules.find((x) => x.pattern.test(rawReproduction));
  if (!alias) return { status: "unmatched", value: null, alias_key: null };
  const candidates = reproductions.filter((r) => alias.match.test(r.name));
  if (candidates.length === 1) return { status: "matched", value: candidates[0], alias_key: alias.key, match_type: "alias" };
  if (candidates.length > 1) return { status: "ambiguous", candidates, alias_key: alias.key, reason: "alias_multiple" };
  return { status: "unmatched", value: null, alias_key: alias.key };
}

function resolveField(rawField, fields) {
  const token = normalizeFieldToken(rawField);
  const hardName = FIELD_HARD_RULES.get(token);
  if (hardName) {
    const exact = fields.find((f) => normalizeFieldToken(f.name) === normalizeFieldToken(hardName));
    if (exact) return { status: "matched", field: exact, candidates: [exact.name], reason: "hard_rule" };
  }

  if (token.includes("сад")) {
    const baseNum = token.match(/\d+/u)?.[0] || null;
    const gardenNamed = fields.filter((f) => normalizeFieldToken(f.name).includes("сад"));
    const numeric = baseNum
      ? fields.filter((f) => new RegExp(`^${baseNum}(?:-|$)`, "u").test(normalizeFieldToken(f.name)))
      : [];
    const candidates = [...gardenNamed, ...numeric].filter((row, idx, arr) => arr.findIndex((x) => x.id === row.id) === idx);
    if (candidates.length === 1) return { status: "matched", field: candidates[0], candidates: [candidates[0].name], reason: "single_garden_candidate" };
    return { status: candidates.length ? "ambiguous" : "unmatched", field: null, candidates: candidates.map((x) => x.name), reason: "garden_candidates" };
  }

  if (token.includes("плотина")) {
    const candidates = fields.filter((f) => /^49(?:-|$)/u.test(normalizeFieldToken(f.name)));
    if (candidates.length === 1) return { status: "matched", field: candidates[0], candidates: [candidates[0].name], reason: "single_49_candidate" };
    return { status: candidates.length ? "ambiguous" : "unmatched", field: null, candidates: candidates.map((x) => x.name), reason: "plotina_candidates" };
  }

  const baseNum = token.match(/\d+/u)?.[0] || null;
  if (!baseNum) return { status: "unmatched", field: null, candidates: [], reason: "no_numeric_token" };

  const exactNumeric = fields.filter((f) => normalizeFieldToken(f.name) === baseNum);
  if (exactNumeric.length === 1) return { status: "matched", field: exactNumeric[0], candidates: [exactNumeric[0].name], reason: "exact_numeric" };
  if (exactNumeric.length > 1) return { status: "ambiguous", field: null, candidates: exactNumeric.map((x) => x.name), reason: "exact_numeric_multiple" };

  const prefixed = fields.filter((f) => {
    const nm = normalizeFieldToken(f.name);
    return /^\d+(?:-\d+)*$/u.test(nm) && new RegExp(`^${baseNum}(?:-|$)`, "u").test(nm);
  });
  if (prefixed.length === 1) return { status: "matched", field: prefixed[0], candidates: [prefixed[0].name], reason: "single_prefixed_candidate" };
  return { status: prefixed.length ? "ambiguous" : "unmatched", field: null, candidates: prefixed.map((x) => x.name), reason: "prefixed_candidates" };
}

function resolveCropStructureLine({ cropStructure, potatoCropId, fieldId, varietyId, reproductionId, areaHa }) {
  if (!fieldId || !potatoCropId) return { status: "unresolved", line: null, candidates: [] };

  const strict = cropStructure.filter((cs) =>
    cs.field_id === fieldId &&
    String(cs.crop_id || "") === String(potatoCropId) &&
    (varietyId ? String(cs.variety_id || "") === String(varietyId) : true) &&
    (reproductionId ? String(cs.reproduction_id || "") === String(reproductionId) : true)
  );

  if (strict.length === 1) return { status: "matched", line: strict[0], candidates: [strict[0].id] };
  if (strict.length > 1) {
    const sorted = [...strict].sort((a, b) => Math.abs(Number(a.area || 0) - Number(areaHa || 0)) - Math.abs(Number(b.area || 0) - Number(areaHa || 0)));
    return { status: "matched", line: sorted[0], candidates: strict.map((x) => x.id), reason: "strict_closest_area" };
  }

  const fallback = cropStructure.filter((cs) =>
    cs.field_id === fieldId &&
    String(cs.crop_id || "") === String(potatoCropId)
  );
  if (fallback.length === 1) return { status: "matched_fallback_crop_only", line: fallback[0], candidates: [fallback[0].id] };
  if (fallback.length > 1) {
    const sorted = [...fallback].sort((a, b) => Math.abs(Number(a.area || 0) - Number(areaHa || 0)) - Math.abs(Number(b.area || 0) - Number(areaHa || 0)));
    return { status: "matched_fallback_crop_only", line: sorted[0], candidates: fallback.map((x) => x.id), reason: "fallback_closest_area" };
  }
  return { status: "unmatched", line: null, candidates: [] };
}

function resolveOperationLine({ operationLines, fieldId, cropId, varietyId, reproductionId }) {
  if (!fieldId || !cropId || !varietyId || !reproductionId) return { status: "unresolved", line: null, candidates: [] };
  const lines = operationLines.filter((ol) =>
    ol.field_id === fieldId &&
    String(ol.crop_id || "") === String(cropId) &&
    String(ol.variety_id || "") === String(varietyId) &&
    String(ol.reproduction_id || "") === String(reproductionId)
  );
  if (!lines.length) return { status: "unmatched", line: null, candidates: [] };
  const sorted = [...lines].sort((a, b) => new Date(String(b.created_at || 0)).getTime() - new Date(String(a.created_at || 0)).getTime());
  return { status: "matched", line: sorted[0], candidates: lines.map((x) => x.id) };
}

function resolveSeedProduct({ products, variety, reproduction }) {
  if (!variety || !reproduction) return { status: "unresolved", product: null, candidates: [] };
  const varietyNorm = normalizeText(variety.name);
  const reproductionNorm = normalizeText(reproduction.name);

  const candidates = products.filter((p) => {
    const typeNorm = normalizeText(p.type || p.product_type);
    const text = `${normalizeText(p.name)} ${normalizeText(p.trade_name)}`;
    const isSeed = typeNorm.includes("seed") || text.includes("сем");
    return isSeed && text.includes(varietyNorm.split(" ")[0]) && text.includes(reproductionNorm.split(" ")[0]);
  });
  if (candidates.length === 1) return { status: "matched", product: candidates[0], candidates: [candidates[0].name] };
  if (candidates.length > 1) return { status: "ambiguous", product: null, candidates: candidates.map((x) => x.name) };
  return { status: "to_create", product: null, candidates: [] };
}

function resolveFertilizerProduct(products) {
  const candidates = products.filter((p) => {
    const typeNorm = normalizeText(p.type || p.product_type);
    const text = `${normalizeText(p.name)} ${normalizeText(p.trade_name)}`;
    const typeMatch = typeNorm.includes("fert") || text.includes("удобр");
    const nameMatch = text.includes("диаммоф") || text.includes("ammophos") || text.includes("dap");
    return typeMatch && nameMatch;
  });
  if (candidates.length === 1) return { status: "matched", product: candidates[0], candidates: [candidates[0].name] };
  if (candidates.length > 1) return { status: "ambiguous", product: null, candidates: candidates.map((x) => x.name) };
  return { status: "to_create", product: null, candidates: [] };
}

async function main() {
  const args = parseArgs(process.argv);
  const projectRoot = process.cwd();
  loadEnv(projectRoot);

  const execute = String(args.execute || "").toLowerCase() === "yes";
  const companyId = String(args["company-id"] || DEFAULT_COMPANY_ID).trim();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  }
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const [
    seasonRes,
    fieldsRes,
    cropsRes,
    varietiesRes,
    reproductionsRes,
    cropStructureRes,
    operationLinesRes,
    operationsRes,
    productsRes,
    warehousesRes,
    existingInvRes,
    existingFmcRes,
    existingLedgerRes,
    profilesRes,
  ] = await Promise.all([
    supabase.from("seasons").select("id,year").eq("company_id", companyId).eq("year", SEASON_YEAR).limit(1),
    supabase.from("fields").select("id,name,area,archived").eq("company_id", companyId).eq("archived", false),
    supabase.from("crops").select("id,name,archived").eq("archived", false),
    supabase.from("varieties").select("id,name,crop_id,company_id,archived").or(`company_id.is.null,company_id.eq.${companyId}`).eq("archived", false),
    supabase.from("seed_reproductions").select("id,name,company_id,archived").or(`company_id.is.null,company_id.eq.${companyId}`).eq("archived", false),
    supabase.from("crop_structure").select("id,field_id,crop_id,variety_id,reproduction_id,area,season_id,archived").eq("company_id", companyId).eq("archived", false),
    supabase.from("operation_lines").select("id,operation_id,field_id,crop_id,variety_id,reproduction_id,planned_area_ha,actual_area_ha,created_at,company_id").eq("company_id", companyId),
    supabase.from("operations").select("id,field_id,status,date,company_id").eq("company_id", companyId),
    supabase.from("products").select("id,name,trade_name,type,product_type,unit,company_id,archived,is_active").eq("company_id", companyId).eq("archived", false),
    supabase.from("warehouses").select("id,name,warehouse_type,archived,is_archived,company_id,created_at").eq("company_id", companyId),
    supabase.from("inventory_transactions").select("id,notes").eq("company_id", companyId).ilike("notes", `%${SOURCE_DOCUMENT}%`),
    supabase.from("field_material_consumptions").select("id,notes").eq("company_id", companyId).ilike("notes", `%${SOURCE_DOCUMENT}%`),
    supabase.from("stock_ledger_entries").select("id,notes").eq("company_id", companyId).ilike("notes", `%${SOURCE_DOCUMENT}%`),
    supabase.from("profiles").select("id,role,status").eq("company_id", companyId).in("role", ["global_admin", "company_admin"]).eq("status", "active").limit(1),
  ]);

  const firstError = [
    seasonRes.error,
    fieldsRes.error,
    cropsRes.error,
    varietiesRes.error,
    reproductionsRes.error,
    cropStructureRes.error,
    operationLinesRes.error,
    operationsRes.error,
    productsRes.error,
    warehousesRes.error,
    existingInvRes.error,
    existingFmcRes.error,
    existingLedgerRes.error,
    profilesRes.error,
  ].find(Boolean);
  if (firstError) throw firstError;

  if (!seasonRes.data?.length) {
    throw new Error(`Season ${SEASON_YEAR} not found for company ${companyId}`);
  }

  const seasonId = seasonRes.data[0].id;
  const fields = fieldsRes.data || [];
  const crops = cropsRes.data || [];
  const varieties = varietiesRes.data || [];
  const reproductions = reproductionsRes.data || [];
  const cropStructure = (cropStructureRes.data || []).filter((row) => String(row.season_id || "") === String(seasonId));
  const operationLines = operationLinesRes.data || [];
  const operations = operationsRes.data || [];
  const products = productsRes.data || [];
  const warehouses = warehousesRes.data || [];
  const actorProfile = (profilesRes.data || [])[0] || null;

  const potatoCropCandidates = crops.filter((row) => /(картоф|potato)/iu.test(String(row.name || "")));
  const potatoCropId = potatoCropCandidates[0]?.id || null;

  const seedWarehouseResolve = pickWarehouseByType(warehouses, "seed");
  const fertilizerWarehouseResolve = pickWarehouseByType(warehouses, "fertilizer");
  const seedWarehouse = seedWarehouseResolve.warehouse;
  const fertilizerWarehouse = fertilizerWarehouseResolve.warehouse;

  const fertilizerProduct = resolveFertilizerProduct(products);

  const existingKeys = new Set();
  const parseExistingKeys = (rows) => {
    for (const row of rows || []) {
      const notes = String(row.notes || "");
      const matched = notes.match(/idempotency_key=([a-f0-9]+)/iu);
      if (matched?.[1]) existingKeys.add(matched[1].toLowerCase());
    }
  };
  parseExistingKeys(existingInvRes.data);
  parseExistingKeys(existingFmcRes.data);
  parseExistingKeys(existingLedgerRes.data);

  const previewRows = [];
  const unresolvedRows = [];
  const varietiesToCreate = new Map();
  const duplicateLineSkips = [];
  const materialLinesToCreate = [];

  let fieldsMatched = 0;
  let fieldsUnmatched = 0;
  let varietiesMatched = 0;
  let reproductionsMatched = 0;
  let cropStructureLinesMatched = 0;

  for (let i = 0; i < JOURNAL_ROWS.length; i += 1) {
    const raw = JOURNAL_ROWS[i];
    const rowNo = i + 1;
    const seedsKg = numericOrNull(raw.seedsKg);
    const areaHa = numericOrNull(raw.areaHa);
    const seedsRate = numericOrNull(raw.seedsRate);
    const fertilizerKg = numericOrNull(raw.fertilizerKg);
    const fertilizerRate = numericOrNull(raw.fertilizerRate);

    const varietyMatch = resolveVariety(raw.variety, varieties, potatoCropId);
    if (varietyMatch.status === "matched") varietiesMatched += 1;
    if (varietyMatch.status === "to_create") {
      const key = normalizeText(raw.variety);
      if (!varietiesToCreate.has(key)) {
        varietiesToCreate.set(key, {
          raw_variety: raw.variety,
          alias_key: varietyMatch.alias_key || null,
          suggested_name: raw.variety.trim(),
        });
      }
    }

    const reproductionMatch = resolveReproduction(raw.reproduction, reproductions);
    if (reproductionMatch.status === "matched") reproductionsMatched += 1;

    const fieldResolve = resolveField(raw.field, fields);
    if (fieldResolve.status === "matched") fieldsMatched += 1;
    else fieldsUnmatched += 1;

    const cropStructureLine = resolveCropStructureLine({
      cropStructure,
      potatoCropId,
      fieldId: fieldResolve.field?.id || null,
      varietyId: varietyMatch.value?.id || null,
      reproductionId: reproductionMatch.value?.id || null,
      areaHa,
    });
    if (cropStructureLine.status === "matched" || cropStructureLine.status === "matched_fallback_crop_only") cropStructureLinesMatched += 1;

    const opLineResolve = resolveOperationLine({
      operationLines,
      fieldId: fieldResolve.field?.id || null,
      cropId: potatoCropId,
      varietyId: varietyMatch.value?.id || null,
      reproductionId: reproductionMatch.value?.id || null,
    });
    const opId = opLineResolve.line
      ? opLineResolve.line.operation_id
      : operations.find((op) => op.field_id === fieldResolve.field?.id && /planned|in_progress|completed|active/iu.test(String(op.status || "")))?.id || null;

    const seedProductMatch = resolveSeedProduct({
      products,
      variety: varietyMatch.value || null,
      reproduction: reproductionMatch.value || null,
    });

    const rowErrors = [];
    const lineActions = [];

    if (!potatoCropId) rowErrors.push("potato_crop_not_found");
    if (!fieldResolve.field) rowErrors.push(`field_${fieldResolve.status}`);
    if (varietyMatch.status === "ambiguous") rowErrors.push("variety_ambiguous");
    if (reproductionMatch.status !== "matched") rowErrors.push("reproduction_unmatched");
    if (!areaHa || areaHa <= 0) rowErrors.push("invalid_area");
    if (!seedsKg || seedsKg <= 0) rowErrors.push("invalid_seed_qty");
    if (!seedWarehouse?.id) rowErrors.push("seed_warehouse_unresolved");
    if (seedProductMatch.status === "ambiguous") rowErrors.push("seed_product_ambiguous");

    lineActions.push({
      kind: PRODUCT_TYPES.SEED,
      quantityKg: seedsKg,
      rateKgHa: seedsRate,
      productStatus: seedProductMatch.status,
      productId: seedProductMatch.product?.id || null,
      productName: seedProductMatch.product?.name || null,
      productCandidates: seedProductMatch.candidates || [],
      warehouseId: seedWarehouse?.id || null,
      warehouseName: seedWarehouse?.name || null,
      canImport: Boolean(
        potatoCropId &&
        fieldResolve.field?.id &&
        varietyMatch.status !== "ambiguous" &&
        reproductionMatch.status === "matched" &&
        areaHa &&
        seedsKg &&
        seedWarehouse?.id &&
        seedProductMatch.status !== "ambiguous"
      ),
    });

    if (fertilizerKg && fertilizerKg > 0) {
      if (!fertilizerWarehouse?.id) rowErrors.push("fertilizer_warehouse_unresolved");
      if (fertilizerProduct.status === "ambiguous") rowErrors.push("fertilizer_product_ambiguous");
      lineActions.push({
        kind: PRODUCT_TYPES.FERTILIZER,
        quantityKg: fertilizerKg,
        rateKgHa: fertilizerRate,
        productStatus: fertilizerProduct.status,
        productId: fertilizerProduct.product?.id || null,
        productName: fertilizerProduct.product?.name || "Диаммофоска",
        productCandidates: fertilizerProduct.candidates || [],
        warehouseId: fertilizerWarehouse?.id || null,
        warehouseName: fertilizerWarehouse?.name || null,
        canImport: Boolean(
          potatoCropId &&
          fieldResolve.field?.id &&
          varietyMatch.status !== "ambiguous" &&
          reproductionMatch.status === "matched" &&
          areaHa &&
          fertilizerWarehouse?.id &&
          fertilizerProduct.status !== "ambiguous"
        ),
      });
    }

    for (const action of lineActions) {
      if (!action.canImport) continue;
      const idempotencyKey = makeIdempotencyKey({
        seasonYear: SEASON_YEAR,
        fieldId: fieldResolve.field?.id || "",
        varietyId: varietyMatch.value?.id || null,
        reproductionId: reproductionMatch.value?.id || null,
        rawVariety: normalizeText(raw.variety),
        rawReproduction: normalizeText(raw.reproduction),
        productKind: action.kind,
        quantityKg: action.quantityKg,
      });

      if (existingKeys.has(idempotencyKey)) {
        duplicateLineSkips.push({
          row_no: rowNo,
          material_kind: action.kind,
          idempotency_key: idempotencyKey,
        });
        continue;
      }

      materialLinesToCreate.push({
        row_no: rowNo,
        field_id: fieldResolve.field?.id || null,
        field_name: fieldResolve.field?.name || null,
        crop_id: potatoCropId,
        variety_id: varietyMatch.value?.id || null,
        reproduction_id: reproductionMatch.value?.id || null,
        crop_structure_row_id: cropStructureLine.line?.id || null,
        operation_line_id: opLineResolve.line?.id || null,
        operation_id: opId || null,
        area_ha: areaHa,
        material_kind: action.kind,
        product_id: action.productId,
        product_status: action.productStatus,
        product_name: action.productName,
        warehouse_id: action.warehouseId,
        warehouse_name: action.warehouseName,
        quantity_kg: action.quantityKg,
        rate_kg_per_ha: action.rateKgHa,
        source_type: SOURCE_TYPE,
        source_document: SOURCE_DOCUMENT,
        idempotency_key: idempotencyKey,
        raw_values: {
          field: raw.field,
          variety: raw.variety,
          reproduction: raw.reproduction,
        },
      });
    }

    const rowReady = lineActions.some((x) => x.canImport) && rowErrors.length === 0;
    const preview = formatPreviewRow(
      {
        rowNo,
        raw,
        areaHa,
        seedsKg,
        seedsRate,
        fertilizerKg,
        fertilizerRate,
      },
      {
        field_match_status: fieldResolve.status,
        field_match: fieldResolve.field?.name || null,
        field_candidates: fieldResolve.candidates || [],
        field_reason: fieldResolve.reason || null,
        variety_match_status: varietyMatch.status,
        variety_match: varietyMatch.value?.name || null,
        variety_candidates: (varietyMatch.candidates || []).map((x) => x.name),
        reproduction_match_status: reproductionMatch.status,
        reproduction_match: reproductionMatch.value?.name || null,
        crop_structure_line_status: cropStructureLine.status,
        crop_structure_line_id: cropStructureLine.line?.id || null,
        operation_line_status: opLineResolve.status,
        operation_line_id: opLineResolve.line?.id || null,
        seed_product_status: seedProductMatch.status,
        seed_product_name: seedProductMatch.product?.name || null,
        seed_product_candidates: seedProductMatch.candidates || [],
        fertilizer_product_status: fertilizerProduct.status,
        fertilizer_product_name: fertilizerProduct.product?.name || null,
        fertilizer_product_candidates: fertilizerProduct.candidates || [],
        seed_warehouse_status: seedWarehouseResolve.status,
        seed_warehouse: seedWarehouse?.name || null,
        fertilizer_warehouse_status: fertilizerWarehouseResolve.status,
        fertilizer_warehouse: fertilizerWarehouse?.name || null,
        ready_to_import: rowReady,
        unresolved_reasons: rowReady ? [] : rowErrors,
      }
    );
    previewRows.push(preview);
    if (!rowReady) unresolvedRows.push(preview);
  }

  const summary = {
    rows_total: JOURNAL_ROWS.length,
    rows_ready_to_import: previewRows.filter((x) => x.ready_to_import).length,
    rows_unresolved: unresolvedRows.length,
    fields_matched: fieldsMatched,
    fields_unmatched: fieldsUnmatched,
    varieties_matched: varietiesMatched,
    varieties_to_create: Array.from(varietiesToCreate.values()),
    reproductions_matched: reproductionsMatched,
    crop_structure_lines_matched: cropStructureLinesMatched,
    warehouse_mapping_status: {
      seed_warehouse: seedWarehouse
        ? { status: seedWarehouseResolve.status, id: seedWarehouse.id, name: seedWarehouse.name, candidates: seedWarehouseResolve.candidates || [] }
        : { status: "unresolved", id: null, name: null, candidates: seedWarehouseResolve.candidates || [] },
      fertilizer_warehouse: fertilizerWarehouse
        ? { status: fertilizerWarehouseResolve.status, id: fertilizerWarehouse.id, name: fertilizerWarehouse.name, candidates: fertilizerWarehouseResolve.candidates || [] }
        : { status: "unresolved", id: null, name: null, candidates: fertilizerWarehouseResolve.candidates || [] },
    },
    ledger_movements_to_create: materialLinesToCreate.length,
    duplicate_idempotent_lines_skipped: duplicateLineSkips.length,
    potato_crop_found: Boolean(potatoCropId),
  };

  let executeResult = null;
  if (execute) {
    if (!actorProfile?.id) throw new Error("No active company/global admin profile found for created_by fields");
    const created = {
      material_issues: 0,
      warehouse_movements: 0,
      ledger_movements: 0,
      field_history_rows: 0,
      varieties_created: 0,
      products_created: 0,
      skipped_duplicates: duplicateLineSkips.length,
      unresolved_rows: unresolvedRows.length,
    };
    const mutationWarnings = [];

    const createdVarietyByNorm = new Map();
    for (const v of varieties) createdVarietyByNorm.set(normalizeText(v.name), v.id);
    for (const newVariety of Array.from(varietiesToCreate.values())) {
      const key = normalizeText(newVariety.suggested_name);
      if (createdVarietyByNorm.has(key)) continue;
      const ins = await supabase.from("varieties").insert({
        name: newVariety.suggested_name,
        crop_id: potatoCropId,
        company_id: companyId,
        archived: false,
      }).select("id,name").maybeSingle();
      if (ins.error) {
        mutationWarnings.push({ type: "variety_create_failed", payload: newVariety, error: ins.error.message });
        continue;
      }
      createdVarietyByNorm.set(normalizeText(ins.data?.name || newVariety.suggested_name), ins.data?.id || null);
      created.varieties_created += 1;
    }

    for (const line of materialLinesToCreate) {
      let productId = line.product_id;
      if (!productId && line.product_status === "to_create") {
        const productName = line.material_kind === PRODUCT_TYPES.FERTILIZER
          ? "Диаммофоска"
          : `Семенной картофель ${line.raw_values.variety} ${line.raw_values.reproduction}`;
        const productType = line.material_kind === PRODUCT_TYPES.FERTILIZER ? "fertilizer" : "seed";
        const existing = products.find((p) => normalizeText(p.name) === normalizeText(productName));
        if (existing) {
          productId = existing.id;
        } else {
          const ins = await supabase.from("products").insert({
            company_id: companyId,
            name: productName,
            type: productType,
            unit: "kg",
            archived: false,
            is_active: true,
          }).select("id").maybeSingle();
          if (ins.error) {
            mutationWarnings.push({ type: "product_create_failed", line, error: ins.error.message });
            continue;
          }
          productId = ins.data?.id || null;
          created.products_created += 1;
        }
      }
      if (!productId) {
        mutationWarnings.push({ type: "product_unresolved_after_create", line });
        continue;
      }

      const eventTimestamp = new Date(Date.UTC(SEASON_YEAR, 4, 1, 9, 0, 0, 0) + line.row_no * 60 * 1000).toISOString();
      const notes = [
        `source_type=${SOURCE_TYPE}`,
        `source_document=${SOURCE_DOCUMENT}`,
        `idempotency_key=${line.idempotency_key}`,
        `raw_field=${line.raw_values.field}`,
        `raw_variety=${line.raw_values.variety}`,
        `raw_reproduction=${line.raw_values.reproduction}`,
      ].join("; ");

      const tx = await supabase.from("inventory_transactions").insert({
        company_id: companyId,
        warehouse_id: line.warehouse_id,
        source_warehouse_id: line.warehouse_id,
        destination_warehouse_id: null,
        product_id: productId,
        quantity: line.quantity_kg,
        transaction_type: "out",
        movement_type: "issue",
        status: "confirmed",
        operation_datetime: eventTimestamp,
        date: eventTimestamp.slice(0, 10),
        notes,
        responsible_user_id: actorProfile.id,
        user_id: actorProfile.id,
        confirmed_at: eventTimestamp,
        operation_id: line.operation_id,
        field_id: line.field_id,
        quantity_input: line.quantity_kg,
        input_uom: "kg",
        base_quantity_kg: line.quantity_kg,
      }).select("id").single();
      if (tx.error) {
        mutationWarnings.push({ type: "inventory_transaction_insert_failed", line, error: tx.error.message });
        continue;
      }
      created.warehouse_movements += 1;

      const fmc = await supabase.from("field_material_consumptions").insert({
        company_id: companyId,
        season_id: seasonId,
        field_id: line.field_id,
        crop_structure_row_id: line.crop_structure_row_id,
        operation_id: line.operation_id,
        operation_line_id: line.operation_line_id,
        ticket_id: null,
        ticket_line_id: null,
        warehouse_id: line.warehouse_id,
        operation_type: SOURCE_TYPE,
        material_category: line.material_kind,
        product_id: productId,
        variety_id: line.variety_id,
        reproduction_id: line.reproduction_id,
        batch_id_text: null,
        batch_class: line.material_kind === PRODUCT_TYPES.SEED ? "seed" : "commodity",
        quantity_kg: line.quantity_kg,
        area_ha: line.area_ha,
        norm_per_ha: line.rate_kg_per_ha,
        notes,
        consumed_at: eventTimestamp,
        created_by_user_id: actorProfile.id,
      }).select("id").single();
      if (fmc.error) {
        mutationWarnings.push({ type: "field_material_consumption_insert_failed", line, error: fmc.error.message });
        continue;
      }
      created.material_issues += 1;
      created.field_history_rows += 1;

      const ledger = await supabase.from("stock_ledger_entries").insert({
        company_id: companyId,
        ticket_id: null,
        processing_id: null,
        product_id: productId,
        warehouse_id: line.warehouse_id,
        direction: "out",
        quantity: line.quantity_kg,
        uom: "kg",
        delta_qty_signed: -Math.abs(Number(line.quantity_kg)),
        reason_type: SOURCE_TYPE,
        reason_ref_id: tx.data.id,
        batch_id: null,
        occurred_at: eventTimestamp,
        created_by: actorProfile.id,
        is_storno: false,
        storno_of_entry_id: null,
        notes,
        variety_id: line.variety_id,
        reproduction_id: line.reproduction_id,
        batch_id_text: null,
        batch_class: line.material_kind === PRODUCT_TYPES.SEED ? "seed" : "commodity",
        operation_line_id: line.operation_line_id,
      }).select("id").single();
      if (ledger.error) {
        mutationWarnings.push({ type: "stock_ledger_insert_failed", line, error: ledger.error.message });
        continue;
      }
      created.ledger_movements += 1;
    }

    executeResult = {
      created_material_issues: created.material_issues,
      created_warehouse_movements: created.warehouse_movements,
      created_ledger_movements: created.ledger_movements,
      created_varieties: created.varieties_created,
      created_products: created.products_created,
      created_field_history_rows: created.field_history_rows,
      skipped_duplicates: created.skipped_duplicates,
      unresolved_rows: created.unresolved_rows,
      mutation_warnings: mutationWarnings,
    };
  }

  const output = {
    ok: true,
    mode: execute ? "execute" : "dry-run",
    source_type: SOURCE_TYPE,
    source_document: SOURCE_DOCUMENT,
    company_id: companyId,
    season_year: SEASON_YEAR,
    season_id: seasonId,
    summary,
    preview_table: previewRows,
    unresolved_rows: unresolvedRows,
    material_lines_to_create: materialLinesToCreate,
    duplicate_idempotent_lines_skipped: duplicateLineSkips,
    execute_result: executeResult,
  };

  const outputDir = path.join(projectRoot, "scripts", "output");
  mkdirSync(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  const outputPath = path.join(
    outputDir,
    `potato-field-issue-journal-2026-${execute ? "execute" : "dry-run"}-${stamp}.json`,
  );
  writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf8");
  console.log(JSON.stringify({ ok: true, output_path: outputPath, summary, execute_result: executeResult }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
});

