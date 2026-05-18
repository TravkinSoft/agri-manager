#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_COMPANY_ID = "10000000-0000-0000-0000-000000000001";
const DEFAULT_SHEET = "2026";

function resolveDefaultXlsxPath() {
  const downloadsDir = "C:\\Users\\TRAVKIN\\Downloads";
  const files = readdirSync(downloadsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".xlsx"))
    .map((entry) => entry.name);

  const prioritized = files.find((name) => /структур.*2026/i.test(name));
  if (prioritized) return path.join(downloadsDir, prioritized);

  const fallback = files.find((name) => !/travkin_legal_master_list_2026\.xlsx/i.test(name));
  if (fallback) return path.join(downloadsDir, fallback);
  return path.join(downloadsDir, "Структура посева 2026.xlsx");
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

function asNonEmpty(value) {
  const text = String(value || "").trim();
  return text.length ? text : null;
}

function parseBool(value, fallback = false) {
  if (value == null) return fallback;
  const v = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "y"].includes(v);
}

function isSummaryToken(value) {
  const text = String(value || "").trim().toLowerCase();
  return text === "итого" || text === "всего";
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
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
  );

  if (result.status !== 0) {
    const details = {
      status: result.status,
      signal: result.signal,
      error: result.error ? String(result.error.message || result.error) : null,
      stderr: String(result.stderr || ""),
      stdout_head: String(result.stdout || "").slice(0, 400),
    };
    throw new Error(`parse-xlsx-sheet failed: ${JSON.stringify(details)}`);
  }
  const output = String(result.stdout || "").trim();
  if (!output) throw new Error("parse-xlsx-sheet returned empty output");
  return JSON.parse(output);
}

function buildFieldTokenByRow(parsed) {
  const map = new Map();
  let lastExplicitField = null;
  const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
  for (const row of rows) {
    const rowIndex = Number(row?.rowIndex || 0);
    if (!Number.isFinite(rowIndex) || rowIndex <= 0) continue;
    const rawField = asNonEmpty(row?.cells?.["# - Поля"]);
    if (rawField && !isSummaryToken(rawField)) {
      lastExplicitField = rawField;
      map.set(rowIndex, rawField);
      continue;
    }
    if (!rawField && lastExplicitField) {
      map.set(rowIndex, lastExplicitField);
    }
  }
  return map;
}

function parseFieldMeta(notes) {
  const text = asNonEmpty(notes);
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const mode = args.mode || "dry-run";
  const execute = mode === "execute" || parseBool(args.execute, false);
  const projectRoot = process.cwd();
  loadEnv(projectRoot);

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env");
  }

  const companyId = args["company-id"] || DEFAULT_COMPANY_ID;
  const xlsxPath = args.file || resolveDefaultXlsxPath();
  const parsedJsonPath = args["parsed-json"] ? path.resolve(args["parsed-json"]) : null;
  const sheetName = args.sheet || DEFAULT_SHEET;

  const parsedSheet = parsedJsonPath
    ? JSON.parse(readFileSync(parsedJsonPath, "utf8").replace(/^\uFEFF/, ""))
    : runSheetParser(projectRoot, xlsxPath, sheetName);
  const tokenByRow = buildFieldTokenByRow(parsedSheet);

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { data: fields, error: fieldsError } = await supabase
    .from("fields")
    .select("id,name,notes,area,created_at")
    .eq("company_id", companyId)
    .eq("archived", false)
    .ilike("name", "System.Xml.XmlElement-%")
    .order("created_at");

  if (fieldsError) throw fieldsError;

  const plan = [];
  for (const field of fields || []) {
    const meta = parseFieldMeta(field.notes);
    const rowIndex = Number(meta.import_row_index || 0);
    const inferredOriginal = tokenByRow.get(rowIndex) || null;
    plan.push({
      id: field.id,
      current_name: field.name,
      area: Number(field.area || 0),
      import_row_index: Number.isFinite(rowIndex) ? rowIndex : null,
      current_original_field_key: asNonEmpty(meta.original_field_key),
      inferred_original_field_key: inferredOriginal,
      can_update: Boolean(inferredOriginal),
    });
  }

  const result = {
    mode: execute ? "execute" : "dry-run",
    company_id: companyId,
    xlsx_path: xlsxPath,
    parsed_json_path: parsedJsonPath,
    sheet: sheetName,
    matched_rows: plan.length,
    can_update: plan.filter((row) => row.can_update).length,
    unresolved: plan.filter((row) => !row.can_update).length,
    rows: plan,
  };

  if (!execute) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  let updated = 0;
  for (const row of plan) {
    if (!row.can_update) continue;
    const field = fields.find((item) => item.id === row.id);
    const meta = parseFieldMeta(field?.notes);
    const nextMeta = {
      ...meta,
      original_field_key: row.inferred_original_field_key,
      resolved_field_name: row.current_name,
      fixed_by_script: "fix-structure-garbage-field-keys.mjs",
      fixed_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from("fields")
      .update({ notes: JSON.stringify(nextMeta) })
      .eq("id", row.id);
    if (error) throw error;
    updated += 1;
  }

  console.log(
    JSON.stringify(
      {
        ...result,
        updated,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[fix-structure-garbage-field-keys] failed:", error?.message || error);
  process.exit(1);
});
