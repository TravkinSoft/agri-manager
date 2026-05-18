#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_COMPANY_ID = "10000000-0000-0000-0000-000000000001";
const SEASON_YEAR = 2026;

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

function parsePositive(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  const raw = String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(",", ".");
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function rowHash(row) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        source_document: row.source_document || "",
        row_no: row.row_no || 0,
        field: row.field || "",
        crop: row.crop || "",
        cadastre: row.cadastral_number || "",
        area: row.area_ha || 0,
      }),
    )
    .digest("hex");
}

function linkKey({ seasonId, fieldId, cadastreKey, cropId, areaHa }) {
  return [seasonId, fieldId, cadastreKey, cropId || "none", Number(areaHa).toFixed(3)].join("|");
}

async function main() {
  const args = parseArgs(process.argv);
  const reportPath = args["dry-run-report"];
  if (!reportPath) {
    throw new Error("Use --dry-run-report <path-to-json>");
  }

  const confirm = String(args.confirm || "").toLowerCase() === "yes";
  if (!confirm) {
    throw new Error("Set --confirm yes to execute import");
  }

  const projectRoot = process.cwd();
  loadEnv(projectRoot);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const report = JSON.parse(readFileSync(path.resolve(reportPath), "utf8").replace(/^\uFEFF/, ""));
  const summary = report.summary || {};
  if (summary.conflicts !== 0 || summary.remaining_manual_required !== 0) {
    throw new Error(
      `Dry-run baseline is not clean: conflicts=${summary.conflicts}, remaining_manual_required=${summary.remaining_manual_required}`,
    );
  }

  const companyId = String(args["company-id"] || DEFAULT_COMPANY_ID);
  const preparedRows = Array.isArray(report.prepared_rows) ? report.prepared_rows : [];
  if (!preparedRows.length) {
    throw new Error("Dry-run report has no prepared_rows. Re-run dry-run with updated script.");
  }

  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select("id,year")
    .eq("company_id", companyId)
    .eq("year", SEASON_YEAR)
    .single();
  if (seasonError || !season?.id) throw new Error(`Season ${SEASON_YEAR} not found for company`);
  const seasonId = String(season.id);

  const sourceName = "land-legal-confirm-from-dry-run";
  const { data: batch, error: batchError } = await supabase
    .from("import_batches")
    .insert({
      company_id: companyId,
      import_type: "land_legal_docx_2026",
      source_file_name: sourceName,
      source_sheet_name: "legal-docx",
      source_file_path: String(reportPath),
      status: "executed",
      dry_run_report: report,
      execute_report: {},
      warnings_count: 0,
      errors_count: 0,
      created_by_user_id: null,
    })
    .select("id")
    .single();
  if (batchError || !batch?.id) throw new Error(`import_batch create failed: ${batchError?.message || "unknown"}`);
  const importBatchId = String(batch.id);

  const warnings = [];
  const errors = [];
  let createdCadastres = 0;
  let createdLegalEntities = 0;
  let insertedLinks = 0;
  let skippedRows = 0;

  const { data: cadRows } = await supabase
    .from("cadastral_parcels")
    .select("id,cadastral_number")
    .eq("company_id", companyId)
    .eq("archived", false);
  const cadastreIdByKey = new Map();
  for (const row of cadRows || []) cadastreIdByKey.set(normalizeCadastre(row.cadastral_number), String(row.id));

  const { data: entitiesRows } = await supabase
    .from("legal_entities")
    .select("id,name")
    .eq("company_id", companyId)
    .eq("archived", false);
  const entityIdByName = new Map();
  for (const row of entitiesRows || []) entityIdByName.set(normalizeText(row.name), String(row.id));

  const { data: existingLinksRows } = await supabase
    .from("field_cadastre_links")
    .select("season_id,field_id,crop_id,area_ha,cadastral_parcel_id,status")
    .eq("company_id", companyId)
    .eq("season_id", seasonId)
    .neq("status", "archived");
  const existingLinkKeys = new Set();
  for (const link of existingLinksRows || []) {
    const cadId = String(link.cadastral_parcel_id || "");
    const cadKey = [...cadastreIdByKey.entries()].find(([, id]) => id === cadId)?.[0];
    if (!cadKey) continue;
    existingLinkKeys.add(
      linkKey({
        seasonId,
        fieldId: String(link.field_id),
        cadastreKey: cadKey,
        cropId: link.crop_id ? String(link.crop_id) : null,
        areaHa: Number(link.area_ha || 0),
      }),
    );
  }
  const seenNew = new Set();

  const ensureUsageEntity = async (name) => {
    const keyName = normalizeText(name || "");
    if (!keyName) return null;
    const existing = entityIdByName.get(keyName);
    if (existing) return existing;
    const { data, error } = await supabase
      .from("legal_entities")
      .insert({
        company_id: companyId,
        name,
        entity_type: "company",
        is_active: true,
        archived: false,
        notes: "Auto-created from legal confirm import",
      })
      .select("id,name")
      .single();
    if (error || !data?.id) {
      warnings.push(`Usage legal entity create failed: ${name}`);
      return null;
    }
    createdLegalEntities += 1;
    const id = String(data.id);
    entityIdByName.set(keyName, id);
    return id;
  };

  const confirmRows = preparedRows.filter((r) => String(r.season_id || "") === seasonId);
  for (const row of confirmRows) {
    const rowNo = Number(row.row_no || 0);
    const rowWarnings = [];
    const rowErrors = [];

    const hash = rowHash(row);
    const cadastreKey = normalizeCadastre(row.cadastral_number);
    const area = parsePositive(row.area_ha);
    const fieldId = String(row.field_id || "");
    const cropId = String(row.crop_id || "");
    const usageEntityName = row.inferred_usage_legal_entity_name || null;

    let status = "parsed";
    let cadastreId = cadastreIdByKey.get(cadastreKey) || null;
    let usageEntityId = await ensureUsageEntity(usageEntityName);

    if (row.status === "skip_manual" || row.can_insert === false) {
      status = "skipped";
      skippedRows += 1;
      rowWarnings.push(String(row.reason || "manual skip"));
    } else if (!fieldId || !cropId || !cadastreKey || !area) {
      status = "skipped";
      skippedRows += 1;
      rowWarnings.push("missing field/crop/cadastre/area");
    } else {
      if (!cadastreId) {
        const { data, error } = await supabase
          .from("cadastral_parcels")
          .insert({
            company_id: companyId,
            cadastral_number: row.cadastral_number,
            declared_area_ha: area,
            rural_district: row.rural_district || null,
            ownership_status: "imported_usage",
            current_user_legal_entity_id: usageEntityId,
            source: row.source_mode || "import_docx",
            source_document: row.source_document || sourceName,
            notes: "Auto-created from confirmed dry-run import",
            is_active: true,
            archived: false,
          })
          .select("id,cadastral_number")
          .single();
        if (error || !data?.id) {
          status = "error";
          rowErrors.push(`cadastre create failed: ${row.cadastral_number}`);
        } else {
          cadastreId = String(data.id);
          cadastreIdByKey.set(cadastreKey, cadastreId);
          createdCadastres += 1;
        }
      }

      if (status !== "error" && cadastreId) {
        const key = linkKey({ seasonId, fieldId, cadastreKey, cropId, areaHa: area });
        if (existingLinkKeys.has(key) || seenNew.has(key)) {
          status = "skipped";
          skippedRows += 1;
          rowWarnings.push("duplicate link key");
        } else {
          const { error: linkError } = await supabase.from("field_cadastre_links").insert({
            company_id: companyId,
            season_id: seasonId,
            field_id: fieldId,
            cadastral_parcel_id: cadastreId,
            crop_id: cropId,
            area_ha: area,
            usage_legal_entity_id: usageEntityId,
            allocation_method: "imported",
            source: row.source_mode || "import_docx",
            source_document: row.source_document || sourceName,
            raw_field_key: normalizeText(row.field),
            raw_crop_name: normalizeText(row.crop),
            source_row_hash: hash,
            import_batch_id: importBatchId,
            status: "active",
            notes: `Confirmed import row ${rowNo}`,
          });
          if (linkError) {
            status = "error";
            rowErrors.push(`link insert failed: ${linkError.message}`);
          } else {
            status = rowWarnings.length ? "warning" : "imported";
            insertedLinks += 1;
            seenNew.add(key);
          }
        }
      }
    }

    if (rowWarnings.length) warnings.push(...rowWarnings.map((w) => `row ${rowNo}: ${w}`));
    if (rowErrors.length) errors.push(...rowErrors.map((e) => `row ${rowNo}: ${e}`));

    await supabase.from("import_batch_rows").insert({
      import_batch_id: importBatchId,
      company_id: companyId,
      row_index: rowNo,
      original_field_key: normalizeText(row.field || null),
      resolved_field_name: normalizeText(row.suggested_match || null),
      source_row_hash: hash,
      row_payload: {
        row_no: rowNo,
        field: row.field,
        crop: row.crop,
        cadastral_number: row.cadastral_number,
        rural_district: row.rural_district,
        area_ha: row.area_ha,
        raw: row.raw || {},
      },
      normalized_payload: {
        field_id: row.field_id || null,
        crop_id: row.crop_id || null,
        source_document: row.source_document || sourceName,
        source_mode: row.source_mode || "import_docx",
        inferred_usage_legal_entity_name: usageEntityName,
        can_insert: row.can_insert,
        field_candidates: row.field_candidates || [],
      },
      warnings: rowWarnings,
      errors: rowErrors,
      status: rowErrors.length ? "error" : status,
    });
  }

  const executeReport = {
    season_id: seasonId,
    season_year: SEASON_YEAR,
    source_document: sourceName,
    inserted_links: insertedLinks,
    created_cadastres: createdCadastres,
    created_legal_entities: createdLegalEntities,
    skipped_rows: skippedRows,
    warnings_count: warnings.length,
    errors_count: errors.length,
  };

  await supabase
    .from("import_batches")
    .update({
      status: insertedLinks > 0 || createdCadastres > 0 ? "executed" : "failed",
      execute_report: executeReport,
      warnings_count: warnings.length,
      errors_count: errors.length,
    })
    .eq("id", importBatchId);

  const out = {
    ok: true,
    import_batch_id: importBatchId,
    inserted_links: insertedLinks,
    created_cadastres: createdCadastres,
    created_legal_entities: createdLegalEntities,
    skipped_rows: skippedRows,
    warnings_count: warnings.length,
    errors_count: errors.length,
    warnings,
    errors,
    report_path: reportPath,
  };

  const outputDir = path.join(projectRoot, "scripts", "output");
  mkdirSync(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(outputDir, `land-legal-confirm-result-${stamp}.json`);
  writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");

  console.log(JSON.stringify({ ...out, result_file: outPath }, null, 2));
}

main().catch((error) => {
  console.error("[land-legal-confirm-from-dry-run] failed:", error.message);
  process.exit(1);
});
