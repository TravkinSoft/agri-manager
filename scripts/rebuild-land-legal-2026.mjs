#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_COMPANY_ID = "10000000-0000-0000-0000-000000000001";
const DEFAULT_SEASON_YEAR = 2026;
const DEFAULT_SHEET_NAME = "Лист2";
const SOURCE_TAG = "registry_land_legal_rebuild_2026";
const SOURCE_DOC = {
  stem: "registry_legal_xlsx_2026_stem",
  karagash: "registry_legal_xlsx_2026_karagash",
  owner: "registry_legal_xlsx_2026_owner_overlay",
  ownerManual: "owner_sheet_handwritten_2026",
};

const SECTION_OWNER_FALLBACK = {
  stem: 'ТОО "Астык-STEM"',
  karagash: 'ТОО "Астык-Караагаш"',
};

const MANUAL_OWNER_ROWS = [
  { owner: "Даулбаев", field: "12", area_ha: 146, crop: "пшеница", cadastral_number: "15-164-086-017" },
  { owner: "Сыздыков", field: "14-1", area_ha: 39, crop: "пшеница", cadastral_number: "15-164-086-186" },
  { owner: "Амергалиев", field: "10", area_ha: 70, crop: "ячмень", cadastral_number: "15-164-086-148" },
  { owner: "Ертайлаков", field: "16", area_ha: 200, crop: "ячмень", cadastral_number: null },
  { owner: "Магзеев", field: "16", area_ha: 50, crop: "ячмень", cadastral_number: null },
  { owner: "Звольский", field: "66", area_ha: 23, crop: "ячмень", cadastral_number: null },
  { owner: "Звольский", field: "66", area_ha: 48, crop: "пары", cadastral_number: null },
  { owner: "Мантаева", field: "3", area_ha: 40, crop: "пары", cadastral_number: "15-164-086-219" },
  { owner: "Грицук", field: "3", area_ha: 122, crop: "пары", cadastral_number: "15-164-086-086" },
  { owner: "Сатымгалиев", field: "22", area_ha: 107, crop: "лен", cadastral_number: "15-164-086-186" },
  { owner: "Сатымгалиев", field: "22", area_ha: 97, crop: "лен", cadastral_number: "15-164-086-129" },
  { owner: "Капасов", field: "66", area_ha: 65, crop: "многолетка", cadastral_number: "15-164-086-250" },
  { owner: "Ваховский", field: "22(Т)", area_ha: 88, crop: null, cadastral_number: "15-164-018-020" },
];

function usage() {
  console.log(`Usage:
  node scripts/rebuild-land-legal-2026.mjs --mode dry-run
  node scripts/rebuild-land-legal-2026.mjs --mode execute --confirm-reset true

Options:
  --mode <dry-run|execute>         Required
  --file <path>                    XLSX path (default: C:\\Users\\TRAVKIN\\Downloads\\Реестр зем.участков 1.xlsx)
  --sheet <name>                   Sheet name (default: ${DEFAULT_SHEET_NAME})
  --company-id <uuid>              Company id (default: ${DEFAULT_COMPANY_ID})
  --season-year <number>           Season year (default: ${DEFAULT_SEASON_YEAR})
  --confirm-reset <true|false>     Required in execute mode
`);
}

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

function parseBool(value, fallback = false) {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "y"].includes(normalized);
}

function toStamp(date = new Date()) {
  return date.toISOString().replace(/[.:]/g, "-");
}

function loadEnv(projectRoot) {
  const envPath = path.join(projectRoot, ".env");
  if (!existsSync(envPath)) return;
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

function asText(value) {
  return String(value ?? "").trim();
}

function normalizeText(value) {
  return asText(value)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ");
}

function normalizeCadastre(value) {
  return normalizeText(value)
    .replace(/[–—−]/g, "-")
    .replace(/[^0-9a-zа-я-]/gi, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function cadastreLooksValid(value) {
  const normalized = normalizeCadastre(value);
  return /^\d{2,3}-\d{3}-\d{3}-\d{3}$/u.test(normalized);
}

function parseNumber(value) {
  const raw = asText(value).replace(/\s+/g, "").replace(",", ".");
  if (!raw) return null;
  const number = Number(raw);
  if (!Number.isFinite(number)) return null;
  return number;
}

function positive(number) {
  if (number == null) return null;
  if (!Number.isFinite(number) || number <= 0) return null;
  return Number(number.toFixed(3));
}

function round3(number) {
  return Number(Number(number || 0).toFixed(3));
}

function stripFieldToken(value) {
  return asText(value)
    .replace(/^№\s*/iu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFieldToken(value) {
  return normalizeText(stripFieldToken(value))
    .replace(/^\s*поле\s*/iu, "")
    .replace(/\(\s*т\s*\)/giu, "")
    .replace(/\(\s*ку\s*\)/giu, "")
    .replace(/[№]/gu, "")
    .replace(/[\\/]/gu, "-")
    .replace(/[^0-9a-zа-я,\s-]/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLastNumericSuffix(value) {
  return asText(value).replace(/-\d+$/u, "");
}

function cellText(cell) {
  try {
    const value = cell?.value;
    if (value == null) return "";
    if (typeof value === "object") {
      if (value.text != null) return asText(value.text);
      if (Array.isArray(value.richText)) {
        return asText(value.richText.map((part) => part.text || "").join(""));
      }
      if (value.result != null) return asText(value.result);
      if (value.hyperlink) return asText(value.text || value.hyperlink);
      if (value.formula) return asText(value.result ?? value.formula);
    }
    return asText(value);
  } catch {
    return "";
  }
}

function isHeaderRow(col2, col3, col4, col5) {
  const n2 = normalizeText(col2);
  const n3 = normalizeText(col3);
  const n4 = normalizeText(col4);
  const n5 = normalizeText(col5);
  return (
    (n2.includes("землепользователь") && n3.includes("кадастров")) ||
    n3.includes("кадастровый номер") ||
    n4.includes("всего") ||
    n5.includes("номер поля")
  );
}

function isTotalRow(col2, col3) {
  const n2 = normalizeText(col2);
  const n3 = normalizeText(col3);
  return n2.startsWith("итого") || n2.startsWith("всего") || n3.startsWith("итого");
}

function detectSection(title) {
  const n = normalizeText(title);
  if (!n.includes("экспликация")) return null;
  if (n.includes("совместного")) return "owner";
  if (n.includes("карагаш") || n.includes("караагаш")) return "karagash";
  if (n.includes("stem") || n.includes("стем")) return "stem";
  return null;
}

function firstPositive(values) {
  for (const value of values) {
    const parsed = positive(parseNumber(value));
    if (parsed) return parsed;
  }
  return null;
}

function rowHash(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function parseFieldMeta(notes) {
  const raw = asText(notes);
  if (!raw.startsWith("{") || !raw.endsWith("}")) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function buildFieldProjection(rows) {
  return (rows || []).map((field) => {
    const meta = parseFieldMeta(field.notes);
    const technical = asText(field.name);
    const original = asText(meta.original_field_key || "");
    const display = original || stripLastNumericSuffix(technical) || technical;

    const aliases = new Set();
    const add = (value) => {
      const token = normalizeFieldToken(value);
      if (!token) return;
      aliases.add(token);
      aliases.add(token.replace(/\s+/g, "-"));
    };

    add(display);
    add(original);
    add(technical);

    const digits = normalizeFieldToken(display).match(/\d+/g) || [];
    if (digits.length) {
      aliases.add(digits.join("-"));
      aliases.add(digits[0]);
    }

    return {
      id: String(field.id),
      technical,
      original: original || null,
      display,
      area: Number(field.area || 0),
      aliases,
    };
  });
}

function resolveField(fields, rawToken) {
  const token = normalizeFieldToken(rawToken);
  if (!token) {
    return {
      status: "unmatched",
      fieldId: null,
      candidates: [],
      reason: "empty_field_token",
      confidence: 0,
    };
  }

  const exact = fields.filter((field) => field.aliases.has(token) || field.aliases.has(token.replace(/\s+/g, "-")));
  if (exact.length === 1) {
    return {
      status: "matched",
      fieldId: exact[0].id,
      candidates: [exact[0].technical],
      reason: "exact_alias",
      confidence: 1,
    };
  }

  if (exact.length > 1) {
    const sorted = [...exact].sort((a, b) => a.technical.localeCompare(b.technical, "ru"));
    return {
      status: "manual_required",
      fieldId: sorted[0].id,
      candidates: sorted.map((item) => item.technical),
      reason: "ambiguous_alias",
      confidence: 0.6,
    };
  }

  const digits = token.match(/\d+/g)?.join("-") || "";
  if (digits) {
    const byDigits = fields.filter((field) => {
      const candidate = normalizeFieldToken(field.original || field.display || field.technical).replace(/\s+/g, "-");
      return candidate === digits || candidate.startsWith(`${digits}-`);
    });
    if (byDigits.length === 1) {
      return {
        status: "matched",
        fieldId: byDigits[0].id,
        candidates: [byDigits[0].technical],
        reason: "digits_single",
        confidence: 0.9,
      };
    }
    if (byDigits.length > 1) {
      const sorted = [...byDigits].sort((a, b) => a.technical.localeCompare(b.technical, "ru"));
      return {
        status: "manual_required",
        fieldId: sorted[0].id,
        candidates: sorted.map((item) => item.technical),
        reason: "digits_ambiguous_deterministic",
        confidence: 0.6,
      };
    }
  }

  return {
    status: "unmatched",
    fieldId: null,
    candidates: [],
    reason: "not_found",
    confidence: 0,
  };
}

function distributeByShare(totalArea, shares) {
  const cleanTotal = round3(totalArea);
  if (!(cleanTotal > 0)) return [];
  const totalShares = round3(shares.reduce((sum, item) => sum + Number(item.share || 0), 0));
  if (!(totalShares > 0)) return [];

  const distributed = [];
  let consumed = 0;
  shares.forEach((item, index) => {
    const isLast = index === shares.length - 1;
    const value = isLast ? round3(cleanTotal - consumed) : round3((cleanTotal * item.share) / totalShares);
    consumed = round3(consumed + value);
    distributed.push({ ...item, area_ha: value > 0 ? value : 0 });
  });
  return distributed.filter((item) => item.area_ha > 0);
}

function pickOwnerSectionArea(rawCols) {
  return firstPositive([
    rawCols.col6,
    rawCols.col9,
    rawCols.col10,
    rawCols.col7,
    rawCols.col8,
    rawCols.col11,
    rawCols.col12,
    rawCols.col13,
    rawCols.col4,
  ]);
}

function parseRegistryWorksheet(worksheet) {
  const rows = [];
  const warnings = [];
  const danglingOwnerRows = [];
  let section = null;

  for (let rowIndex = 1; rowIndex <= worksheet.rowCount; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    const rawCols = {
      col2: cellText(row.getCell(2)),
      col3: cellText(row.getCell(3)),
      col4: cellText(row.getCell(4)),
      col5: cellText(row.getCell(5)),
      col6: cellText(row.getCell(6)),
      col7: cellText(row.getCell(7)),
      col8: cellText(row.getCell(8)),
      col9: cellText(row.getCell(9)),
      col10: cellText(row.getCell(10)),
      col11: cellText(row.getCell(11)),
      col12: cellText(row.getCell(12)),
      col13: cellText(row.getCell(13)),
      col14: cellText(row.getCell(14)),
      col15: cellText(row.getCell(15)),
      col16: cellText(row.getCell(16)),
      col17: cellText(row.getCell(17)),
      col18: cellText(row.getCell(18)),
      col19: cellText(row.getCell(19)),
      col20: cellText(row.getCell(20)),
      col21: cellText(row.getCell(21)),
    };

    const sectionKind = detectSection(rawCols.col2);
    if (sectionKind) {
      section = {
        kind: sectionKind,
        source_document: SOURCE_DOC[sectionKind],
        title: rawCols.col2,
        company_name: null,
      };
      continue;
    }
    if (!section) continue;

    if (!section.company_name) {
      const n2 = normalizeText(rawCols.col2);
      if (n2.includes("тоо") && !normalizeText(rawCols.col3).includes("кадастров")) {
        section.company_name = asText(rawCols.col2);
      }
    }

    if (isHeaderRow(rawCols.col2, rawCols.col3, rawCols.col4, rawCols.col5)) continue;
    if (isTotalRow(rawCols.col2, rawCols.col3)) continue;

    const fieldRaw = stripFieldToken(rawCols.col5);
    const cadastreRaw = asText(rawCols.col3);
    const cadastreNorm = cadastreLooksValid(cadastreRaw) ? normalizeCadastre(cadastreRaw) : null;
    const totalAreaHa = positive(parseNumber(rawCols.col4));
    const arableAreaHa = positive(parseNumber(rawCols.col6));
    const legalAreaHa =
      section.kind === "owner"
        ? pickOwnerSectionArea(rawCols)
        : firstPositive([rawCols.col6, rawCols.col4]);

    const ownerName =
      section.kind === "owner"
        ? asText(rawCols.col14) || null
        : section.company_name || SECTION_OWNER_FALLBACK[section.kind] || null;
    const usageName =
      section.kind === "owner"
        ? SECTION_OWNER_FALLBACK.stem
        : ownerName;

    const ruralDistrict = section.kind === "owner" ? null : asText(rawCols.col14) || null;

    const hasAnyData = Boolean(fieldRaw || cadastreRaw || ownerName || legalAreaHa || ruralDistrict);
    if (!hasAnyData) continue;

    if (section.kind === "owner" && ownerName && !fieldRaw && !cadastreNorm && !legalAreaHa) {
      danglingOwnerRows.push({
        row_index: rowIndex,
        owner_name: ownerName,
        source_document: section.source_document,
        reason: "owner_without_field_area_cadastre",
      });
      continue;
    }

    if (!fieldRaw) {
      warnings.push(`row ${rowIndex}: skipped (empty field token)`);
      continue;
    }
    if (!(legalAreaHa > 0)) {
      warnings.push(`row ${rowIndex}: skipped (area missing or <= 0)`);
      continue;
    }

    rows.push({
      row_index: rowIndex,
      section: section.kind,
      source_document: section.source_document,
      field_raw: fieldRaw,
      cadastral_number_raw: cadastreRaw || null,
      cadastral_number: cadastreNorm,
      total_area_ha: totalAreaHa,
      arable_area_ha: arableAreaHa,
      legal_area_ha: legalAreaHa,
      rural_district: ruralDistrict,
      owner_name: ownerName,
      usage_name: usageName,
      lease_term: asText(rawCols.col16) || null,
      act_number: asText(rawCols.col17) || null,
      decree_number: asText(rawCols.col15) || null,
      bonitet_raw: asText(rawCols.col20) || null,
      valuation_raw: asText(rawCols.col21) || null,
      raw_row: rawCols,
    });
  }

  return { rows, warnings, danglingOwnerRows };
}

function autoFindRegistryFile() {
  const preferred = "C:\\Users\\TRAVKIN\\Downloads\\Реестр зем.участков 1.xlsx";
  if (existsSync(preferred)) return preferred;
  const fallback = "C:\\Users\\TRAVKIN\\Downloads\\travkin_legal_master_list_2026.xlsx";
  if (existsSync(fallback)) return fallback;
  return preferred;
}

async function tableExists(supabase, tableName) {
  const { error } = await supabase.from(tableName).select("id", { head: true, count: "exact" }).limit(1);
  return !(error && error.code === "42P01");
}

async function countTable(supabase, tableName, companyId, seasonId = null) {
  if (!(await tableExists(supabase, tableName))) return null;
  let query = supabase.from(tableName).select("*", { head: true, count: "exact" }).eq("company_id", companyId);
  if (seasonId) query = query.eq("season_id", seasonId);
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

async function getCounts(supabase, companyId, seasonId) {
  return {
    legal_entities: await countTable(supabase, "legal_entities", companyId),
    cadastral_parcels: await countTable(supabase, "cadastral_parcels", companyId),
    field_cadastre_links: await countTable(supabase, "field_cadastre_links", companyId, seasonId),
    land_owner_allocations: await countTable(supabase, "land_owner_allocations", companyId, seasonId),
    land_documents: await countTable(supabase, "land_documents", companyId),
  };
}

async function pullRows(supabase, table, companyId, seasonId = null) {
  if (!(await tableExists(supabase, table))) return { exists: false, rows: [] };
  let query = supabase.from(table).select("*").eq("company_id", companyId);
  if (seasonId) query = query.eq("season_id", seasonId);
  const { data, error } = await query;
  if (error) throw error;
  return { exists: true, count: (data || []).length, rows: data || [] };
}

async function snapshotLegalLayer(supabase, companyId, seasonId, outputPath) {
  const snapshot = {
    created_at: new Date().toISOString(),
    company_id: companyId,
    season_id: seasonId,
    tables: {
      legal_entities: await pullRows(supabase, "legal_entities", companyId),
      cadastral_parcels: await pullRows(supabase, "cadastral_parcels", companyId),
      field_cadastre_links: await pullRows(supabase, "field_cadastre_links", companyId, seasonId),
      land_owner_allocations: await pullRows(supabase, "land_owner_allocations", companyId, seasonId),
      land_documents: await pullRows(supabase, "land_documents", companyId),
    },
  };
  writeFileSync(outputPath, JSON.stringify(snapshot, null, 2), "utf8");
  return snapshot;
}

async function deleteRows(supabase, table, companyId, seasonId = null) {
  if (!(await tableExists(supabase, table))) return 0;
  let q1 = supabase.from(table).select("id").eq("company_id", companyId);
  if (seasonId) q1 = q1.eq("season_id", seasonId);
  const before = await q1;
  if (before.error) throw before.error;
  const count = (before.data || []).length;
  if (!count) return 0;
  let q2 = supabase.from(table).delete().eq("company_id", companyId);
  if (seasonId) q2 = q2.eq("season_id", seasonId);
  const del = await q2;
  if (del.error) throw del.error;
  return count;
}

async function ensureLegalEntity(supabase, companyId, name, entityType = "company", notes = null) {
  const existing = await supabase
    .from("legal_entities")
    .select("id,name")
    .eq("company_id", companyId)
    .eq("archived", false)
    .ilike("name", name)
    .maybeSingle();
  if (existing.error && existing.error.code !== "PGRST116") throw existing.error;
  if (existing.data?.id) return existing.data.id;

  const insert = await supabase
    .from("legal_entities")
    .insert({
      company_id: companyId,
      name,
      entity_type: entityType,
      notes: notes || `${SOURCE_TAG}: auto-created`,
      is_active: true,
      archived: false,
    })
    .select("id")
    .single();
  if (insert.error) throw insert.error;
  return insert.data.id;
}

function normalizeCropToken(value) {
  return normalizeText(value).replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
}

function mapCropAlias(rawToken) {
  const token = normalizeCropToken(rawToken);
  if (!token) return null;
  if (token.includes("пшениц")) return "пшеница";
  if (token.includes("ячмен")) return "ячмень";
  if (token.includes("лен")) return "лен";
  if (token.includes("многолет")) return "многолетние травы";
  if (token.includes("многолетк")) return "многолетние травы";
  if (token.includes("пар")) return "пар";
  if (token.includes("кукуруз")) return "кукуруза";
  return token;
}

function buildOwnerManualRows() {
  return MANUAL_OWNER_ROWS.map((row, index) => ({
    row_index: 10000 + index,
    section: "owner",
    source_document: SOURCE_DOC.ownerManual,
    field_raw: row.field,
    cadastral_number_raw: row.cadastral_number || null,
    cadastral_number: row.cadastral_number && cadastreLooksValid(row.cadastral_number) ? normalizeCadastre(row.cadastral_number) : null,
    total_area_ha: positive(parseNumber(row.area_ha)),
    arable_area_ha: positive(parseNumber(row.area_ha)),
    legal_area_ha: positive(parseNumber(row.area_ha)),
    rural_district: null,
    owner_name: row.owner,
    usage_name: SECTION_OWNER_FALLBACK.stem,
    lease_term: null,
    act_number: null,
    decree_number: null,
    bonitet_raw: null,
    valuation_raw: null,
    raw_row: {
      manual_source: "handwritten_owner_sheet",
      crop: row.crop || null,
    },
    manual_crop_name: row.crop || null,
  }));
}

async function main() {
  const args = parseArgs(process.argv);
  const mode = args.mode;
  if (!mode || !["dry-run", "execute"].includes(mode)) {
    usage();
    process.exit(1);
  }

  const execute = mode === "execute";
  const confirmReset = parseBool(args["confirm-reset"], false);
  if (execute && !confirmReset) {
    throw new Error("Execute mode blocked. Set --confirm-reset true.");
  }

  const projectRoot = process.cwd();
  loadEnv(projectRoot);
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env");
  }

  const companyId = String(args["company-id"] || DEFAULT_COMPANY_ID).trim();
  const seasonYear = Number(args["season-year"] || DEFAULT_SEASON_YEAR);
  const filePath = args.file || autoFindRegistryFile();
  const sheetName = args.sheet || DEFAULT_SHEET_NAME;

  if (!existsSync(filePath)) {
    throw new Error(`Registry file not found: ${filePath}`);
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const companyRes = await supabase.from("companies").select("id,name").eq("id", companyId).single();
  if (companyRes.error || !companyRes.data?.id) throw companyRes.error || new Error("Company not found");

  const seasonRes = await supabase
    .from("seasons")
    .select("id,year")
    .eq("company_id", companyId)
    .eq("year", seasonYear)
    .maybeSingle();
  if (seasonRes.error || !seasonRes.data?.id) {
    throw seasonRes.error || new Error(`Season ${seasonYear} not found`);
  }
  const seasonId = String(seasonRes.data.id);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.getWorksheet(sheetName) || workbook.worksheets[1];
  if (!worksheet) throw new Error("Worksheet not found");

  const parsed = parseRegistryWorksheet(worksheet);
  const manualOwnerRows = buildOwnerManualRows();

  const [fieldsRes, cropsRes, cropStructureRes, countsBefore] = await Promise.all([
    supabase.from("fields").select("id,name,area,notes").eq("company_id", companyId).eq("archived", false),
    supabase
      .from("crops")
      .select("id,name,name_ru,company_id,archived,is_active")
      .or(`company_id.is.null,company_id.eq.${companyId}`)
      .eq("archived", false)
      .eq("is_active", true),
    supabase
      .from("crop_structure")
      .select("id,field_id,crop_id,area")
      .eq("company_id", companyId)
      .eq("season_id", seasonId)
      .eq("archived", false),
    getCounts(supabase, companyId, seasonId),
  ]);
  if (fieldsRes.error) throw fieldsRes.error;
  if (cropsRes.error) throw cropsRes.error;
  if (cropStructureRes.error) throw cropStructureRes.error;

  const fieldProjection = buildFieldProjection(fieldsRes.data || []);
  const fieldById = new Map(fieldProjection.map((field) => [field.id, field]));

  const cropById = new Map((cropsRes.data || []).map((crop) => [String(crop.id), crop]));
  const cropByCanonicalName = new Map(
    (cropsRes.data || []).map((crop) => [mapCropAlias(crop.name_ru || crop.name), String(crop.id)]),
  );

  const cropSharesByFieldId = new Map();
  for (const row of cropStructureRes.data || []) {
    const fieldId = String(row.field_id || "");
    const cropId = String(row.crop_id || "");
    const share = positive(parseNumber(row.area));
    if (!fieldId || !cropId || !share) continue;
    const list = cropSharesByFieldId.get(fieldId) || [];
    list.push({ crop_id: cropId, crop_name: asText(cropById.get(cropId)?.name_ru || cropById.get(cropId)?.name || ""), share });
    cropSharesByFieldId.set(fieldId, list);
  }

  const allRows = [...parsed.rows, ...manualOwnerRows];
  const unresolved = [];
  const warnings = [...parsed.warnings];
  const conflicts = [];
  const fieldMatchStats = { matched: 0, manual_required: 0, unmatched: 0 };

  const cadastreDrafts = new Map();
  const primaryRows = [];
  const ownerRows = [];

  const pushCadastreDraft = (row) => {
    if (!row.cadastral_number) return;
    const key = row.cadastral_number;
    const current = cadastreDrafts.get(key);
    if (!current) {
      cadastreDrafts.set(key, {
        cadastral_number: key,
        declared_area_ha: row.total_area_ha || row.legal_area_ha || 1,
        rural_district: row.rural_district || null,
        rural_district_values: new Set(row.rural_district ? [row.rural_district] : []),
        source_rows: [row.row_index],
        source_document: row.source_document,
      });
      return;
    }
    current.declared_area_ha = Math.max(
      Number(current.declared_area_ha || 0),
      Number(row.total_area_ha || 0),
      Number(row.legal_area_ha || 0),
      1,
    );
    if (row.rural_district) {
      current.rural_district_values.add(row.rural_district);
      if (!current.rural_district) current.rural_district = row.rural_district;
      if (current.rural_district !== row.rural_district) {
        conflicts.push({
          type: "rural_district_conflict",
          cadastral_number: key,
          values: Array.from(current.rural_district_values),
          row_index: row.row_index,
        });
      }
    }
    current.source_rows.push(row.row_index);
  };

  for (const row of allRows) {
    if (!(row.legal_area_ha > 0)) {
      unresolved.push({
        kind: row.section === "owner" ? "owner_overlay" : "primary",
        row_index: row.row_index,
        reason: "invalid_area",
        field_raw: row.field_raw,
        cadastre: row.cadastral_number,
        source_document: row.source_document,
      });
      continue;
    }

    pushCadastreDraft(row);
    const fieldResolution = resolveField(fieldProjection, row.field_raw);
    if (fieldResolution.status === "matched") fieldMatchStats.matched += 1;
    if (fieldResolution.status === "manual_required") fieldMatchStats.manual_required += 1;
    if (fieldResolution.status === "unmatched") fieldMatchStats.unmatched += 1;

    if (!fieldResolution.fieldId) {
      unresolved.push({
        kind: row.section === "owner" ? "owner_overlay" : "primary",
        row_index: row.row_index,
        reason: fieldResolution.reason,
        field_raw: row.field_raw,
        candidates: fieldResolution.candidates,
        cadastre: row.cadastral_number,
        source_document: row.source_document,
      });
      continue;
    }

    const resolved = {
      ...row,
      field_id: fieldResolution.fieldId,
      field_candidates: fieldResolution.candidates,
      field_match_reason: fieldResolution.reason,
      field_confidence: fieldResolution.confidence,
    };

    if (row.section === "owner") ownerRows.push(resolved);
    else primaryRows.push(resolved);
  }

  const linkRows = [];
  for (const row of primaryRows) {
    const shares = cropSharesByFieldId.get(row.field_id) || [];
    if (!shares.length) {
      linkRows.push({ ...row, crop_id: null, crop_name: null, area_ha: row.legal_area_ha });
      continue;
    }
    const distributed = distributeByShare(
      row.legal_area_ha,
      shares.map((item) => ({ crop_id: item.crop_id, crop_name: item.crop_name, share: item.share })),
    );
    if (!distributed.length) {
      linkRows.push({ ...row, crop_id: null, crop_name: null, area_ha: row.legal_area_ha });
      continue;
    }
    for (const part of distributed) {
      linkRows.push({
        ...row,
        crop_id: part.crop_id,
        crop_name: part.crop_name,
        area_ha: part.area_ha,
      });
    }
  }

  const ownerAllocationRows = ownerRows.map((row) => {
    const manualCropToken = row.manual_crop_name || row.raw_row?.manual_source ? row.raw_row?.crop || null : null;
    const cropToken = mapCropAlias(manualCropToken || row.raw_crop_name || "");
    const cropId = cropToken ? cropByCanonicalName.get(cropToken) || null : null;
    return {
      ...row,
      crop_token: cropToken,
      crop_id: cropId,
      missing_cadastre: !row.cadastral_number,
      missing_crop: !cropId,
      allocation_status: !row.cadastral_number
        ? cropId
          ? "partial_missing_cadastre"
          : "manual_review"
        : cropId
          ? "complete"
          : "partial_missing_crop",
    };
  });

  const dryRun = {
    generated_at: new Date().toISOString(),
    mode,
    company_id: companyId,
    company_name: companyRes.data.name,
    season_year: seasonYear,
    season_id: seasonId,
    source_file: filePath,
    source_sheet: worksheet.name,
    counts_before_reset: countsBefore,
    parsed: {
      rows_total: parsed.rows.length,
      rows_primary: parsed.rows.filter((row) => row.section !== "owner").length,
      rows_owner_from_registry: parsed.rows.filter((row) => row.section === "owner").length,
      rows_owner_manual: manualOwnerRows.length,
      parser_warnings: parsed.warnings,
      dangling_owner_rows: parsed.danglingOwnerRows,
    },
    field_match: fieldMatchStats,
    planned: {
      cadastral_parcels_to_create: cadastreDrafts.size,
      field_cadastre_links_to_create: linkRows.length,
      land_owner_allocations_to_create: ownerAllocationRows.length,
      unresolved_rows: unresolved.length,
      conflicts: conflicts.length,
    },
    unresolved_rows: unresolved,
    conflicts,
    cadastres_preview: Array.from(cadastreDrafts.values()).slice(0, 120).map((row) => ({
      ...row,
      rural_district_values: Array.from(row.rural_district_values || []),
    })),
    link_rows_preview: linkRows.slice(0, 160).map((row) => ({
      row_index: row.row_index,
      section: row.section,
      source_document: row.source_document,
      field_raw: row.field_raw,
      field_id: row.field_id,
      field_display_name: fieldById.get(row.field_id)?.display || null,
      cadastral_number: row.cadastral_number,
      rural_district: row.rural_district,
      area_ha: row.area_ha,
      crop_id: row.crop_id,
      crop_name: row.crop_name,
      owner_name: row.owner_name,
      field_match_reason: row.field_match_reason,
    })),
    owner_overlay_preview: ownerAllocationRows.slice(0, 120).map((row) => ({
      row_index: row.row_index,
      source_document: row.source_document,
      owner_name: row.owner_name,
      field_raw: row.field_raw,
      field_id: row.field_id,
      field_display_name: fieldById.get(row.field_id)?.display || null,
      cadastral_number: row.cadastral_number,
      area_ha: row.legal_area_ha,
      crop_id: row.crop_id,
      crop_token: row.crop_token,
      allocation_status: row.allocation_status,
      missing_cadastre: row.missing_cadastre,
      missing_crop: row.missing_crop,
      field_match_reason: row.field_match_reason,
    })),
  };

  const outputDir = path.join(projectRoot, "scripts", "output");
  const backupDir = path.join(projectRoot, "scripts", "backups");
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(backupDir, { recursive: true });

  const stamp = toStamp();
  const dryRunPath = path.join(outputDir, `land-legal-rebuild-dry-run-${stamp}.json`);
  writeFileSync(dryRunPath, JSON.stringify(dryRun, null, 2), "utf8");

  if (!execute) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: "dry-run",
          dry_run_report_path: dryRunPath,
          summary: dryRun.planned,
          counts_before_reset: countsBefore,
        },
        null,
        2,
      ),
    );
    return;
  }

  const snapshotPath = path.join(backupDir, `land-legal-before-reset-${companyId}-${seasonYear}-${stamp}.json`);
  await snapshotLegalLayer(supabase, companyId, seasonId, snapshotPath);

  const resetDeleted = {};
  resetDeleted.land_owner_allocations = await deleteRows(supabase, "land_owner_allocations", companyId, seasonId);
  resetDeleted.field_cadastre_links = await deleteRows(supabase, "field_cadastre_links", companyId, seasonId);
  resetDeleted.land_documents = await deleteRows(supabase, "land_documents", companyId);
  resetDeleted.cadastral_parcels = await deleteRows(supabase, "cadastral_parcels", companyId);
  resetDeleted.legal_entities = await deleteRows(supabase, "legal_entities", companyId);

  const legalEntityIdByName = new Map();
  const entityNames = new Set();
  for (const row of [...primaryRows, ...ownerAllocationRows]) {
    if (row.owner_name) entityNames.add(row.owner_name);
    if (row.usage_name) entityNames.add(row.usage_name);
  }

  let createdLegalEntities = 0;
  for (const name of entityNames) {
    const entityType = normalizeText(name).includes("тоо") || normalizeText(name).includes("llc") ? "company" : "individual";
    const id = await ensureLegalEntity(supabase, companyId, name, entityType, `${SOURCE_TAG}: rebuild`);
    legalEntityIdByName.set(normalizeText(name), id);
    createdLegalEntities += 1;
  }

  const cadastreIdByNumber = new Map();
  let createdCadastres = 0;
  for (const cadastre of cadastreDrafts.values()) {
    const insert = await supabase
      .from("cadastral_parcels")
      .insert({
        company_id: companyId,
        cadastral_number: cadastre.cadastral_number,
        declared_area_ha: cadastre.declared_area_ha || 1,
        rural_district: cadastre.rural_district || null,
        source: "import_excel",
        source_document: cadastre.source_document,
        notes: JSON.stringify({
          source: SOURCE_TAG,
          source_rows: cadastre.source_rows,
          rural_district_values: Array.from(cadastre.rural_district_values || []),
        }),
        is_active: true,
        archived: false,
      })
      .select("id,cadastral_number")
      .single();
    if (insert.error) throw insert.error;
    cadastreIdByNumber.set(cadastre.cadastral_number, String(insert.data.id));
    createdCadastres += 1;
  }

  let insertedLinks = 0;
  for (const row of linkRows) {
    if (!row.field_id || !row.cadastral_number || !(row.area_ha > 0)) continue;
    const cadastreId = cadastreIdByNumber.get(row.cadastral_number);
    if (!cadastreId) continue;
    const ownerId = row.owner_name ? legalEntityIdByName.get(normalizeText(row.owner_name)) || null : null;
    const usageId = row.usage_name ? legalEntityIdByName.get(normalizeText(row.usage_name)) || null : null;

    const sourceRowHash = rowHash({
      source_document: row.source_document,
      row_index: row.row_index,
      field_raw: row.field_raw,
      cadastre: row.cadastral_number,
      crop_id: row.crop_id || null,
      area_ha: row.area_ha,
      section: row.section,
      source: SOURCE_TAG,
    });

    const insert = await supabase.from("field_cadastre_links").insert({
      company_id: companyId,
      season_id: seasonId,
      field_id: row.field_id,
      cadastral_parcel_id: cadastreId,
      crop_id: row.crop_id || null,
      area_ha: row.area_ha,
      owner_legal_entity_id: ownerId,
      usage_legal_entity_id: usageId,
      allocation_method: "proportional_by_area",
      source: "import_excel",
      source_document: row.source_document,
      raw_field_key: row.field_raw,
      raw_crop_name: row.crop_name || row.manual_crop_name || null,
      source_row_hash: sourceRowHash,
      status: "active",
      notes: JSON.stringify({
        source: SOURCE_TAG,
        section: row.section,
        row_index: row.row_index,
        total_area_ha: row.total_area_ha,
        arable_area_ha: row.arable_area_ha,
        legal_area_ha: row.legal_area_ha,
      }),
    });
    if (insert.error) throw insert.error;
    insertedLinks += 1;
  }

  let insertedOwnerAllocations = 0;
  for (const row of ownerAllocationRows) {
    if (!row.field_id || !(row.legal_area_ha > 0) || !row.owner_name) continue;
    const ownerId = legalEntityIdByName.get(normalizeText(row.owner_name));
    if (!ownerId) continue;
    const cadastreId = row.cadastral_number ? cadastreIdByNumber.get(row.cadastral_number) || null : null;

    const sourceRowHash = rowHash({
      source_document: row.source_document,
      row_index: row.row_index,
      owner_name: row.owner_name,
      field_raw: row.field_raw,
      cadastre: row.cadastral_number || null,
      area_ha: row.legal_area_ha,
      crop_id: row.crop_id || null,
      source: SOURCE_TAG,
    });

    const insert = await supabase.from("land_owner_allocations").insert({
      company_id: companyId,
      season_id: seasonId,
      owner_legal_entity_id: ownerId,
      field_id: row.field_id,
      cadastral_parcel_id: cadastreId,
      crop_id: row.crop_id || null,
      area_ha: row.legal_area_ha,
      source: "owner_sheet_import",
      source_document: row.source_document,
      raw_owner_name: row.owner_name,
      raw_field_key: row.field_raw,
      raw_cadastral_number: row.cadastral_number || row.cadastral_number_raw || null,
      raw_crop_name: row.manual_crop_name || row.raw_crop_name || null,
      allocation_status: row.allocation_status,
      missing_cadastre: row.missing_cadastre,
      missing_crop: row.missing_crop,
      notes: JSON.stringify({
        source: SOURCE_TAG,
        section: row.section,
        row_index: row.row_index,
      }),
      source_row_hash: sourceRowHash,
      archived: false,
    });
    if (insert.error && insert.error.code !== "23505") throw insert.error;
    if (!insert.error) insertedOwnerAllocations += 1;
  }

  const countsAfter = await getCounts(supabase, companyId, seasonId);
  const executeReport = {
    executed_at: new Date().toISOString(),
    mode: "execute",
    company_id: companyId,
    company_name: companyRes.data.name,
    season_id: seasonId,
    season_year: seasonYear,
    source_file: filePath,
    source_sheet: worksheet.name,
    dry_run_report_path: dryRunPath,
    snapshot_path: snapshotPath,
    counts_before_reset: countsBefore,
    reset_deleted: resetDeleted,
    created: {
      legal_entities: createdLegalEntities,
      cadastral_parcels: createdCadastres,
      field_cadastre_links: insertedLinks,
      land_owner_allocations: insertedOwnerAllocations,
    },
    unresolved_rows: unresolved.length,
    conflict_rows: conflicts.length,
    counts_after: countsAfter,
  };

  const executePath = path.join(outputDir, `land-legal-rebuild-execute-${stamp}.json`);
  writeFileSync(executePath, JSON.stringify(executeReport, null, 2), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "execute",
        dry_run_report_path: dryRunPath,
        execute_report_path: executePath,
        snapshot_path: snapshotPath,
        summary: executeReport.created,
        unresolved_rows: unresolved.length,
        conflict_rows: conflicts.length,
        counts_after: countsAfter,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("[rebuild-land-legal-2026] failed:", error?.message || error);
  process.exit(1);
});

