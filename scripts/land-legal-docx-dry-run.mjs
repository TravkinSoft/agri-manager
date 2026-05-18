#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  CROP_ALIASES,
  DECISION_RULES,
  HARD_RULES,
  HEURISTIC_RULES,
  IMPORT_POLICY,
  MANUAL_REQUIRED_RULES,
} from "./land-legal-matcher-config.mjs";

const DEFAULT_DOCS = [
  "C:\\Users\\TRAVKIN\\Downloads\\посев 2025 стем. — копия.docx",
  "C:\\Users\\TRAVKIN\\Downloads\\посев 2026 карагаш.docx",
];

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

function normalizeHeader(value) {
  return normalizeText(value).replace(/[^a-z0-9а-я]+/g, "");
}

function normalizeCadastre(value) {
  return normalizeText(value)
    .replace(/[–—−]/g, "-")
    .replace(/[^0-9a-zа-я-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function stripFieldDecorators(raw) {
  let token = normalizeText(raw);
  token = token.replace(/№/g, "");
  token = token.replace(/\bполе\b/g, "");
  for (const rx of HARD_RULES.suffixCleanupRegex) {
    token = token.replace(rx, "");
  }
  token = token.replace(/\([^)]*\)/g, " ");
  token = token.replace(/[()]/g, " ");
  token = token.replace(/[\\/]/g, "-");
  token = token.replace(/[^a-z0-9а-я,\s-]/g, " ");
  token = token.replace(/\s+/g, " ").trim();
  return token;
}

function normalizeFieldToken(raw) {
  return stripFieldDecorators(raw)
    .replace(/,/g, ",")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parsePositive(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  const raw = String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(",", ".");
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function inferSeasonYear(fileName) {
  const raw = String(fileName || "");
  const n = normalizeText(fileName);
  const isStemDoc =
    n.includes("stem") ||
    n.includes("стем") ||
    n.includes("сђс‚рµрј") ||
    n.includes("сстем");
  // Business override: "посев 2025 стем..." is legal snapshot for season 2026.
  if (/20\s*25/.test(raw) && isStemDoc) return 2026;
  const match = String(fileName || "").match(/(20\d{2})/);
  return match ? Number(match[1]) : null;
}

function inferCompanyHint(fileName) {
  const n = normalizeText(fileName);
  if (n.includes("stem") || n.includes("стем")) return "stem";
  if (n.includes("karagash") || n.includes("карагаш")) return "karagash";
  return "unknown";
}

function inferUsageEntityName(fileName) {
  const n = normalizeText(fileName);
  if (n.includes("karagash") || n.includes("карагаш")) return 'ТОО "Астык-Караагаш"';
  if (n.includes("stem") || n.includes("стем")) return 'ТОО "Астык-STEM"';
  return null;
}

function inferSourceMode(fileName) {
  const ext = String(fileName.split(".").pop() || "").toLowerCase();
  if (ext === "docx") return "import_docx";
  if (ext === "xlsx") return "import_excel";
  return "import_csv";
}

function headerValue(cells, aliases) {
  const keys = Object.keys(cells || {});
  const normMap = new Map(keys.map((k) => [normalizeHeader(k), k]));
  for (const alias of aliases) {
    const key = normMap.get(normalizeHeader(alias));
    if (key) return String(cells[key] || "").trim();
  }

  const aliasSet = new Set((aliases || []).map((a) => normalizeText(a)));
  const normalizedKeys = keys.map((k) => ({
    raw: k,
    norm: normalizeText(k),
    hdr: normalizeHeader(k),
  }));

  const findByTokens = (tokens) =>
    normalizedKeys.find((k) =>
      tokens.some((token) => k.norm.includes(token) || k.hdr.includes(normalizeHeader(token))),
    )?.raw;

  if (aliasSet.has("field") || aliasSet.has("поле") || aliasSet.has("номер поля")) {
    const key = findByTokens(["№ поля", "номер поля", "поле", "field"]);
    if (key) return String(cells[key] || "").trim();
  }

  if (aliasSet.has("cadastre") || aliasSet.has("кадастр") || aliasSet.has("кадастровый номер")) {
    const key = findByTokens(["кадастровый номер", "кадастр", "cadastre"]);
    if (key) return String(cells[key] || "").trim();
  }

  if (aliasSet.has("district") || aliasSet.has("округ") || aliasSet.has("район")) {
    const key = findByTokens(["сельский округ", "округ", "район", "district"]);
    if (key) return String(cells[key] || "").trim();
  }

  if (aliasSet.has("crop") || aliasSet.has("культура") || aliasSet.has("посев")) {
    const key = findByTokens(["культура", "посев", "crop"]);
    if (key) return String(cells[key] || "").trim();
  }

  if (aliasSet.has("area") || aliasSet.has("га") || aliasSet.has("площадь")) {
    const key = findByTokens(["площадь, га", "площадь", "га", "area"]);
    if (key) return String(cells[key] || "").trim();
  }

  return "";
}

function isSummaryRow(row) {
  const field = normalizeText(row.field);
  const crop = normalizeText(row.crop);
  return (
    HARD_RULES.aggregateFieldSkipRegex.some((rx) => rx.test(field)) ||
    HARD_RULES.aggregateCropSkipRegex.some((rx) => rx.test(crop))
  );
}

function parseDocxTable(projectRoot, filePath) {
  const parser = path.join(projectRoot, "scripts", "parse-docx-table.ps1");
  const powershellExe = "C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
  const result = spawnSync(
    powershellExe,
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", parser, "-FilePath", filePath],
    { encoding: "utf8" },
  );
  if (result.error) {
    throw new Error(`Failed to start PowerShell for DOCX parse: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Failed to parse DOCX ${filePath}: ${result.stderr || result.stdout}`);
  }
  const text = String(result.stdout || "").trim();
  if (!text) {
    throw new Error(`DOCX parser returned empty output for ${filePath}`);
  }
  return JSON.parse(text);
}

function extractImportRows(parsed, sourceDocument) {
  const rows = [];
  for (const row of parsed.rows || []) {
    const cells = row.cells || {};
    const field = headerValue(cells, ["№ поля", "N поля", "поле", "номер поля", "field"]);
    const cadastralNumber = headerValue(cells, [
      "кадастровый номер участка",
      "кадастровый номер",
      "кадастр",
      "cadastre",
    ]);
    const ruralDistrict = headerValue(cells, ["сельский округ", "округ", "район", "district"]);
    const crop = headerValue(cells, ["культура", "посев", "crop"]);
    const areaRaw = headerValue(cells, ["площадь, га", "площадь", "га", "area"]);
    const areaHa = parsePositive(areaRaw);
    const item = {
      row_no: Number(row.rowIndex || 0),
      field: field.trim(),
      cadastral_number: cadastralNumber.trim(),
      rural_district: ruralDistrict.trim(),
      area_ha: areaHa,
      crop: crop.trim(),
      source_document: sourceDocument,
      raw: cells,
    };
    if (isSummaryRow(item)) continue;
    if (!item.field && !item.cadastral_number && !item.crop && !item.area_ha) continue;
    rows.push(item);
  }
  return rows;
}

function buildFieldAliasIndex(fields) {
  const aliasToIds = new Map();
  const byId = new Map();

  const put = (alias, id) => {
    if (!alias) return;
    const key = normalizeFieldToken(alias);
    if (!key) return;
    if (!aliasToIds.has(key)) aliasToIds.set(key, new Set());
    aliasToIds.get(key).add(id);
  };

  const variants = (name) => {
    const base = normalizeFieldToken(name);
    const out = new Set([base]);
    const digits = base.match(/\d+/g) || [];
    const hasKu = /\bку\b/.test(base);
    if (digits.length) {
      out.add(digits.join("-"));
      out.add(`${digits.join("-")}-1`);
      out.add(digits[0]);
      out.add(`${digits[0]}-1`);
    }
    if (hasKu && digits.length) {
      out.add(`ку-${digits.join("-")}`);
      out.add(`ку-${digits[0]}`);
      out.add(`${digits[0]}ку`);
    }
    if (/^.+-\d+$/.test(base)) {
      const parts = base.split("-");
      parts.pop();
      out.add(parts.join("-"));
    }
    return Array.from(out).filter(Boolean);
  };

  for (const field of fields || []) {
    const id = String(field.id);
    byId.set(id, field);
    for (const alias of variants(String(field.name || ""))) {
      put(alias, id);
    }
  }
  return { aliasToIds, byId };
}

function buildCropIndex(crops) {
  const map = new Map();
  for (const crop of crops || []) {
    const id = String(crop.id);
    const variants = [
      normalizeText(crop.name || ""),
      normalizeText(crop.name_ru || ""),
      normalizeText(crop.name_kz || ""),
      normalizeText(crop.name_en || ""),
    ].filter(Boolean);
    for (const v of variants) {
      if (!map.has(v)) map.set(v, new Set());
      map.get(v).add(id);
    }
  }
  return map;
}

function buildDocFieldCandidates(rawField) {
  const out = new Set();
  const rawNorm = normalizeText(rawField);
  const cleaned = stripFieldDecorators(rawField);
  const base = normalizeFieldToken(rawField);
  if (base) out.add(base);

  const parts = cleaned
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => normalizeFieldToken(p));
  for (const part of parts) {
    if (!part) continue;
    out.add(part);
    if (/^\d+$/.test(part)) out.add(`${part}-1`);
  }

  const circleMatch = rawNorm.match(HARD_RULES.circleTokenRegex);
  if (circleMatch?.[1]) {
    out.add(`круг-${circleMatch[1]}`);
    out.add(`ку-${circleMatch[1]}-1`);
    out.add(`${circleMatch[1]}-1`);
  }

  const digits = base.match(/\d+/g) || [];
  const hasKu = HARD_RULES.kuTokenRegex.test(rawNorm);
  if (digits.length) {
    out.add(digits.join("-"));
    out.add(`${digits.join("-")}-1`);
    out.add(digits[0]);
    out.add(`${digits[0]}-1`);
    if (hasKu) {
      out.add(`ку-${digits.join("-")}`);
      out.add(`ку-${digits.join("-")}-1`);
      out.add(`ку-${digits[0]}`);
      out.add(`ку-${digits[0]}-1`);
    }
  }

  return Array.from(out).filter(Boolean);
}

function makeLinkKey(payload) {
  return [
    payload.company_id,
    payload.season_id || "none",
    payload.field_id || "none",
    payload.cadastre_key || "none",
    payload.crop_id || "none",
    Number(payload.area_ha || 0).toFixed(3),
  ].join("|");
}

function chooseFieldCandidate({ rawField, fieldToken, candidates }) {
  const rawNorm = normalizeText(rawField);
  const digits = fieldToken.match(/\d+/g) || [];
  const main = digits[0] || null;
  const resultBase = {
    suggested_match: null,
    confidence: 0,
    reason: "unresolved",
    applied_rule: "none",
  };

  const preferredPatterns = HARD_RULES.fieldPreferredByToken[fieldToken] || [];
  for (const pattern of preferredPatterns) {
    const match = candidates.find((name) => pattern.test(name));
    if (match) {
      return {
        ...resultBase,
        suggested_match: match,
        confidence: HEURISTIC_RULES.confidence.hard,
        reason: "hard_preferred_mapping",
        applied_rule: "hard",
      };
    }
  }

  if (HEURISTIC_RULES.preferKuForKuTokens && HARD_RULES.kuTokenRegex.test(rawNorm) && main) {
    const ku = candidates.find((name) => new RegExp(`^ку[- ]?${main}(-1)?$`, "i").test(name));
    if (ku) {
      return {
        ...resultBase,
        suggested_match: ku,
        confidence: HEURISTIC_RULES.confidence.hard,
        reason: "ku_marker_preferred",
        applied_rule: "hard",
      };
    }
  }

  if (HEURISTIC_RULES.preferExactToken) {
    const exact = candidates.find((name) => normalizeFieldToken(name) === fieldToken);
    if (exact) {
      return {
        ...resultBase,
        suggested_match: exact,
        confidence: HEURISTIC_RULES.confidence.heuristic,
        reason: "exact_token_match",
        applied_rule: "heuristic",
      };
    }
  }

  if (HEURISTIC_RULES.preferSuffixOne && main) {
    const s1 = candidates.find((name) => new RegExp(`^${main}(?:-[0-9]+)?-1$`, "i").test(name));
    if (s1) {
      return {
        ...resultBase,
        suggested_match: s1,
        confidence: HEURISTIC_RULES.confidence.heuristic,
        reason: "suffix_one_preferred",
        applied_rule: "heuristic",
      };
    }
  }

  if (candidates.length === 1) {
    return {
      ...resultBase,
      suggested_match: candidates[0],
      confidence: HEURISTIC_RULES.confidence.heuristic,
      reason: "single_candidate",
      applied_rule: "heuristic",
    };
  }

  return resultBase;
}

function resolveCaseSpecificFieldMapping(doc, row, fieldToken, candidateNames) {
  const docName = normalizeText(doc.fileName || "");
  const cadastre = normalizeCadastre(row.cadastral_number);
  const crop = normalizeText(row.crop);
  const area = Number(row.area_ha || 0);

  for (const rule of DECISION_RULES.caseSpecificFieldMappings || []) {
    if (!docName.includes(normalizeText(rule.sourceDocumentContains || ""))) continue;
    if (normalizeFieldToken(rule.rawFieldToken || "") !== fieldToken) continue;
    if (normalizeCadastre(rule.cadastralNumber || "") !== cadastre) continue;
    if (normalizeText(rule.cropToken || "") !== crop) continue;
    if (Number(rule.areaHa || 0) !== area) continue;
    const target = candidateNames.find((name) => {
      if (rule.targetFieldNameRegex instanceof RegExp) return rule.targetFieldNameRegex.test(name);
      return normalizeText(name) === normalizeText(rule.targetFieldNameRegex || "");
    });
    if (target) {
      return {
        suggested_match: target,
        confidence: HEURISTIC_RULES.confidence.hard,
        reason: rule.reason || "case_specific_override",
        applied_rule: "hard_case_specific",
      };
    }
  }

  return null;
}

function resolveField(row, ctx, doc) {
  const rawField = String(row.field || "").trim();
  const fieldToken = normalizeFieldToken(rawField);
  if (!fieldToken) {
    return {
      status: "unmatched",
      field_id: null,
      candidates: [],
      suggested_match: null,
      confidence: 0,
      reason: "empty_field_token",
      applied_rule: "none",
    };
  }

  const candidateTokens = buildDocFieldCandidates(rawField);
  const matchedIds = new Set();
  for (const token of candidateTokens) {
    const ids = ctx.fieldAliasToIds.get(token);
    if (!ids) continue;
    for (const id of ids) matchedIds.add(id);
  }

  let candidateNames = Array.from(matchedIds)
    .map((id) => ({ id, name: String(ctx.fieldById.get(id)?.name || "") }))
    .filter((v) => v.name);

  const blacklist = HARD_RULES.fieldBlacklistByToken[fieldToken] || [];
  if (blacklist.length) {
    candidateNames = candidateNames.filter((v) => blacklist.every((rx) => !rx.test(v.name)));
  }

  if (candidateNames.length === 0) {
    return {
      status: "unmatched",
      field_id: null,
      candidates: [],
      suggested_match: null,
      confidence: 0,
      reason: "field_not_matched",
      applied_rule: "none",
    };
  }

  const caseSpecific = resolveCaseSpecificFieldMapping(
    doc,
    row,
    fieldToken,
    candidateNames.map((v) => v.name),
  );
  if (caseSpecific) {
    const chosenId = candidateNames.find((v) => v.name === caseSpecific.suggested_match)?.id || null;
    if (chosenId) {
      return {
        status: "matched",
        field_id: chosenId,
        candidates: candidateNames.map((v) => v.name),
        suggested_match: caseSpecific.suggested_match,
        confidence: caseSpecific.confidence,
        reason: caseSpecific.reason,
        applied_rule: caseSpecific.applied_rule,
      };
    }
  }

  const chosen = chooseFieldCandidate({
    rawField,
    fieldToken,
    candidates: candidateNames.map((v) => v.name),
  });
  const chosenId = candidateNames.find((v) => v.name === chosen.suggested_match)?.id || null;

  if (chosenId && chosen.applied_rule === "hard") {
    return {
      status: "matched",
      field_id: chosenId,
      candidates: candidateNames.map((v) => v.name),
      suggested_match: chosen.suggested_match,
      confidence: chosen.confidence,
      reason: chosen.reason,
      applied_rule: "hard",
    };
  }

  if (chosenId && candidateNames.length === 1) {
    return {
      status: "matched",
      field_id: chosenId,
      candidates: candidateNames.map((v) => v.name),
      suggested_match: chosen.suggested_match,
      confidence: chosen.confidence,
      reason: chosen.reason,
      applied_rule: "heuristic",
    };
  }

  if (candidateNames.length > 1 && MANUAL_REQUIRED_RULES.fieldTokens.has(fieldToken)) {
    return {
      status: "manual_required",
      field_id: null,
      candidates: candidateNames.map((v) => v.name),
      suggested_match: chosen.suggested_match,
      confidence: chosen.confidence || HEURISTIC_RULES.confidence.manualSuggestion,
      reason: `manual_required_for_token:${fieldToken}`,
      applied_rule: "manual_required",
    };
  }

  if (
    chosenId &&
    chosen.applied_rule === "heuristic" &&
    chosen.confidence >= HEURISTIC_RULES.confidence.heuristic
  ) {
    return {
      status: "matched",
      field_id: chosenId,
      candidates: candidateNames.map((v) => v.name),
      suggested_match: chosen.suggested_match,
      confidence: chosen.confidence,
      reason: chosen.reason,
      applied_rule: "heuristic",
    };
  }

  return {
    status: "ambiguous",
    field_id: null,
    candidates: candidateNames.map((v) => v.name),
    suggested_match: chosen.suggested_match,
    confidence: chosen.confidence || HEURISTIC_RULES.confidence.manualSuggestion,
    reason: "multiple_candidates",
    applied_rule: "manual_required",
  };
}

function resolveCrop(row, ctx) {
  const raw = String(row.crop || "").trim();
  if (!raw) {
    return { status: "unmatched", crop_id: null, canonical: null, confidence: 0, reason: "empty_crop" };
  }
  const token = normalizeText(raw);
  if (HARD_RULES.aggregateCropSkipRegex.some((rx) => rx.test(token))) {
    return {
      status: "skipped",
      crop_id: null,
      canonical: null,
      confidence: HEURISTIC_RULES.confidence.hard,
      reason: "aggregate_crop_skip",
    };
  }

  const canonical = CROP_ALIASES[token] || token;
  const hits = ctx.cropIndex.get(canonical) || new Set();
  if (hits.size >= 1) {
    return {
      status: "matched",
      crop_id: Array.from(hits)[0],
      canonical,
      confidence: HEURISTIC_RULES.confidence.hard,
      reason: canonical === token ? "exact_crop_match" : "crop_alias_match",
    };
  }
  return {
    status: "unmatched",
    crop_id: null,
    canonical,
    confidence: 0,
    reason: "crop_not_matched",
  };
}

function resolveManualSkipRule(doc, row) {
  const docName = normalizeText(doc.fileName || "");
  for (const rule of DECISION_RULES.manualSkipRows || []) {
    const docMatch = docName.includes(normalizeText(rule.sourceDocumentContains || ""));
    const rowMatch = Number(rule.rowNo) === Number(row.row_no);
    if (docMatch && rowMatch) return rule;
  }
  return null;
}

async function loadCompanyContext(supabase, companyId) {
  const [fieldsRes, cropsRes, cadRes, linksRes, seasonsRes, entitiesRes] = await Promise.all([
    supabase.from("fields").select("id,name,area").eq("company_id", companyId).eq("archived", false),
    supabase
      .from("crops")
      .select("id,name,name_ru,name_kz,name_en,company_id")
      .or(`company_id.is.null,company_id.eq.${companyId}`)
      .eq("archived", false)
      .eq("is_active", true),
    supabase
      .from("cadastral_parcels")
      .select("id,cadastral_number,declared_area_ha,rural_district")
      .eq("company_id", companyId)
      .eq("archived", false),
    supabase
      .from("field_cadastre_links")
      .select("id,season_id,field_id,cadastral_parcel_id,crop_id,area_ha,status")
      .eq("company_id", companyId)
      .neq("status", "archived"),
    supabase.from("seasons").select("id,year").eq("company_id", companyId),
    supabase.from("legal_entities").select("id,name").eq("company_id", companyId).eq("archived", false),
  ]);

  if (fieldsRes.error) throw fieldsRes.error;
  if (cropsRes.error) throw cropsRes.error;
  if (cadRes.error) throw cadRes.error;
  if (linksRes.error) throw linksRes.error;
  if (seasonsRes.error) throw seasonsRes.error;
  if (entitiesRes.error) throw entitiesRes.error;

  const { aliasToIds, byId } = buildFieldAliasIndex(fieldsRes.data || []);
  const cropIndex = buildCropIndex(cropsRes.data || []);
  const cadastreByKey = new Map();
  for (const row of cadRes.data || []) {
    cadastreByKey.set(normalizeCadastre(row.cadastral_number), row);
  }
  const seasonByYear = new Map();
  for (const row of seasonsRes.data || []) {
    seasonByYear.set(Number(row.year), String(row.id));
  }
  const legalEntityByName = new Map();
  for (const row of entitiesRes.data || []) {
    legalEntityByName.set(normalizeText(row.name), row);
  }

  return {
    fields: fieldsRes.data || [],
    cadastres: cadRes.data || [],
    links: linksRes.data || [],
    fieldAliasToIds: aliasToIds,
    fieldById: byId,
    cropIndex,
    cadastreByKey,
    seasonByYear,
    legalEntityByName,
  };
}

function resolveCompanyByHint(companies, hint) {
  const normalized = (companies || []).map((c) => ({ ...c, key: normalizeText(c.name) }));
  if (hint === "stem") {
    return normalized.find((c) => c.key.includes("stem") || c.key.includes("стем")) || null;
  }
  if (hint === "karagash") {
    return normalized.find((c) => c.key.includes("karagash") || c.key.includes("карагаш")) || null;
  }
  return null;
}

function usage() {
  console.log(`Usage:
  node scripts/land-legal-docx-dry-run.mjs
  node scripts/land-legal-docx-dry-run.mjs --doc1 "<path>" --doc2 "<path>"
  node scripts/land-legal-docx-dry-run.mjs --karagash-company-id <uuid>
  node scripts/land-legal-docx-dry-run.mjs --parsed1 "<json>" --parsed2 "<json>"`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h) {
    usage();
    process.exit(0);
  }

  const projectRoot = process.cwd();
  loadEnv(projectRoot);
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env");
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const docPaths = [args.doc1 || DEFAULT_DOCS[0], args.doc2 || DEFAULT_DOCS[1]];
  const parsedPaths = [args.parsed1 || "", args.parsed2 || ""];

  const docs = docPaths.map((filePath, idx) => {
    const parsed = parsedPaths[idx]
      ? JSON.parse(readFileSync(path.resolve(parsedPaths[idx]), "utf8").replace(/^\uFEFF/, ""))
      : parseDocxTable(projectRoot, filePath);
    const fileName = path.basename(filePath);
    return {
      fileName,
      path: filePath,
      seasonYear: inferSeasonYear(fileName),
      companyHint: inferCompanyHint(fileName),
      usageEntityName: inferUsageEntityName(fileName),
      parsed,
      rows: extractImportRows(parsed, fileName),
    };
  });

  const { data: companies, error: companiesError } = await supabase.from("companies").select("id,name").order("name");
  if (companiesError) throw companiesError;

  const explicitKaragashCompanyId = String(args["karagash-company-id"] || "").trim();
  const companyContexts = new Map();

  const docWithCompany = docs.map((doc) => {
    let company = resolveCompanyByHint(companies || [], doc.companyHint);
    if (!company && doc.companyHint === "karagash" && explicitKaragashCompanyId) {
      company = (companies || []).find((c) => String(c.id) === explicitKaragashCompanyId) || null;
    }
    return { ...doc, company };
  });

  for (const doc of docWithCompany) {
    if (!doc.company) continue;
    if (!companyContexts.has(doc.company.id)) {
      // eslint-disable-next-line no-await-in-loop
      companyContexts.set(doc.company.id, await loadCompanyContext(supabase, doc.company.id));
    }
  }

  const summary = {
    rows_total: 0,
    rows_skipped_by_season_rule: 0,
    rows_skipped_aggregate: 0,
    skipped_manual: 0,
    fields_matched: 0,
    fields_unmatched: 0,
    fields_ambiguous: 0,
    crops_matched: 0,
    crops_unmatched: 0,
    cadastral_existing: 0,
    cadastral_to_create: 0,
    links_to_create: 0,
    duplicate_cadastres: 0,
    duplicate_field_links: 0,
    conflicts: 0,
    manual_required_count: 0,
    remaining_manual_required: 0,
    unresolved_count: 0,
  };

  const companyBreakdown = {};
  const warnings = [];
  const conflicts = [];
  const unmatchedRows = [];
  const manualReviewRows = [];
  const preparedRows = [];
  const dedupeCadastreByCompany = new Set();
  const dedupeNewLink = new Set();
  const usageEntitiesToCreate = [];
  const manyToMany = {
    field_to_many_cadastres: [],
    cadastre_to_many_fields: [],
    cadastre_to_many_crops: [],
  };
  const allMatchedForGraph = [];

  for (const doc of docWithCompany) {
    const docStats = {
      file: doc.fileName,
      company_hint: doc.companyHint,
      company_id: doc.company?.id || null,
      company_name: doc.company?.name || null,
      season_year: doc.seasonYear,
      season_id: null,
      raw_rows: doc.parsed.rowCount || 0,
      usable_rows: doc.rows.length,
      rows_skipped_by_season_rule: 0,
      rows_skipped_aggregate: 0,
      skipped_manual: 0,
      fields_matched: 0,
      fields_unmatched: 0,
      fields_ambiguous: 0,
      crops_matched: 0,
      crops_unmatched: 0,
      cadastral_existing: 0,
      cadastral_to_create: 0,
      links_to_create: 0,
      duplicate_cadastres: 0,
      duplicate_field_links: 0,
      conflicts: 0,
      manual_required_count: 0,
      remaining_manual_required: 0,
      unresolved_count: 0,
    };

    summary.rows_total += doc.rows.length;

    if (!doc.company) {
      warnings.push(`No company mapping for ${doc.fileName}`);
      docStats.unresolved_count += doc.rows.length;
      for (const row of doc.rows) {
        unmatchedRows.push({
          file: doc.fileName,
          row_no: row.row_no,
          reason: "company_not_resolved",
          field: row.field,
          crop: row.crop,
          cadastral_number: row.cadastral_number,
        });
      }
      companyBreakdown[doc.fileName] = docStats;
      continue;
    }

    const ctx = companyContexts.get(doc.company.id);
    docStats.season_id = ctx.seasonByYear.get(doc.seasonYear) || null;
    if (!docStats.season_id) {
      warnings.push(`Season ${doc.seasonYear || "unknown"} not found for ${doc.fileName}`);
    }

    if (doc.usageEntityName && !ctx.legalEntityByName.has(normalizeText(doc.usageEntityName))) {
      usageEntitiesToCreate.push({
        company_id: doc.company.id,
        company_name: doc.company.name,
        usage_legal_entity_name: doc.usageEntityName,
        source_document: doc.fileName,
      });
    }

    const existingLinkKeys = new Set();
    for (const link of ctx.links) {
      const cad = ctx.cadastres.find((c) => c.id === link.cadastral_parcel_id);
      existingLinkKeys.add(
        makeLinkKey({
          company_id: doc.company.id,
          season_id: link.season_id || null,
          field_id: link.field_id,
          cadastre_key: cad ? normalizeCadastre(cad.cadastral_number) : "",
          crop_id: link.crop_id || null,
          area_ha: link.area_ha,
        }),
      );
    }

    for (const row of doc.rows) {
      const rawField = normalizeText(row.field);
      const rawCrop = normalizeText(row.crop);
      if (!rawField && !normalizeText(row.cadastral_number)) {
        docStats.rows_skipped_aggregate += 1;
        continue;
      }
      if (
        HARD_RULES.aggregateFieldSkipRegex.some((rx) => rx.test(rawField)) ||
        HARD_RULES.aggregateCropSkipRegex.some((rx) => rx.test(rawCrop))
      ) {
        docStats.rows_skipped_aggregate += 1;
        continue;
      }

      if (doc.seasonYear !== IMPORT_POLICY.seasonYearOnly) {
        docStats.rows_skipped_by_season_rule += 1;
        continue;
      }

      const manualSkipRule = resolveManualSkipRule(doc, row);
      if (manualSkipRule) {
        docStats.skipped_manual += 1;
        manualReviewRows.push({
          source_document: doc.fileName,
          row_no: row.row_no,
          raw_token: row.field,
          candidates: [],
          suggested_match: null,
          confidence: 1,
          reason: manualSkipRule.reason,
          action: "skip_manual",
          cadastral_number: row.cadastral_number,
          crop: row.crop,
          area_ha: row.area_ha,
        });
        preparedRows.push({
          source_document: doc.fileName,
          source_mode: inferSourceMode(doc.fileName),
          company_id: doc.company.id,
          season_id: docStats.season_id,
          row_no: row.row_no,
          field: row.field,
          crop: row.crop,
          cadastral_number: row.cadastral_number,
          rural_district: row.rural_district,
          area_ha: row.area_ha,
          field_id: null,
          crop_id: null,
          field_candidates: [],
          inferred_usage_legal_entity_name: doc.usageEntityName,
          can_insert: false,
          status: "skip_manual",
          reason: manualSkipRule.reason,
          raw: row.raw || {},
        });
        continue;
      }

      const fieldRes = resolveField(row, ctx, doc);
      const cropRes = resolveCrop(row, ctx);
      const cadastreKey = normalizeCadastre(row.cadastral_number);
      const cadastre = cadastreKey ? ctx.cadastreByKey.get(cadastreKey) : null;

      if (fieldRes.status === "matched") docStats.fields_matched += 1;
      if (fieldRes.status === "unmatched") docStats.fields_unmatched += 1;
      if (fieldRes.status === "ambiguous") docStats.fields_ambiguous += 1;
      if (fieldRes.status === "manual_required") docStats.manual_required_count += 1;

      if (cropRes.status === "matched") docStats.crops_matched += 1;
      if (cropRes.status === "unmatched") docStats.crops_unmatched += 1;

      if (cadastre) {
        docStats.cadastral_existing += 1;
      }

      const insertable =
        fieldRes.status === "matched" &&
        cropRes.status === "matched" &&
        !!cadastreKey &&
        !!row.area_ha &&
        !!docStats.season_id;

      if (!insertable) {
        docStats.conflicts += 1;
        docStats.unresolved_count += 1;
        summary.unresolved_count += 1;
        conflicts.push({
          file: doc.fileName,
          row_no: row.row_no,
          type: fieldRes.status === "manual_required" ? "field_manual_required" : "row_not_insertable",
          field: row.field,
          crop: row.crop,
          cadastre: row.cadastral_number,
          area_ha: row.area_ha,
          details: {
            field_status: fieldRes.status,
            crop_status: cropRes.status,
            cadastre_ok: Boolean(cadastreKey),
            season_ok: Boolean(docStats.season_id),
            field_candidates: fieldRes.candidates,
          },
        });
        unmatchedRows.push({
          file: doc.fileName,
          row_no: row.row_no,
          reason:
            fieldRes.status === "manual_required"
              ? "field_manual_required"
              : fieldRes.status === "unmatched"
                ? "field_not_matched"
                : cropRes.status === "unmatched"
                  ? "crop_not_matched"
                  : "not_insertable",
          field: row.field,
          crop: row.crop,
          cadastral_number: row.cadastral_number,
        });
        if (fieldRes.status === "manual_required" || fieldRes.status === "ambiguous") {
          manualReviewRows.push({
            source_document: doc.fileName,
            row_no: row.row_no,
            raw_token: row.field,
            candidates: fieldRes.candidates,
            suggested_match: fieldRes.suggested_match,
            confidence: fieldRes.confidence,
            reason: fieldRes.reason,
            action: "manual_review",
            cadastral_number: row.cadastral_number,
            crop: row.crop,
            area_ha: row.area_ha,
          });
        }
        preparedRows.push({
          source_document: doc.fileName,
          source_mode: inferSourceMode(doc.fileName),
          company_id: doc.company.id,
          season_id: docStats.season_id,
          row_no: row.row_no,
          field: row.field,
          crop: row.crop,
          cadastral_number: row.cadastral_number,
          rural_district: row.rural_district,
          area_ha: row.area_ha,
          field_id: fieldRes.field_id || null,
          crop_id: cropRes.crop_id || null,
          field_candidates: fieldRes.candidates || [],
          inferred_usage_legal_entity_name: doc.usageEntityName,
          can_insert: false,
          status: "unresolved",
          reason:
            fieldRes.status === "manual_required"
              ? "field_manual_required"
              : fieldRes.status === "unmatched"
                ? "field_not_matched"
                : cropRes.status === "unmatched"
                  ? "crop_not_matched"
                  : "not_insertable",
          raw: row.raw || {},
        });
        continue;
      }

      const linkKey = makeLinkKey({
        company_id: doc.company.id,
        season_id: docStats.season_id,
        field_id: fieldRes.field_id,
        cadastre_key: cadastreKey,
        crop_id: cropRes.crop_id,
        area_ha: row.area_ha,
      });
      if (existingLinkKeys.has(linkKey) || dedupeNewLink.has(linkKey)) {
        docStats.duplicate_field_links += 1;
        continue;
      }

      dedupeNewLink.add(linkKey);
      docStats.links_to_create += 1;
      summary.links_to_create += 1;

      const cadDedupe = `${doc.company.id}|${cadastreKey}`;
      if (cadastre) {
        if (dedupeCadastreByCompany.has(cadDedupe)) {
          docStats.duplicate_cadastres += 1;
        } else {
          dedupeCadastreByCompany.add(cadDedupe);
        }
      } else {
        if (!dedupeCadastreByCompany.has(cadDedupe)) {
          dedupeCadastreByCompany.add(cadDedupe);
          docStats.cadastral_to_create += 1;
          summary.cadastral_to_create += 1;
        } else {
          docStats.duplicate_cadastres += 1;
        }
      }

      allMatchedForGraph.push({
        company_name: doc.company.name,
        field_name: String(ctx.fieldById.get(fieldRes.field_id)?.name || row.field),
        cadastre: row.cadastral_number,
        crop: row.crop,
        area_ha: row.area_ha,
      });
      preparedRows.push({
        source_document: doc.fileName,
        source_mode: inferSourceMode(doc.fileName),
        company_id: doc.company.id,
        season_id: docStats.season_id,
        row_no: row.row_no,
        field: row.field,
        crop: row.crop,
        cadastral_number: row.cadastral_number,
        rural_district: row.rural_district,
        area_ha: row.area_ha,
        field_id: fieldRes.field_id,
        crop_id: cropRes.crop_id,
        field_candidates: fieldRes.candidates || [],
        inferred_usage_legal_entity_name: doc.usageEntityName,
        can_insert: true,
        status: "insertable",
        reason: "ok",
        raw: row.raw || {},
      });
    }

    docStats.remaining_manual_required = docStats.manual_required_count;

    summary.rows_skipped_by_season_rule += docStats.rows_skipped_by_season_rule;
    summary.rows_skipped_aggregate += docStats.rows_skipped_aggregate;
    summary.skipped_manual += docStats.skipped_manual;
    summary.fields_matched += docStats.fields_matched;
    summary.fields_unmatched += docStats.fields_unmatched;
    summary.fields_ambiguous += docStats.fields_ambiguous;
    summary.manual_required_count += docStats.manual_required_count;
    summary.remaining_manual_required += docStats.remaining_manual_required;
    summary.crops_matched += docStats.crops_matched;
    summary.crops_unmatched += docStats.crops_unmatched;
    summary.cadastral_existing += docStats.cadastral_existing;
    summary.duplicate_cadastres += docStats.duplicate_cadastres;
    summary.duplicate_field_links += docStats.duplicate_field_links;
    summary.conflicts += docStats.conflicts;
    companyBreakdown[doc.fileName] = docStats;
  }

  const byField = new Map();
  const byCadastreFields = new Map();
  const byCadastreCrops = new Map();
  for (const row of allMatchedForGraph) {
    const fk = `${row.company_name}|${row.field_name}`;
    const ck = `${row.company_name}|${normalizeCadastre(row.cadastre)}`;
    if (!byField.has(fk)) byField.set(fk, new Set());
    byField.get(fk).add(normalizeCadastre(row.cadastre));
    if (!byCadastreFields.has(ck)) byCadastreFields.set(ck, new Set());
    byCadastreFields.get(ck).add(row.field_name);
    if (!byCadastreCrops.has(ck)) byCadastreCrops.set(ck, new Set());
    byCadastreCrops.get(ck).add(normalizeText(row.crop));
  }

  for (const [k, set] of byField.entries()) {
    if (set.size > 1) {
      const [companyName, fieldName] = k.split("|");
      manyToMany.field_to_many_cadastres.push({
        company: companyName,
        field: fieldName,
        cadastre_count: set.size,
        cadastres: Array.from(set),
      });
    }
  }
  for (const [k, set] of byCadastreFields.entries()) {
    if (set.size > 1) {
      const [companyName, cadastre] = k.split("|");
      manyToMany.cadastre_to_many_fields.push({
        company: companyName,
        cadastral_number: cadastre,
        field_count: set.size,
        fields: Array.from(set).sort((a, b) => a.localeCompare(b, "ru")),
      });
    }
  }
  for (const [k, set] of byCadastreCrops.entries()) {
    if (set.size > 1) {
      const [companyName, cadastre] = k.split("|");
      manyToMany.cadastre_to_many_crops.push({
        company: companyName,
        cadastral_number: cadastre,
        crop_count: set.size,
        crops: Array.from(set).sort((a, b) => a.localeCompare(b, "ru")),
      });
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    policy: IMPORT_POLICY,
    matcher_bundle: {
      hard_rules: {
        fieldPreferredByToken: Object.keys(HARD_RULES.fieldPreferredByToken),
        fieldBlacklistByToken: Object.keys(HARD_RULES.fieldBlacklistByToken),
        ku_rule: "for (КУ) or Круг №N prefer ку-N-1, then N-1",
        aggregate_skip: ["Итого", "Всего", "Масличных", "Зернобобовых", "empty summary rows"],
      },
      heuristic_rules: {
        preferExactToken: HEURISTIC_RULES.preferExactToken,
        preferSuffixOne: HEURISTIC_RULES.preferSuffixOne,
        preferKuForKuTokens: HEURISTIC_RULES.preferKuForKuTokens,
      },
      manual_required_rules: {
        field_tokens: Array.from(MANUAL_REQUIRED_RULES.fieldTokens),
      },
      crop_aliases_count: Object.keys(CROP_ALIASES).length,
    },
    input_documents: docWithCompany.map((d) => ({
      file: d.fileName,
      path: d.path,
      table_rows: d.parsed.rowCount || 0,
      parsed_rows: d.rows.length,
      season_year: d.seasonYear,
      company_hint: d.companyHint,
      resolved_company_id: d.company?.id || null,
      resolved_company_name: d.company?.name || null,
      source_document: d.fileName,
      inferred_usage_legal_entity_name: d.usageEntityName,
    })),
    summary,
    company_breakdown: companyBreakdown,
    usage_legal_entities_to_create: usageEntitiesToCreate,
    prepared_rows: preparedRows,
    warnings,
    conflicts_sample: conflicts.slice(0, 150),
    unmatched_rows_sample: unmatchedRows.slice(0, 150),
    manual_review_table: manualReviewRows.slice(0, 200),
    many_to_many_examples: {
      field_to_many_cadastres: manyToMany.field_to_many_cadastres.slice(0, 30),
      cadastre_to_many_fields: manyToMany.cadastre_to_many_fields.slice(0, 30),
      cadastre_to_many_crops: manyToMany.cadastre_to_many_crops.slice(0, 30),
    },
  };

  const outputDir = path.join(projectRoot, "scripts", "output");
  mkdirSync(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(outputDir, `land-legal-docx-dry-run-${stamp}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        output_path: outPath,
        summary: report.summary,
        company_breakdown: report.company_breakdown,
        manual_required_count: report.summary.manual_required_count,
        unresolved_count: report.summary.unresolved_count,
        warnings_count: report.warnings.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("[land-legal-docx-dry-run] failed:", error.message);
  process.exit(1);
});
