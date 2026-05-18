#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_COMPANY_ID = "10000000-0000-0000-0000-000000000001";
const DEFAULT_SHEET = "2026";
const DEFAULT_FILE = "C:\\Users\\TRAVKIN\\Downloads\\Структура посева 2026.xlsx";
const NOW = new Date();

const SAFE_RESET_TABLES = [
  { name: "warehouse_issue_request_items", companyScoped: true },
  { name: "warehouse_issue_requests", companyScoped: true },
  { name: "field_material_consumptions", companyScoped: true },
  { name: "ticket_lines", companyScoped: true },
  { name: "ticket_weighings", companyScoped: true },
  { name: "stock_ledger_entries", companyScoped: true },
  { name: "tickets", companyScoped: true },
  { name: "operations", companyScoped: true },
  { name: "batch_transformation_outputs", companyScoped: true },
  { name: "batch_transformation_inputs", companyScoped: true },
  { name: "batch_transformations", companyScoped: true },
  { name: "processing_documents", companyScoped: true },
  { name: "inventory_transactions", companyScoped: true },
  { name: "inventory_batches", companyScoped: true },
  { name: "fuel_issues", companyScoped: true },
  { name: "fuel_transfers", companyScoped: true },
  { name: "crop_structure", companyScoped: true },
  { name: "field_history_entries", companyScoped: true },
  { name: "field_season_flags", companyScoped: true },
  { name: "field_cadastre_links", companyScoped: true },
  { name: "fields", companyScoped: true },
];

const REQUIRED_IMPORT_TABLES = [
  "field_season_flags",
  "import_batches",
  "import_batch_rows",
  "field_history_entries",
];

const REQUIRED_SEASON_YEARS = [2021, 2022, 2023, 2024, 2025, 2026];

const CROP_COLUMN_MAP = [
  { key: "wheat", header: "пшеница", cropName: "Пшеница", isFallow: false },
  { key: "barley", header: "ячмень", cropName: "Ячмень", isFallow: false },
  { key: "oats", header: "овес", cropName: "Овёс", isFallow: false },
  { key: "peas", header: "горох", cropName: "Горох", isFallow: false },
  { key: "potato", header: "картофель", cropName: "Картофель", isFallow: false },
  { key: "carrot", header: "морковь", cropName: "Морковь", isFallow: false },
  { key: "rapeseed", header: "рапс", cropName: "Рапс", isFallow: false },
  { key: "sunflower", header: "подсолн", cropName: "Подсолнечник", isFallow: false },
  { key: "flax", header: "лен", cropName: "Лён (масличный)", isFallow: false },
  { key: "corn", header: "кукуруза", cropName: "Кукуруза", isFallow: false },
  { key: "grass_mix", header: "з\\смесь", cropName: "Травосмеси", isFallow: false },
  { key: "sudan_grass", header: "суданка", cropName: "Суданская трава", isFallow: false },
  { key: "perennial_grass", header: "мн.травы", cropName: "Многолетние травы", isFallow: false },
  { key: "legume_grass", header: "бобов тр", cropName: "Бобовые травы", isFallow: false },
  { key: "fallow", header: "пары", cropName: "Пар", isFallow: true },
];

const HISTORY_TOKEN_ALIASES = {
  пшеница: "Пшеница",
  пшен: "Пшеница",
  пш: "Пшеница",
  ячмень: "Ячмень",
  ячм: "Ячмень",
  овес: "Овёс",
  овёс: "Овёс",
  горох: "Горох",
  картофель: "Картофель",
  морковь: "Морковь",
  рапс: "Рапс",
  подсолн: "Подсолнечник",
  подсолнеч: "Подсолнечник",
  подсолнечн: "Подсолнечник",
  подсолнечник: "Подсолнечник",
  подсол: "Подсолнечник",
  лен: "Лён (масличный)",
  лён: "Лён (масличный)",
  кукуруза: "Кукуруза",
  кукуруз: "Кукуруза",
  кукур: "Кукуруза",
  "з\\смесь": "Травосмеси",
  "з/смесь": "Травосмеси",
  смесь: "Травосмеси",
  травосмеси: "Травосмеси",
  "мн.травы": "Многолетние травы",
  "мн травы": "Многолетние травы",
  "мн.трава": "Многолетние травы",
  "многолетние травы": "Многолетние травы",
  травы: "Многолетние травы",
  суданка: "Суданская трава",
  "суданская трава": "Суданская трава",
  "бобов тр": "Бобовые травы",
  "бобовые травы": "Бобовые травы",
  пар: "Пар",
  пары: "Пар",
  полупар: "Пар",
  "п/пар": "Пар",
  люцерна: "Люцерна",
  чечевица: "Чечевица",
  гречиха: "Гречиха",
  житняк: "Житняк",
  овощи: "Овощи",
  аренда: "__RENT_STATUS__",
};

function usage() {
  console.log(`Usage:
  node scripts/import-structure-2026.mjs --mode dry-run
  node scripts/import-structure-2026.mjs --mode execute --confirm-reset true

Options:
  --mode <dry-run|execute>         Required
  --file <path>                    XLSX path (default: ${DEFAULT_FILE})
  --sheet <name>                   Sheet name (default: ${DEFAULT_SHEET})
  --parsed-json <path>             Use pre-parsed XLSX JSON (skip PowerShell spawn)
  --company-id <uuid>              Company id (default: ${DEFAULT_COMPANY_ID})
  --safe-update-fields <true|false> Update existing field area if a same name is found (default: false)
  --confirm-reset <true|false>     Required true for execute mode
`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
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

function parseBool(value, fallback = false) {
  if (value == null) return fallback;
  const v = String(value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "y";
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

function slugifyCrop(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s-]+/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeHeader(value) {
  return normalizeText(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

function parseNumber(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text || text === "#") return null;
  const normalized = text.replace(/\s+/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function stableHash(input) {
  const json = JSON.stringify(input, Object.keys(input).sort());
  return createHash("sha256").update(json).digest("hex");
}

function splitHistoryTokens(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "#") return [];
  const normalized = raw
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/з\\смесь/g, "z_smes")
    .replace(/з\/смесь/g, "z_smes")
    .replace(/п\\пар/g, "p_par");
  const parts = normalized
    .split(/[,+|;/\\]+/g)
    .map((v) => v.trim())
    .filter(Boolean)
    .filter((v) => v !== "#")
    .map((v) => v.replace(/z_smes/g, "з\\смесь").replace(/p_par/g, "п\\пар"));
  return parts;
}

function runSheetParser(projectRoot, filePath, sheetName) {
  const parserPath = path.join(projectRoot, "scripts", "parse-xlsx-sheet.ps1");
  const result = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      parserPath,
      "-FilePath",
      filePath,
      "-SheetName",
      sheetName,
    ],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    if (result.error) {
      throw new Error(
        `XLSX parser spawn error: ${result.error.message}. ` +
          "Use --parsed-json with output of scripts/parse-xlsx-sheet.ps1."
      );
    }
    throw new Error(
      `XLSX parser failed (exit ${result.status}): ${result.stderr || result.stdout}`
    );
  }
  const output = (result.stdout || "").trim();
  if (!output) {
    throw new Error("XLSX parser returned empty output");
  }
  return JSON.parse(output);
}

function getCell(row, headerMap, nameCandidates) {
  const cells = row.cells || {};
  const cellKeys = Object.keys(cells);
  for (const candidate of nameCandidates) {
    const expected = normalizeHeader(candidate);
    for (const key of cellKeys) {
      if (normalizeHeader(key) === expected) {
        return cells[key];
      }
    }
  }
  if (headerMap && headerMap.size) {
    for (const candidate of nameCandidates) {
      const fromMap = headerMap.get(normalizeHeader(candidate));
      if (fromMap && cells[fromMap] != null) return cells[fromMap];
    }
  }
  return "";
}

function buildHeaderMap(headers) {
  const map = new Map();
  for (const h of headers || []) {
    map.set(normalizeHeader(h), h);
  }
  return map;
}

function buildNormalizedRows(parsed) {
  const headers = parsed.headers || [];
  const rows = parsed.rows || [];
  const headerMap = buildHeaderMap(headers);
  const normalized = [];
  const duplicateCounters = new Map();
  const duplicateGroups = new Map();
  let carryForwardField = "";

  for (const row of rows) {
    const rawField = String(getCell(row, headerMap, ["# - Поля", "#-Поля", "Поля"]) || "").trim();
    const area = parseNumber(getCell(row, headerMap, ["S - га", "S-га", "га"]));
    const totalValue = parseNumber(getCell(row, headerMap, ["Итого"]));
    const background = String(getCell(row, headerMap, ["фон"]) || "").trim();
    const rentValue = parseNumber(getCell(row, headerMap, ["аренда"]));
    const zyabValue = parseNumber(getCell(row, headerMap, ["Зябь"]));
    const desiccationRaw = String(
      getCell(row, headerMap, ["десикац", "десикация"]) || ""
    ).trim();

    const rowWarnings = [];
    const rowErrors = [];
    const rowCells = row.cells || {};

    let originalFieldKey = rawField;
    if (!originalFieldKey) {
      if (area != null && carryForwardField) {
        originalFieldKey = carryForwardField;
        rowWarnings.push("Поле не указано, применен carry-forward предыдущего поля.");
      } else {
        normalized.push({
          rowIndex: row.rowIndex,
          skipped: true,
          skipReason: "no_field",
          raw: rowCells,
          warnings: rowWarnings,
          errors: rowErrors,
        });
        continue;
      }
    }

    if (/^(итого|всего)$/i.test(originalFieldKey)) {
      normalized.push({
        rowIndex: row.rowIndex,
        skipped: true,
        skipReason: "summary_row",
        raw: rowCells,
        warnings: rowWarnings,
        errors: rowErrors,
      });
      continue;
    }

    if (area == null || area <= 0) {
      normalized.push({
        rowIndex: row.rowIndex,
        skipped: true,
        skipReason: "no_area",
        raw: rowCells,
        warnings: rowWarnings,
        errors: rowErrors,
      });
      continue;
    }

    carryForwardField = originalFieldKey;
    const normalizedFieldKey = normalizeText(originalFieldKey);
    const nextIndex = (duplicateCounters.get(normalizedFieldKey) || 0) + 1;
    duplicateCounters.set(normalizedFieldKey, nextIndex);
    duplicateGroups.set(normalizedFieldKey, (duplicateGroups.get(normalizedFieldKey) || 0) + 1);
    const resolvedFieldName = `${originalFieldKey}-${nextIndex}`;

    const sourceRowHash = stableHash({
      rowIndex: row.rowIndex,
      originalFieldKey,
      area,
      totalValue,
      raw: rowCells,
    });

    const allocations2026 = [];
    for (const spec of CROP_COLUMN_MAP) {
      const value = parseNumber(getCell(row, headerMap, [spec.header]));
      if (value != null && value > 0) {
        allocations2026.push({
          cropKey: spec.key,
          cropName: spec.cropName,
          areaHa: value,
          sourceColumn: spec.header,
          isFallow: spec.isFallow,
          metadata: spec.isFallow ? { allocation_kind: "land_use_fallow" } : null,
        });
      }
    }

    const historyEntries = [];
    for (const year of [2021, 2022, 2023, 2024, 2025]) {
      const rawHistory = String(getCell(row, headerMap, [String(year)]) || "").trim();
      const tokens = splitHistoryTokens(rawHistory);
      if (!tokens.length) continue;
      for (const token of tokens) {
        const canonical = HISTORY_TOKEN_ALIASES[token] || null;
        let parseConfidence = 90;
        if (!canonical) parseConfidence = 25;
        if (canonical === "__RENT_STATUS__") parseConfidence = 80;
        historyEntries.push({
          year,
          token,
          originalRawValue: rawHistory,
          canonicalCropName: canonical,
          parsedFromMultivalue: tokens.length > 1,
          parseConfidence,
          isUnknown: !canonical,
          isRentStatus: canonical === "__RENT_STATUS__",
        });
      }
      if (tokens.some((t) => !HISTORY_TOKEN_ALIASES[t])) {
        rowWarnings.push(
          `Есть неизвестные history токены (${year}): ${tokens
            .filter((t) => !HISTORY_TOKEN_ALIASES[t])
            .join(", ")}`
        );
      }
    }

    const flags = [];
    if (background && background !== "#") {
      flags.push({
        key: "background_note",
        valueText: background,
        valueNumeric: null,
        rawValue: background,
      });
    }
    if (rentValue != null && rentValue > 0) {
      flags.push({
        key: "rent_area_ha",
        valueText: null,
        valueNumeric: rentValue,
        rawValue: String(getCell(row, headerMap, ["аренда"]) || ""),
      });
    }
    if (zyabValue != null && zyabValue > 0) {
      flags.push({
        key: "zyab_area_ha",
        valueText: null,
        valueNumeric: zyabValue,
        rawValue: String(getCell(row, headerMap, ["Зябь"]) || ""),
      });
    }
    if (desiccationRaw && desiccationRaw !== "#") {
      rowWarnings.push(
        "Колонка десикация обнаружена и пропущена по правилу импорта."
      );
    }

    const allocationSum = allocations2026.reduce((sum, a) => sum + a.areaHa, 0);
    if (totalValue != null && Math.abs(allocationSum - totalValue) > 0.01) {
      rowWarnings.push(
        `Сумма аллокаций (${allocationSum}) не совпадает с Итого (${totalValue}).`
      );
    }
    if (allocationSum > area + 0.01) {
      rowErrors.push(
        `Сумма аллокаций (${allocationSum}) превышает площадь поля S-га (${area}).`
      );
    } else if (allocationSum < area - 0.01) {
      rowWarnings.push(
        `Есть нераспределенная площадь: S-га (${area}) vs аллокации (${allocationSum}).`
      );
    }

    normalized.push({
      rowIndex: row.rowIndex,
      skipped: false,
      originalFieldKey,
      resolvedFieldName,
      sourceRowHash,
      areaHa: area,
      totalHa: totalValue,
      allocations2026,
      historyEntries,
      flags,
      raw: rowCells,
      warnings: rowWarnings,
      errors: rowErrors,
    });
  }

  return { rows: normalized, duplicateGroups };
}

function buildDryRunReport({ companyId, filePath, sheetName, normalizedRows }) {
  const rows = normalizedRows.rows;
  const usedRows = rows.filter((r) => !r.skipped);
  const skippedRows = rows.filter((r) => r.skipped);
  const warningRows = usedRows.filter((r) => r.warnings.length > 0);
  const errorRows = usedRows.filter((r) => r.errors.length > 0);
  const allocations = usedRows.flatMap((r) => r.allocations2026);
  const history = usedRows.flatMap((r) => r.historyEntries);
  const unknownHistory = history.filter((h) => h.isUnknown);
  const totalByCrop = {};
  for (const a of allocations) {
    totalByCrop[a.cropName] = (totalByCrop[a.cropName] || 0) + a.areaHa;
  }

  const duplicateFieldGroups = [...normalizedRows.duplicateGroups.entries()].filter(
    ([, count]) => count > 1
  );
  const duplicateFieldRows = duplicateFieldGroups.reduce((sum, [, count]) => sum + count, 0);
  const skippedByReason = skippedRows.reduce((acc, row) => {
    acc[row.skipReason] = (acc[row.skipReason] || 0) + 1;
    return acc;
  }, {});
  const underAllocationCount = usedRows.filter((r) => {
    const sum = r.allocations2026.reduce((acc, item) => acc + item.areaHa, 0);
    return sum < r.areaHa - 0.01;
  }).length;
  const overAllocationCount = usedRows.filter((r) => {
    const sum = r.allocations2026.reduce((acc, item) => acc + item.areaHa, 0);
    return sum > r.areaHa + 0.01;
  }).length;
  const mismatchTotalCount = usedRows.filter((r) => {
    if (r.totalHa == null) return false;
    const sum = r.allocations2026.reduce((acc, item) => acc + item.areaHa, 0);
    return Math.abs(sum - r.totalHa) > 0.01;
  }).length;

  return {
    generatedAt: new Date().toISOString(),
    companyId,
    source: {
      filePath,
      fileName: path.basename(filePath),
      sheetName,
    },
    summary: {
      rows_total: rows.length,
      rows_used: usedRows.length,
      fields_to_create: usedRows.length,
      duplicate_field_groups: duplicateFieldGroups.length,
      duplicate_field_rows: duplicateFieldRows,
      crop_allocations_2026: allocations.length,
      history_records_2021_2025_split: history.length,
      history_unknown_tokens: unknownHistory.length,
      warning_rows: warningRows.length,
      error_rows: errorRows.length,
      skipped_rows: skippedRows.length,
      skipped_by_reason: skippedByReason,
      validation_mismatch_total_vs_alloc: mismatchTotalCount,
      validation_under_area: underAllocationCount,
      validation_over_area: overAllocationCount,
      flags: {
        zyab_rows: usedRows.filter((r) => r.flags.some((f) => f.key === "zyab_area_ha")).length,
        rent_rows: usedRows.filter((r) => r.flags.some((f) => f.key === "rent_area_ha")).length,
        background_rows: usedRows.filter((r) =>
          r.flags.some((f) => f.key === "background_note")
        ).length,
      },
      desiccation_rule:
        "Колонка/значение десикация пропускается полностью (не сохраняется в crop/history/flags).",
    },
    crop_totals_2026: Object.entries(totalByCrop)
      .sort((a, b) => b[1] - a[1])
      .map(([cropName, areaHa]) => ({
        cropName,
        areaHa: Number(areaHa.toFixed(3)),
      })),
    unknown_history_tokens: unknownHistory.slice(0, 200),
  };
}

function chunk(array, size = 100) {
  const out = [];
  for (let i = 0; i < array.length; i += size) {
    out.push(array.slice(i, i + size));
  }
  return out;
}

async function tableExists(supabase, tableName) {
  const { error } = await supabase.from(tableName).select("id").limit(1);
  return !error;
}

async function getCurrentCounts(supabase, companyId) {
  const companyTables = [
    "fields",
    "seasons",
    "crop_structure",
    "operations",
    "tickets",
    "ticket_lines",
    "stock_ledger_entries",
    "inventory_batches",
    "field_material_consumptions",
    "warehouse_issue_requests",
    "warehouse_issue_request_items",
    "weighbridge_shifts",
    "fuel_issues",
    "fuel_transfers",
    "fuel_limits",
    "counterparties",
    "field_history_entries",
    "field_season_flags",
  ];
  const counts = {};
  for (const table of companyTables) {
    const exists = await tableExists(supabase, table);
    if (!exists) {
      counts[table] = null;
      continue;
    }
    const { count, error } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId);
    counts[table] = error ? null : count || 0;
  }

  const { data: companyFields } = await supabase
    .from("fields")
    .select("id")
    .eq("company_id", companyId);
  const fieldIds = (companyFields || []).map((r) => r.id);
  counts.field_history = 0;
  if (fieldIds.length && (await tableExists(supabase, "field_history"))) {
    let total = 0;
    for (const batchIds of chunk(fieldIds, 200)) {
      const { count } = await supabase
        .from("field_history")
        .select("id", { count: "exact", head: true })
        .in("field_id", batchIds);
      total += count || 0;
    }
    counts.field_history = total;
  }

  return counts;
}

async function resolveActorUserId(supabase, companyId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, role, status, is_owner")
    .eq("company_id", companyId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw error;
  const rows = data || [];
  if (!rows.length) {
    throw new Error(`No active profiles found for company ${companyId}.`);
  }
  const preferred =
    rows.find((r) => r.role === "global_admin") ||
    rows.find((r) => r.role === "company_admin") ||
    rows.find((r) => r.is_owner) ||
    rows[0];
  return preferred.id;
}

async function ensureSeasons(supabase, companyId, actorUserId) {
  const { data, error } = await supabase
    .from("seasons")
    .select("id, year")
    .eq("company_id", companyId)
    .in("year", REQUIRED_SEASON_YEARS);
  if (error) throw error;
  const seasonMap = new Map((data || []).map((s) => [Number(s.year), s.id]));
  const missing = REQUIRED_SEASON_YEARS.filter((year) => !seasonMap.has(year));
  for (const year of missing) {
    const payload = {
      company_id: companyId,
      user_id: actorUserId,
      year,
      name: `Сезон ${year}`,
      start_date: `${year}-01-01`,
      end_date: `${year}-12-31`,
      archived: false,
    };
    const { data: created, error: createError } = await supabase
      .from("seasons")
      .insert(payload)
      .select("id, year")
      .single();
    if (createError) throw createError;
    seasonMap.set(Number(created.year), created.id);
  }
  return seasonMap;
}

function buildCropCanonicalList() {
  return [...new Set(CROP_COLUMN_MAP.map((c) => c.cropName).concat(Object.values(HISTORY_TOKEN_ALIASES).filter((v) => v && v !== "__RENT_STATUS__")))];
}

async function ensureCrops(supabase, companyId, actorUserId) {
  const canonical = buildCropCanonicalList();
  const { data, error } = await supabase
    .from("crops")
    .select("id, name, name_ru, archived, is_active");
  if (error) throw error;

  const byName = new Map();
  for (const row of data || []) {
    const name = row.name_ru || row.name;
    if (!name) continue;
    byName.set(normalizeText(name), row);
  }

  const created = [];

  for (const cropName of canonical) {
    const key = normalizeText(cropName);
    if (byName.has(key)) continue;
    const baseSlug = slugifyCrop(cropName);
    const slug = baseSlug || `crop-${createHash("md5").update(cropName).digest("hex").slice(0, 10)}`;
    const payload = {
      name: cropName,
      name_ru: cropName,
      name_en: cropName,
      is_active: true,
      archived: false,
      slug,
      company_id: companyId,
      user_id: actorUserId,
      crop_kind: "general",
      default_uom: "kg",
      harvest_uom: "kg",
      seed_uom: "kg",
      priority_level: "low",
      can_have_varieties: true,
      can_have_seed_reproduction: true,
      can_be_harvested: true,
    };
    const { data: inserted, error: insertError } = await supabase
      .from("crops")
      .insert(payload)
      .select("id, name, name_ru")
      .single();
    if (insertError) throw insertError;
    byName.set(key, inserted);
    created.push(cropName);
  }

  const cropIdByName = new Map();
  for (const [k, row] of byName.entries()) {
    cropIdByName.set(k, row.id);
  }

  return { cropIdByName, created };
}

function mapHistoryTokenToCropName(token) {
  const normalized = normalizeText(token);
  if (!normalized) return null;
  const direct = HISTORY_TOKEN_ALIASES[normalized];
  if (direct) return direct;
  return null;
}

function toDateStamp(dt = NOW) {
  return dt.toISOString().replace(/[:.]/g, "-");
}

async function upsertImportBatch(supabase, payload) {
  const exists = await tableExists(supabase, "import_batches");
  if (!exists) return null;
  const { data, error } = await supabase
    .from("import_batches")
    .insert(payload)
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function insertImportBatchRows(supabase, importBatchId, companyId, normalizedRows) {
  if (!importBatchId) return;
  const exists = await tableExists(supabase, "import_batch_rows");
  if (!exists) return;

  const rowsToInsert = normalizedRows
    .filter((r) => !r.skipped)
    .map((r) => ({
      import_batch_id: importBatchId,
      company_id: companyId,
      row_index: r.rowIndex,
      original_field_key: r.originalFieldKey,
      resolved_field_name: r.resolvedFieldName,
      source_row_hash: r.sourceRowHash,
      row_payload: r.raw,
      normalized_payload: {
        area_ha: r.areaHa,
        total_ha: r.totalHa,
        allocations_2026: r.allocations2026,
        history_entries: r.historyEntries,
        flags: r.flags,
      },
      warnings: r.warnings,
      errors: r.errors,
      status: r.errors.length ? "error" : r.warnings.length ? "warning" : "parsed",
    }));

  for (const batch of chunk(rowsToInsert, 200)) {
    const { error } = await supabase.from("import_batch_rows").insert(batch);
    if (error) throw error;
  }
}

async function collectBackupSnapshot(supabase, companyId, snapshotPath) {
  const snapshot = {
    company_id: companyId,
    generated_at: new Date().toISOString(),
    tables: {},
  };

  const { data: companyFields } = await supabase
    .from("fields")
    .select("id, name, area, company_id")
    .eq("company_id", companyId);
  const fieldIds = (companyFields || []).map((f) => f.id);

  for (const table of SAFE_RESET_TABLES) {
    const exists = await tableExists(supabase, table.name);
    if (!exists) {
      snapshot.tables[table.name] = { exists: false, rows: [] };
      continue;
    }
    let rows = [];
    if (table.companyScoped) {
      const { data } = await supabase
        .from(table.name)
        .select("*")
        .eq("company_id", companyId);
      rows = data || [];
    } else {
      rows = [];
    }
    snapshot.tables[table.name] = { exists: true, count: rows.length, rows };
  }

  if (await tableExists(supabase, "field_history")) {
    let historyRows = [];
    for (const ids of chunk(fieldIds, 200)) {
      const { data } = await supabase
        .from("field_history")
        .select("*")
        .in("field_id", ids);
      historyRows = historyRows.concat(data || []);
    }
    snapshot.tables.field_history = {
      exists: true,
      count: historyRows.length,
      rows: historyRows,
    };
  }

  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), "utf8");
  return snapshot;
}

async function deleteByCompany(supabase, tableName, companyId) {
  const exists = await tableExists(supabase, tableName);
  if (!exists) return 0;
  const { data: beforeRows, error: beforeError } = await supabase
    .from(tableName)
    .select("id")
    .eq("company_id", companyId);
  if (beforeError) throw beforeError;
  const beforeCount = (beforeRows || []).length;
  if (!beforeCount) return 0;
  const { error } = await supabase.from(tableName).delete().eq("company_id", companyId);
  if (error) throw error;
  return beforeCount;
}

async function deleteFieldHistoryByFieldIds(supabase, fieldIds) {
  if (!fieldIds.length) return 0;
  if (!(await tableExists(supabase, "field_history"))) return 0;
  let total = 0;
  for (const ids of chunk(fieldIds, 200)) {
    const { data: beforeRows, error: countError } = await supabase
      .from("field_history")
      .select("id")
      .in("field_id", ids);
    if (countError) throw countError;
    const count = (beforeRows || []).length;
    if (!count) continue;
    const { error } = await supabase.from("field_history").delete().in("field_id", ids);
    if (error) throw error;
    total += count;
  }
  return total;
}

async function executeReset(supabase, companyId) {
  const deleted = {};
  const { data: fieldsData, error: fieldsError } = await supabase
    .from("fields")
    .select("id")
    .eq("company_id", companyId);
  if (fieldsError) throw fieldsError;
  const oldFieldIds = (fieldsData || []).map((f) => f.id);

  if (await tableExists(supabase, "tickets")) {
    const { error: unlinkTicketsBatchError } = await supabase
      .from("tickets")
      .update({ batch_id: null })
      .eq("company_id", companyId)
      .not("batch_id", "is", null);
    if (unlinkTicketsBatchError) throw unlinkTicketsBatchError;
  }

  if (await tableExists(supabase, "inventory_batches")) {
    const { error: unlinkBatchSourceTicketError } = await supabase
      .from("inventory_batches")
      .update({ source_ticket_id: null })
      .eq("company_id", companyId)
      .not("source_ticket_id", "is", null);
    if (unlinkBatchSourceTicketError) throw unlinkBatchSourceTicketError;
  }

  deleted.warehouse_issue_request_items = await deleteByCompany(
    supabase,
    "warehouse_issue_request_items",
    companyId
  );
  deleted.warehouse_issue_requests = await deleteByCompany(
    supabase,
    "warehouse_issue_requests",
    companyId
  );
  deleted.field_material_consumptions = await deleteByCompany(
    supabase,
    "field_material_consumptions",
    companyId
  );
  deleted.ticket_lines = await deleteByCompany(supabase, "ticket_lines", companyId);
  deleted.ticket_weighings = await deleteByCompany(supabase, "ticket_weighings", companyId);
  deleted.stock_ledger_entries = await deleteByCompany(
    supabase,
    "stock_ledger_entries",
    companyId
  );
  deleted.inventory_transactions = await deleteByCompany(
    supabase,
    "inventory_transactions",
    companyId
  );
  deleted.inventory_batches = await deleteByCompany(supabase, "inventory_batches", companyId);
  deleted.tickets = await deleteByCompany(supabase, "tickets", companyId);
  deleted.operations = await deleteByCompany(supabase, "operations", companyId);
  deleted.batch_transformation_outputs = await deleteByCompany(
    supabase,
    "batch_transformation_outputs",
    companyId
  );
  deleted.batch_transformation_inputs = await deleteByCompany(
    supabase,
    "batch_transformation_inputs",
    companyId
  );
  deleted.batch_transformations = await deleteByCompany(
    supabase,
    "batch_transformations",
    companyId
  );
  deleted.processing_documents = await deleteByCompany(
    supabase,
    "processing_documents",
    companyId
  );
  deleted.fuel_issues = await deleteByCompany(supabase, "fuel_issues", companyId);
  deleted.fuel_transfers = await deleteByCompany(supabase, "fuel_transfers", companyId);
  deleted.crop_structure = await deleteByCompany(supabase, "crop_structure", companyId);
  deleted.field_history_entries = await deleteByCompany(
    supabase,
    "field_history_entries",
    companyId
  );
  deleted.field_season_flags = await deleteByCompany(
    supabase,
    "field_season_flags",
    companyId
  );
  deleted.field_history = await deleteFieldHistoryByFieldIds(supabase, oldFieldIds);
  deleted.field_cadastre_links = await deleteByCompany(
    supabase,
    "field_cadastre_links",
    companyId
  );
  deleted.fields = await deleteByCompany(supabase, "fields", companyId);

  return deleted;
}

async function insertFields(supabase, companyId, actorUserId, rows, safeUpdateFields) {
  const createdFields = [];
  const updatedFields = [];
  const fieldIdByRowHash = new Map();

  for (const row of rows) {
    if (row.skipped) continue;
    const existingField = await supabase
      .from("fields")
      .select("id, name, area")
      .eq("company_id", companyId)
      .eq("name", row.resolvedFieldName)
      .maybeSingle();
    if (existingField.error) throw existingField.error;
    if (existingField.data) {
      if (safeUpdateFields && Number(existingField.data.area) !== Number(row.areaHa)) {
        const { error: updateError } = await supabase
          .from("fields")
          .update({
            area: row.areaHa,
            notes: JSON.stringify({
              source: "import_2026_structure",
              original_field_key: row.originalFieldKey,
              import_row_index: row.rowIndex,
              source_row_hash: row.sourceRowHash,
            }),
          })
          .eq("id", existingField.data.id);
        if (updateError) throw updateError;
        updatedFields.push(existingField.data.id);
      }
      fieldIdByRowHash.set(row.sourceRowHash, existingField.data.id);
      continue;
    }

    const payload = {
      company_id: companyId,
      user_id: actorUserId,
      name: row.resolvedFieldName,
      area: row.areaHa,
      soil_type: null,
      notes: JSON.stringify({
        source: "import_2026_structure",
        original_field_key: row.originalFieldKey,
        import_row_index: row.rowIndex,
        source_row_hash: row.sourceRowHash,
      }),
      archived: false,
    };
    const { data: inserted, error: insertError } = await supabase
      .from("fields")
      .insert(payload)
      .select("id")
      .single();
    if (insertError) throw insertError;
    createdFields.push(inserted.id);
    fieldIdByRowHash.set(row.sourceRowHash, inserted.id);
  }

  return { createdFields, updatedFields, fieldIdByRowHash };
}

async function insertHistoryEntries({
  supabase,
  companyId,
  seasonByYear,
  fieldIdByRowHash,
  cropIdByName,
  rows,
  importBatchId,
}) {
  const inserts = [];
  for (const row of rows) {
    if (row.skipped) continue;
    const fieldId = fieldIdByRowHash.get(row.sourceRowHash);
    if (!fieldId) continue;
    for (const h of row.historyEntries) {
      const cropName = h.canonicalCropName;
      const isRentStatus = h.isRentStatus;
      if (isRentStatus) continue;
      const cropId = cropName ? cropIdByName.get(normalizeText(cropName)) || null : null;
      inserts.push({
        company_id: companyId,
        field_id: fieldId,
        season_id: seasonByYear.get(h.year),
        season_year: h.year,
        crop_id: cropId,
        history_value: cropName || h.token,
        token: h.token,
        original_raw_value: h.originalRawValue,
        parsed_from_multivalue: h.parsedFromMultivalue,
        parse_confidence: h.parseConfidence,
        source: "import_2026_structure",
        import_batch_id: importBatchId,
        import_row_index: row.rowIndex,
        source_row_hash: row.sourceRowHash,
        notes: h.isUnknown ? "unmapped_history_token" : null,
      });
    }
  }

  for (const batch of chunk(inserts, 200)) {
    const { error } = await supabase.from("field_history_entries").insert(batch);
    if (error) throw error;
  }
  return inserts.length;
}

async function insertAllocations2026({
  supabase,
  companyId,
  actorUserId,
  seasonByYear,
  fieldIdByRowHash,
  cropIdByName,
  rows,
}) {
  const season2026Id = seasonByYear.get(2026);
  const inserts = [];
  for (const row of rows) {
    if (row.skipped) continue;
    const fieldId = fieldIdByRowHash.get(row.sourceRowHash);
    if (!fieldId) continue;
    for (const allocation of row.allocations2026) {
      const cropId = cropIdByName.get(normalizeText(allocation.cropName));
      if (!cropId) {
        row.errors.push(`Не найден crop_id для "${allocation.cropName}"`);
        continue;
      }
      inserts.push({
        company_id: companyId,
        user_id: actorUserId,
        field_id: fieldId,
        season_id: season2026Id,
        crop_id: cropId,
        variety_id: null,
        reproduction_id: null,
        area: allocation.areaHa,
        status: "planned",
        notes: JSON.stringify({
          source: "import_2026_structure",
          source_column: allocation.sourceColumn,
          original_field_key: row.originalFieldKey,
          import_row_index: row.rowIndex,
          source_row_hash: row.sourceRowHash,
          metadata: allocation.metadata,
        }),
        archived: false,
      });
    }
  }

  for (const batch of chunk(inserts, 200)) {
    const { error } = await supabase.from("crop_structure").insert(batch);
    if (error) throw error;
  }

  return inserts.length;
}

async function insertFieldFlags({
  supabase,
  companyId,
  seasonByYear,
  fieldIdByRowHash,
  rows,
  importBatchId,
}) {
  const season2026Id = seasonByYear.get(2026);
  const inserts = [];
  for (const row of rows) {
    if (row.skipped) continue;
    const fieldId = fieldIdByRowHash.get(row.sourceRowHash);
    if (!fieldId) continue;
    for (const flag of row.flags) {
      inserts.push({
        company_id: companyId,
        field_id: fieldId,
        season_id: season2026Id,
        flag_key: flag.key,
        flag_value_text: flag.valueText,
        flag_value_numeric: flag.valueNumeric,
        source: "import_2026_structure",
        raw_value: flag.rawValue,
        source_row_hash: row.sourceRowHash,
        import_batch_id: importBatchId,
        notes: JSON.stringify({
          original_field_key: row.originalFieldKey,
          import_row_index: row.rowIndex,
        }),
      });
    }
  }
  for (const batch of chunk(inserts, 200)) {
    const { error } = await supabase.from("field_season_flags").insert(batch);
    if (error) throw error;
  }
  return inserts.length;
}

async function updateImportBatchAfterExecute(
  supabase,
  importBatchId,
  executeReport,
  status = "executed"
) {
  if (!importBatchId) return;
  const { error } = await supabase
    .from("import_batches")
    .update({
      status,
      execute_report: executeReport,
      warnings_count: executeReport.warning_rows || 0,
      errors_count: executeReport.error_rows || 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", importBatchId);
  if (error) throw error;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.mode || !["dry-run", "execute"].includes(args.mode)) {
    usage();
    process.exit(1);
  }

  const projectRoot = process.cwd();
  loadEnv(projectRoot);

  const companyId = args["company-id"] || DEFAULT_COMPANY_ID;
  const filePath = args.file || DEFAULT_FILE;
  const sheetName = args.sheet || DEFAULT_SHEET;
  const parsedJsonPath = args["parsed-json"] || null;
  const executeMode = args.mode === "execute";
  const confirmReset =
    parseBool(args["confirm-reset"]) || parseBool(process.env.CONFIRM_COMPANY_DATA_RESET);
  const safeUpdateFields = parseBool(args["safe-update-fields"], false);

  if (executeMode && !confirmReset) {
    throw new Error(
      "Execute mode blocked. Set --confirm-reset true or CONFIRM_COMPANY_DATA_RESET=true."
    );
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env");
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const missingTables = [];
  for (const table of REQUIRED_IMPORT_TABLES) {
    if (!(await tableExists(supabase, table))) missingTables.push(table);
  }
  if (missingTables.length && executeMode) {
    throw new Error(
      `Required tables are missing: ${missingTables.join(
        ", "
      )}. Apply migration 20260514173000_add_structure_import_foundation.sql first.`
    );
  }

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id, name")
    .eq("id", companyId)
    .single();
  if (companyError || !company) {
    throw new Error(`Company not found: ${companyId}`);
  }
  const actorUserId = await resolveActorUserId(supabase, companyId);

  const parsed = parsedJsonPath
    ? JSON.parse(readFileSync(path.resolve(parsedJsonPath), "utf8").replace(/^\uFEFF/, ""))
    : runSheetParser(projectRoot, filePath, sheetName);
  const normalizedRows = buildNormalizedRows(parsed);
  const dryRunReport = buildDryRunReport({
    companyId,
    filePath,
    sheetName,
    normalizedRows,
  });

  const outputDir = path.join(projectRoot, "scripts", "output");
  mkdirSync(outputDir, { recursive: true });
  const stamp = toDateStamp();
  const dryRunPath = path.join(outputDir, `dry-run-structure-2026-${stamp}.json`);
  writeFileSync(dryRunPath, JSON.stringify(dryRunReport, null, 2), "utf8");

  const beforeCounts = await getCurrentCounts(supabase, companyId);

  let importBatchId = null;
  if (!missingTables.length) {
    importBatchId = await upsertImportBatch(supabase, {
      company_id: companyId,
      import_type: "sowing_structure_2026",
      source_file_name: path.basename(filePath),
      source_sheet_name: sheetName,
      source_file_path: filePath,
      status: "dry_run",
      dry_run_report: dryRunReport,
      created_by_user_id: actorUserId,
    });

    await insertImportBatchRows(
      supabase,
      importBatchId,
      companyId,
      normalizedRows.rows
    );
  }

  if (!executeMode) {
    console.log(JSON.stringify({ mode: "dry-run", company: company.name, company_id: companyId, before_counts: beforeCounts, dry_run_report_path: dryRunPath, dry_run_report: dryRunReport, import_batch_id: importBatchId, missing_required_tables: missingTables }, null, 2));
    return;
  }

  const backupDir = path.join(projectRoot, "scripts", "backups");
  mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `backup-before-reset-${companyId}-${stamp}.json`);
  const backupSnapshot = await collectBackupSnapshot(supabase, companyId, backupPath);

  const deletedCounts = await executeReset(supabase, companyId);
  const seasonByYear = await ensureSeasons(supabase, companyId, actorUserId);
  const { cropIdByName, created: createdCrops } = await ensureCrops(
    supabase,
    companyId,
    actorUserId
  );
  const { createdFields, updatedFields, fieldIdByRowHash } = await insertFields(
    supabase,
    companyId,
    actorUserId,
    normalizedRows.rows,
    safeUpdateFields
  );

  const historyCount = await insertHistoryEntries({
    supabase,
    companyId,
    seasonByYear,
    fieldIdByRowHash,
    cropIdByName,
    rows: normalizedRows.rows,
    importBatchId,
  });

  const allocationsCount = await insertAllocations2026({
    supabase,
    companyId,
    actorUserId,
    seasonByYear,
    fieldIdByRowHash,
    cropIdByName,
    rows: normalizedRows.rows,
  });

  const flagsCount = await insertFieldFlags({
    supabase,
    companyId,
    seasonByYear,
    fieldIdByRowHash,
    rows: normalizedRows.rows,
    importBatchId,
  });

  const afterCounts = await getCurrentCounts(supabase, companyId);

  const executeReport = {
    executed_at: new Date().toISOString(),
    company_id: companyId,
    source_file_name: path.basename(filePath),
    source_sheet_name: sheetName,
    backup_snapshot_path: backupPath,
    deleted_counts: deletedCounts,
    created: {
      crops: createdCrops,
      fields_count: createdFields.length,
      fields_updated_count: updatedFields.length,
      history_entries_count: historyCount,
      crop_structure_allocations_count: allocationsCount,
      field_flags_count: flagsCount,
    },
    warning_rows: dryRunReport.summary.warning_rows,
    error_rows: dryRunReport.summary.error_rows,
    before_counts: beforeCounts,
    after_counts: afterCounts,
  };

  await updateImportBatchAfterExecute(supabase, importBatchId, executeReport, "executed");

  const executePath = path.join(outputDir, `execute-report-structure-2026-${stamp}.json`);
  writeFileSync(executePath, JSON.stringify(executeReport, null, 2), "utf8");

  console.log(JSON.stringify({ mode: "execute", company: company.name, company_id: companyId, import_batch_id: importBatchId, dry_run_report_path: dryRunPath, execute_report_path: executePath, backup_snapshot_path: backupPath, dry_run_report: dryRunReport, execute_report: executeReport, backup_snapshot_meta: { tables: Object.fromEntries(Object.entries(backupSnapshot.tables).map(([k, v]) => [k, v.count ?? 0])) } }, null, 2));
}

main().catch((error) => {
  console.error("[import-structure-2026] failed:", error.message);
  process.exit(1);
});
