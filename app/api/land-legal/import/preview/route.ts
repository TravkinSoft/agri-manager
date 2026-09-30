import { NextRequest, NextResponse } from "next/server";
import { getFieldDisplayName, getFieldMetadata, getFieldTechnicalKey } from "@/lib/fields/display";
import { parseLandImportContent } from "@/lib/land-legal/import-parser";
import {
  isUuidLike,
  normalizeCadastreNumber,
  normalizeComparable,
  normalizeText,
} from "@/lib/land-legal/normalizers";
import { landLegalErrorResponse, resolveLandLegalContext } from "@/lib/land-legal/server";
import type { LandImportPreviewRow, LinkSource } from "@/lib/types/land-legal";

type FieldLite = { id: string; name: string; notes?: string | null };
type CropLite = { id: string; name: string; name_ru: string | null };

const SEASON_IMPORT_YEAR = 2026;

function inferDocumentYear(fileName: string): number | null {
  const match = String(fileName || "").match(/(20\d{2})/);
  return match ? Number(match[1]) : null;
}

function inferUsageLegalEntity(fileName: string): string | null {
  const normalized = normalizeComparable(fileName);
  if (normalized.includes("карагаш") || normalized.includes("karagash")) {
    return 'ТОО "Астык-Караагаш"';
  }
  if (normalized.includes("stem") || normalized.includes("стем")) {
    return 'ТОО "Астык-STEM"';
  }
  return null;
}

function inferSourceMode(fileName: string, fileType: string): LinkSource {
  const ext = String(fileName.split(".").pop() || "").toLowerCase();
  if (ext === "docx" || normalizeComparable(fileType).includes("word")) return "import_docx";
  if (ext === "xlsx" || normalizeComparable(fileType).includes("sheet")) return "import_excel";
  return "import_csv";
}

function normalizeFieldToken(value: string): string {
  return normalizeComparable(value)
    .replace(/№/g, "")
    .replace(/\bполе\b/g, "")
    .replace(/[()]/g, "-")
    .replace(/[\\/]/g, "-")
    .replace(/[^a-z0-9а-я-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildFieldAliases(name: string): string[] {
  const base = normalizeFieldToken(name);
  const result = new Set<string>();
  if (base) result.add(base);
  const digits = base.match(/\d+/g) || [];
  const hasKu = base.includes("ку") || base.includes("ku");

  if (digits.length > 0) {
    const firstDigit = digits[0];
    result.add(digits.join("-"));
    result.add(`${digits.join("-")}-1`);
    if (firstDigit) {
      result.add(firstDigit);
      result.add(`${firstDigit}-1`);
    }
  }
  if (hasKu && digits.length > 0) {
    const firstDigit = digits[0];
    result.add(`ку-${digits.join("-")}`);
    if (firstDigit) {
      result.add(`ку-${firstDigit}`);
    }
  }
  if (/^.+-\d+$/.test(base)) {
    const parts = base.split("-");
    parts.pop();
    result.add(parts.join("-"));
  }
  return Array.from(result).filter(Boolean);
}

function buildFieldCandidates(raw: string): string[] {
  return buildFieldAliases(raw);
}

function buildFieldMap(fields: FieldLite[]) {
  const aliasMap = new Map<string, Set<string>>();
  const byId = new Map<string, FieldLite>();
  const labelById = new Map<string, string>();
  const put = (alias: string, id: string) => {
    if (!aliasMap.has(alias)) aliasMap.set(alias, new Set<string>());
    aliasMap.get(alias)?.add(id);
  };

  (fields || []).forEach((field) => {
    byId.set(field.id, field);
    const display = getFieldDisplayName(field as any);
    const technical = getFieldTechnicalKey(field as any);
    const original = getFieldMetadata(field as any)?.original_field_key || "";
    labelById.set(field.id, technical !== display ? `${display} [${technical}]` : display);

    const variants = [field.name, display, technical, original].filter(Boolean);
    variants.forEach((value) => {
      buildFieldAliases(String(value)).forEach((alias) => put(alias, field.id));
    });
  });

  return { aliasMap, byId, labelById };
}

function resolveField(
  fieldRaw: string,
  aliasMap: Map<string, Set<string>>,
  byId: Map<string, FieldLite>,
  labelById: Map<string, string>,
) {
  const candidates = buildFieldCandidates(fieldRaw);
  const matchedIds = new Set<string>();
  candidates.forEach((candidate) => {
    const ids = aliasMap.get(candidate);
    if (!ids) return;
    ids.forEach((id) => matchedIds.add(id));
  });

  const matched = Array.from(matchedIds);
  if (matched.length === 1) {
    const row = byId.get(matched[0]);
    return {
      fieldId: matched[0],
      candidates: row ? [labelById.get(matched[0]) || row.name] : [],
      ambiguous: false,
    };
  }

  return {
    fieldId: null,
    candidates: matched.map((id) => labelById.get(id) || byId.get(id)?.name || id),
    ambiguous: matched.length > 1,
  };
}

const CROP_CANONICAL_ALIASES: Record<string, string> = {
  пшеница: "пшеница",
  пшеницы: "пшеница",
  ячмень: "ячмень",
  ячменя: "ячмень",
  овес: "овес",
  овёс: "овес",
  горох: "горох",
  гороха: "горох",
  картофель: "картофель",
  картофеля: "картофель",
  морковь: "морковь",
  моркови: "морковь",
  рапс: "рапс",
  рапса: "рапс",
  подсолнечник: "подсолнечник",
  подсолнечника: "подсолнечник",
  подсолн: "подсолнечник",
  лен: "лен",
  льна: "лен",
  лён: "лен",
  кукуруза: "кукуруза",
  "кукурузы на силос": "кукуруза на силос",
  "кукуруза на силос": "кукуруза на силос",
  "з/смесь": "травосмеси",
  "з\\смесь": "травосмеси",
  "з/смеси": "травосмеси",
  смесь: "травосмеси",
  травосмеси: "травосмеси",
  суданка: "суданская трава",
  "суданская трава": "суданская трава",
  "суданской травы": "суданская трава",
  "многолетние травы": "многолетние травы",
  "многолетние травы (костер)": "многолетние травы",
  "многолетние травы(житняк)": "многолетние травы",
  "бобов тр": "бобовые травы",
  "бобовые травы": "бобовые травы",
  пар: "пар",
  пары: "пар",
  полупар: "пар",
};

function normalizeCropToken(raw: string): string | null {
  const normalized = normalizeComparable(raw).replace(/ё/g, "е");
  if (!normalized) return null;
  if (normalized.includes("десикац")) return "__skip_desiccation__";
  if (normalized.includes("пшениц")) return "пшеница";
  if (normalized.includes("ячмен")) return "ячмень";
  if (normalized.includes("овес") || normalized.includes("овес")) return "овес";
  if (normalized.includes("горох")) return "горох";
  if (normalized.includes("картоф")) return "картофель";
  if (normalized.includes("морков")) return "морковь";
  if (normalized.includes("рапс")) return "рапс";
  if (normalized.includes("подсол")) return "подсолнечник";
  if (normalized.includes("кукуруз") && normalized.includes("силос")) return "кукуруза на силос";
  if (normalized.includes("кукуруз")) return "кукуруза";
  if (normalized.includes("судан")) return "суданская трава";
  if (normalized.includes("многолет") || normalized.includes("житняк")) return "многолетние травы";
  if (normalized.includes("бобов") && normalized.includes("трав")) return "бобовые травы";
  if (normalized.includes("з/см") || normalized.includes("з\\см") || normalized.includes("смесь")) return "травосмеси";
  if (normalized.includes("пар")) return "пар";
  return CROP_CANONICAL_ALIASES[normalized] || normalized;
}

function buildCropMap(crops: CropLite[]) {
  const map = new Map<string, string>();
  (crops || []).forEach((crop) => {
    const variants = [
      normalizeCropToken(crop.name || ""),
      normalizeCropToken(crop.name_ru || ""),
      normalizeComparable(crop.name || ""),
      normalizeComparable(crop.name_ru || ""),
    ].filter(Boolean) as string[];
    variants.forEach((variant) => {
      if (!map.has(variant)) map.set(variant, crop.id);
    });
  });
  return map;
}

function buildLinkKey(params: {
  seasonId: string;
  fieldId: string;
  cadastreKey: string;
  cropId: string | null;
  areaHa: number;
}) {
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
    const { companyId, supabase } = context;
    const body = await request.json();

    const fileName = normalizeText(body.fileName);
    const fileType = normalizeText(body.fileType);
    const contentBase64 = normalizeText(body.contentBase64);
    const seasonId = normalizeText(body.seasonId);
    const ignoreDocumentYearMismatch = body.options?.ignore_document_year_mismatch === true;

    if (!fileName || !contentBase64 || !isUuidLike(seasonId)) {
      return NextResponse.json({ error: "fileName, contentBase64 и корректный seasonId обязательны" }, { status: 400 });
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

    const [{ data: fields, error: fieldsError }, { data: crops, error: cropsError }, { data: cadastres, error: cadastresError }, { data: existingLinks, error: existingLinksError }] =
      await Promise.all([
        supabase
          .from("fields")
          .select("id,name,notes")
          .eq("company_id", companyId)
          .eq("archived", false),
        supabase
          .from("crops")
          .select("id,name,name_ru,company_id,archived,is_active")
          .or(`company_id.is.null,company_id.eq.${companyId}`)
          .eq("archived", false)
          .eq("is_active", true),
        supabase
          .from("cadastral_parcels")
          .select("id,cadastral_number")
          .eq("company_id", companyId)
          .eq("archived", false),
        supabase
          .from("field_cadastre_links")
          .select("field_id,cadastral_parcel_id,crop_id,area_ha,season_id,status")
          .eq("company_id", companyId)
          .eq("season_id", seasonId)
          .neq("status", "archived"),
      ]);

    if (fieldsError || cropsError || cadastresError || existingLinksError) {
      return NextResponse.json(
        {
          error:
            fieldsError?.message ||
            cropsError?.message ||
            cadastresError?.message ||
            existingLinksError?.message ||
            "Failed to load dictionaries",
        },
        { status: 400 }
      );
    }

    const parsed = parseLandImportContent({
      fileName,
      fileType,
      contentBase64,
      sheetName: body.sheetName || undefined,
    });

    const sourceMode = inferSourceMode(fileName, fileType);
    const inferredUsageEntity = inferUsageLegalEntity(fileName);
    const inferredDocumentYear = inferDocumentYear(fileName);
    const seasonYear = Number(season.year);
    const seasonMatch =
      inferredDocumentYear == null ||
      inferredDocumentYear === seasonYear ||
      ignoreDocumentYearMismatch;

    const resultWarnings = [...parsed.warnings];
    if (inferredDocumentYear != null && inferredDocumentYear !== seasonYear && !ignoreDocumentYearMismatch) {
      resultWarnings.push(
        `Год в документе (${inferredDocumentYear}) не совпадает с выбранным сезоном (${seasonYear}). По умолчанию строки помечены как non-insertable.`
      );
    }
    if (inferredUsageEntity) {
      resultWarnings.push(`Для документа определён usage-контекст юрлица: ${inferredUsageEntity}`);
    }

    const { aliasMap: fieldAliasMap, byId: fieldById, labelById } = buildFieldMap((fields || []) as FieldLite[]);
    const cropMap = buildCropMap((crops || []) as CropLite[]);
    const cadastreMap = new Map<string, string>();
    const cadastreNumberById = new Map<string, string>();
    (cadastres || []).forEach((row: any) => {
      const cadastreKey = normalizeCadastreNumber(row.cadastral_number);
      if (cadastreKey) cadastreMap.set(cadastreKey, String(row.id));
      cadastreNumberById.set(String(row.id), cadastreKey);
    });

    const existingLinkKeys = new Set<string>();
    (existingLinks || []).forEach((row: any) => {
      const cadastreKey = cadastreNumberById.get(String(row.cadastral_parcel_id || "")) || "";
      if (!row.field_id || !cadastreKey) return;
      const area = Number(row.area_ha || 0);
      if (!(area > 0)) return;
      existingLinkKeys.add(
        buildLinkKey({
          seasonId,
          fieldId: String(row.field_id),
          cadastreKey,
          cropId: row.crop_id ? String(row.crop_id) : null,
          areaHa: area,
        })
      );
    });

    const previewKeys = new Set<string>();
    const normalizedRows: LandImportPreviewRow[] = [];

    let unknownFields = 0;
    let unknownCrops = 0;
    let unknownCadastres = 0;
    let ambiguousFields = 0;
    let skippedBySeasonRule = 0;
    let linksToCreate = 0;
    let cadastresToCreate = 0;

    parsed.rows.forEach((row, index) => {
      const rowWarnings: string[] = [];
      const resolvedField = resolveField(row.field, fieldAliasMap, fieldById, labelById);
      const cropToken = normalizeCropToken(row.crop);
      const cropId = cropToken ? cropMap.get(cropToken) || null : null;
      const cadastreKey = normalizeCadastreNumber(row.cadastral_number);
      const cadastralParcelId = cadastreMap.get(cadastreKey) || null;
      const areaValid = Number(row.area_ha || 0) > 0;
      const seasonValid = seasonMatch;

      if (!resolvedField.fieldId) {
        if (resolvedField.ambiguous) {
          ambiguousFields += 1;
          rowWarnings.push(
            `Поле распознано неоднозначно: ${resolvedField.candidates.join(", ")}. Требуется ручной выбор.`
          );
        } else {
          unknownFields += 1;
          rowWarnings.push("Поле не найдено в текущей структуре.");
        }
      }

      if (!cropId) {
        if (cropToken === "__skip_desiccation__") {
          rowWarnings.push("Строка с десикацией пропущена по правилу импорта.");
        } else {
          unknownCrops += 1;
          rowWarnings.push("Культура не сопоставлена со справочником.");
        }
      }

      if (!cadastreKey) {
        rowWarnings.push("Пустой кадастровый номер.");
      } else if (!cadastralParcelId) {
        unknownCadastres += 1;
        cadastresToCreate += 1;
        rowWarnings.push("Кадастр не найден: будет создан при подтверждении.");
      }

      if (!areaValid) {
        rowWarnings.push("Некорректная площадь: требуется число > 0.");
      }

      if (!seasonValid) {
        skippedBySeasonRule += 1;
        rowWarnings.push("Строка не проходит правило сезона (разный год документа и выбранного сезона).");
      }

      let canInsert = Boolean(
        resolvedField.fieldId &&
          cropId &&
          cropToken !== "__skip_desiccation__" &&
          cadastreKey &&
          areaValid &&
          seasonValid
      );

      if (canInsert) {
        const candidateKey = buildLinkKey({
          seasonId,
          fieldId: String(resolvedField.fieldId),
          cadastreKey,
          cropId: String(cropId),
          areaHa: Number(row.area_ha),
        });
        if (existingLinkKeys.has(candidateKey)) {
          canInsert = false;
          rowWarnings.push("Точная связь уже существует в выбранном сезоне.");
        } else if (previewKeys.has(candidateKey)) {
          canInsert = false;
          rowWarnings.push("Дубликат строки внутри текущего импорта.");
        } else {
          previewKeys.add(candidateKey);
          linksToCreate += 1;
        }
      }

      normalizedRows.push({
        ...row,
        row_no: row.row_no || index + 1,
        source_document: row.source_document || fileName,
        source_company_hint: row.source_company_hint || (inferredUsageEntity ? "legal_usage" : null),
        inferred_usage_legal_entity_name: row.inferred_usage_legal_entity_name || inferredUsageEntity,
        field_id: resolvedField.fieldId,
        crop_id: cropId,
        cadastral_parcel_id: cadastralParcelId,
        source_mode: sourceMode,
        field_candidates: resolvedField.candidates,
        crop_token: cropToken,
        area_valid: areaValid,
        season_valid: seasonValid,
        can_insert: canInsert,
        warnings: rowWarnings,
      });
    });

    const warningRows = normalizedRows.filter((row) => row.warnings.length > 0).length;

    return NextResponse.json({
      normalized: normalizedRows,
      warnings: resultWarnings,
      stats: {
        total_rows: normalizedRows.length,
        valid_rows: normalizedRows.filter((row) => row.can_insert).length,
        warning_rows: warningRows,
        unknown_fields: unknownFields,
        unknown_crops: unknownCrops,
        unknown_cadastres: unknownCadastres,
        ambiguous_fields: ambiguousFields,
        skipped_by_season_rule: skippedBySeasonRule,
        links_to_create: linksToCreate,
        cadastres_to_create: cadastresToCreate,
      },
      detected: {
        source_document: fileName,
        source_mode: sourceMode,
        inferred_usage_legal_entity_name: inferredUsageEntity,
        inferred_document_year: inferredDocumentYear,
        season_year: seasonYear,
        season_match: seasonMatch,
      },
    });
  } catch (error) {
    return landLegalErrorResponse(error);
  }
}
