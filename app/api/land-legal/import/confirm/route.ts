import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  isUuidLike,
  normalizeCadastreNumber,
  normalizeComparable,
  normalizeText,
  parsePositiveNumber,
} from "@/lib/land-legal/normalizers";
import { landLegalErrorResponse, resolveLandLegalContext } from "@/lib/land-legal/server";
import type { LandImportPreviewRow, LinkSource } from "@/lib/types/land-legal";

const SEASON_IMPORT_YEAR = 2026;

type ImportRow = LandImportPreviewRow;

function inferSourceMode(fileName: string, fileType: string): LinkSource {
  const ext = String(fileName.split(".").pop() || "").toLowerCase();
  if (ext === "docx" || normalizeComparable(fileType).includes("word")) return "import_docx";
  if (ext === "xlsx" || normalizeComparable(fileType).includes("sheet")) return "import_excel";
  return "import_csv";
}

function stableRowHash(input: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function dedupeLinkKey(params: {
  seasonId: string;
  fieldId: string;
  cadastreKey: string;
  cropId: string | null;
  areaHa: number;
}): string {
  return [
    params.seasonId,
    params.fieldId,
    params.cadastreKey,
    params.cropId || "none",
    params.areaHa.toFixed(3),
  ].join("|");
}

export async function POST(request: NextRequest) {
  try {
    const context = await resolveLandLegalContext(request, { write: true });
    const { companyId, supabase, actor } = context;
    const body = await request.json();

    const seasonId = normalizeText(body.seasonId);
    if (!isUuidLike(seasonId)) {
      return NextResponse.json({ error: "Корректный seasonId обязателен" }, { status: 400 });
    }

    const { data: season, error: seasonError } = await supabase
      .from("seasons")
      .select("id,year")
      .eq("id", seasonId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (seasonError || !season) {
      return NextResponse.json({ error: seasonError?.message || "Сезон не найден для компании" }, { status: 400 });
    }
    if (Number(season.year) !== SEASON_IMPORT_YEAR) {
      return NextResponse.json(
        { error: `Импорт юридического контура разрешён только для сезона ${SEASON_IMPORT_YEAR}.` },
        { status: 400 }
      );
    }

    const fileName = normalizeText(body.fileName) || "land-legal-import";
    const fileType = normalizeText(body.fileType);
    const sourceMode = inferSourceMode(fileName, fileType);
    const rows = Array.isArray(body.rows) ? (body.rows as ImportRow[]) : [];
    if (!rows.length) {
      return NextResponse.json({ error: "Нет строк для подтверждения импорта" }, { status: 400 });
    }

    const createMissingCadastres = body.options?.create_missing_cadastres !== false;
    const createMissingLegalEntities = body.options?.create_missing_legal_entities !== false;
    const defaultUsageEntityName = normalizeText(body.options?.usage_legal_entity_name || "") || null;

    const existingCadastresRes = await supabase
      .from("cadastral_parcels")
      .select("id,cadastral_number")
      .eq("company_id", companyId)
      .eq("archived", false);
    if (existingCadastresRes.error) {
      return NextResponse.json({ error: existingCadastresRes.error.message }, { status: 400 });
    }

    const existingLinksRes = await supabase
      .from("field_cadastre_links")
      .select("field_id,cadastral_parcel_id,crop_id,area_ha,season_id,status")
      .eq("company_id", companyId)
      .eq("season_id", seasonId)
      .neq("status", "archived");
    if (existingLinksRes.error) {
      return NextResponse.json({ error: existingLinksRes.error.message }, { status: 400 });
    }

    const existingEntitiesRes = await supabase
      .from("legal_entities")
      .select("id,name")
      .eq("company_id", companyId)
      .eq("archived", false);
    if (existingEntitiesRes.error) {
      return NextResponse.json({ error: existingEntitiesRes.error.message }, { status: 400 });
    }

    const cadastreIdByKey = new Map<string, string>();
    const cadastreKeyById = new Map<string, string>();
    (existingCadastresRes.data || []).forEach((row: any) => {
      const key = normalizeCadastreNumber(row.cadastral_number);
      if (key) cadastreIdByKey.set(key, String(row.id));
      cadastreKeyById.set(String(row.id), key);
    });

    const legalEntityIdByName = new Map<string, string>();
    (existingEntitiesRes.data || []).forEach((row: any) => {
      const key = normalizeComparable(row.name);
      if (key) legalEntityIdByName.set(key, String(row.id));
    });

    const existingLinkKeys = new Set<string>();
    (existingLinksRes.data || []).forEach((row: any) => {
      const cadastreKey = cadastreKeyById.get(String(row.cadastral_parcel_id || ""));
      const area = Number(row.area_ha || 0);
      if (!cadastreKey || !(area > 0)) return;
      existingLinkKeys.add(
        dedupeLinkKey({
          seasonId,
          fieldId: String(row.field_id),
          cadastreKey,
          cropId: row.crop_id ? String(row.crop_id) : null,
          areaHa: area,
        })
      );
    });

    const importType = "land_legal_docx_2026";
    const { data: importBatch, error: importBatchError } = await supabase
      .from("import_batches")
      .insert({
        company_id: companyId,
        import_type: importType,
        source_file_name: fileName,
        source_sheet_name: "legal-docx",
        source_file_path: normalizeText(body.sourceFilePath) || null,
        status: "executed",
        dry_run_report: body.preview_report || body.preview || {},
        execute_report: {},
        warnings_count: 0,
        errors_count: 0,
        created_by_user_id: actor.authUserId || null,
      })
      .select("id")
      .single();

    if (importBatchError || !importBatch?.id) {
      return NextResponse.json({ error: importBatchError?.message || "Не удалось создать import batch" }, { status: 400 });
    }
    const importBatchId = String(importBatch.id);

    const warnings: string[] = [];
    const errors: string[] = [];
    const seenNewLinkKeys = new Set<string>();

    let createdCadastres = 0;
    let createdLegalEntities = 0;
    let insertedLinks = 0;
    let skippedRows = 0;

    const ensureLegalEntityId = async (name: string | null): Promise<string | null> => {
      const normalizedName = normalizeComparable(name || "");
      if (!normalizedName) return null;
      const existingId = legalEntityIdByName.get(normalizedName);
      if (existingId) return existingId;
      if (!createMissingLegalEntities) return null;

      const { data, error } = await supabase
        .from("legal_entities")
        .insert({
          company_id: companyId,
          name: name,
          entity_type: "company",
          is_active: true,
          archived: false,
          notes: "Auto-created from legal cadastral import",
        })
        .select("id,name")
        .single();
      if (error || !data?.id) {
        warnings.push(`Не удалось создать юрлицо "${name}": ${error?.message || "unknown error"}`);
        return null;
      }
      createdLegalEntities += 1;
      const createdId = String(data.id);
      legalEntityIdByName.set(normalizedName, createdId);
      return createdId;
    };

    for (const row of rows) {
      const rowNo = Number(row.row_no || 0) || 0;
      const rowWarnings = [...(Array.isArray(row.warnings) ? row.warnings : [])];
      const rowErrors: string[] = [];

      const fieldId = normalizeText(row.field_id);
      const area = parsePositiveNumber(row.area_ha);
      const cadastreRaw = normalizeText(row.cadastral_number);
      const cadastreKey = normalizeCadastreNumber(cadastreRaw);
      const cropId = isUuidLike(row.crop_id) ? String(row.crop_id) : null;
      const usageEntityName =
        normalizeText(row.inferred_usage_legal_entity_name) || defaultUsageEntityName || null;

      const sourceRowHash = stableRowHash({
        source_document: row.source_document || fileName,
        row_no: rowNo,
        field: row.field || "",
        cadastre: cadastreRaw,
        crop: row.crop || "",
        area: row.area_ha,
      });

      let status: "parsed" | "skipped" | "warning" | "imported" | "error" = "parsed";
      let resolvedCadastreId = isUuidLike(row.cadastral_parcel_id) ? String(row.cadastral_parcel_id) : null;

      if (row.can_insert === false) {
        status = "skipped";
        skippedRows += 1;
        rowWarnings.push("Строка помечена preview как non-insertable.");
      } else if (!isUuidLike(fieldId) || !area || !cadastreKey || !cropId) {
        status = "skipped";
        skippedRows += 1;
        rowWarnings.push("Строка пропущена: не хватает field/crop/cadastre/area.");
      } else {
        if (!resolvedCadastreId) {
          resolvedCadastreId = cadastreIdByKey.get(cadastreKey) || null;
        }

        const usageLegalEntityId = await ensureLegalEntityId(usageEntityName);

        if (!resolvedCadastreId) {
          if (!createMissingCadastres) {
            status = "skipped";
            skippedRows += 1;
            rowWarnings.push(`Кадастр ${cadastreRaw} не найден и автосоздание отключено.`);
          } else {
            const { data: createdCadastre, error: cadastreError } = await supabase
              .from("cadastral_parcels")
              .insert({
                company_id: companyId,
                cadastral_number: cadastreRaw,
                declared_area_ha: area,
                rural_district: normalizeText(row.rural_district) || null,
                ownership_status: "imported_usage",
                current_user_legal_entity_id: usageLegalEntityId,
                source: row.source_mode || sourceMode,
                source_document: row.source_document || fileName,
                notes: "Auto-created from legal import",
                is_active: true,
                archived: false,
              })
              .select("id,cadastral_number")
              .single();

            if (cadastreError || !createdCadastre?.id) {
              status = "error";
              rowErrors.push(`Не удалось создать кадастр ${cadastreRaw}: ${cadastreError?.message || "unknown error"}`);
            } else {
              createdCadastres += 1;
              resolvedCadastreId = String(createdCadastre.id);
              cadastreIdByKey.set(cadastreKey, resolvedCadastreId);
            }
          }
        }

        if (status !== "error" && resolvedCadastreId) {
          const key = dedupeLinkKey({
            seasonId,
            fieldId,
            cadastreKey,
            cropId,
            areaHa: area,
          });

          if (existingLinkKeys.has(key) || seenNewLinkKeys.has(key)) {
            status = "skipped";
            skippedRows += 1;
            rowWarnings.push("Точная связь уже существует (или дубликат в текущем batch).");
          } else {
            const usageLegalEntityId = await ensureLegalEntityId(usageEntityName);
            const { error: linkError } = await supabase.from("field_cadastre_links").insert({
              company_id: companyId,
              season_id: seasonId,
              field_id: fieldId,
              cadastral_parcel_id: resolvedCadastreId,
              crop_id: cropId,
              area_ha: area,
              usage_legal_entity_id: usageLegalEntityId,
              allocation_method: "imported",
              source: row.source_mode || sourceMode,
              source_document: row.source_document || fileName,
              raw_field_key: normalizeText(row.field || null),
              raw_crop_name: normalizeText(row.crop || null),
              source_row_hash: sourceRowHash,
              import_batch_id: importBatchId,
              status: "active",
              notes: `Импорт ${row.source_document || fileName}, строка ${rowNo || "?"}`,
            });

            if (linkError) {
              status = "error";
              rowErrors.push(`Не удалось создать связь: ${linkError.message}`);
            } else {
              status = rowWarnings.length > 0 ? "warning" : "imported";
              insertedLinks += 1;
              seenNewLinkKeys.add(key);
            }
          }
        }
      }

      if (rowErrors.length > 0) {
        errors.push(...rowErrors.map((item) => `Строка ${rowNo || "?"}: ${item}`));
      }
      if (rowWarnings.length > 0) {
        warnings.push(...rowWarnings.map((item) => `Строка ${rowNo || "?"}: ${item}`));
      }

      const rowPayload = {
        row_no: rowNo,
        field: row.field,
        cadastral_number: row.cadastral_number,
        rural_district: row.rural_district,
        crop: row.crop,
        area_ha: row.area_ha,
        raw: row.raw || {},
      };
      const normalizedPayload = {
        field_id: row.field_id,
        crop_id: row.crop_id,
        cadastral_parcel_id: row.cadastral_parcel_id,
        source_document: row.source_document || fileName,
        source_mode: row.source_mode || sourceMode,
        inferred_usage_legal_entity_name: row.inferred_usage_legal_entity_name || usageEntityName,
        can_insert: row.can_insert,
        field_candidates: row.field_candidates || [],
        crop_token: row.crop_token || null,
      };

      const batchRowInsert = await supabase.from("import_batch_rows").insert({
        import_batch_id: importBatchId,
        company_id: companyId,
        row_index: rowNo || 0,
        original_field_key: normalizeText(row.field || null),
        resolved_field_name: normalizeText(
          row.field_candidates && row.field_candidates.length === 1 ? row.field_candidates[0] : null
        ),
        source_row_hash: sourceRowHash,
        row_payload: rowPayload,
        normalized_payload: normalizedPayload,
        warnings: rowWarnings,
        errors: rowErrors,
        status: rowErrors.length > 0 ? "error" : status,
      });
      if (batchRowInsert.error) {
        errors.push(
          `Строка ${rowNo || "?"}: не удалось записать import_batch_rows (${batchRowInsert.error.message})`
        );
      }
    }

    const finalStatus: "executed" | "failed" = insertedLinks > 0 || createdCadastres > 0 ? "executed" : "failed";
    const executeReport = {
      season_id: seasonId,
      season_year: season.year,
      source_document: fileName,
      source_mode: sourceMode,
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
        status: finalStatus,
        execute_report: executeReport,
        warnings_count: warnings.length,
        errors_count: errors.length,
      })
      .eq("id", importBatchId);

    return NextResponse.json({
      import_batch_id: importBatchId,
      inserted_links: insertedLinks,
      created_cadastres: createdCadastres,
      created_legal_entities: createdLegalEntities,
      skipped_rows: skippedRows,
      warnings,
      errors,
    });
  } catch (error) {
    return landLegalErrorResponse(error);
  }
}
