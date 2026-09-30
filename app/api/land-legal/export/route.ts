import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import {
  getBreakdownRowsForCompany,
} from "@/lib/land-legal/breakdown";
import { isUuidLike } from "@/lib/land-legal/normalizers";
import { landLegalErrorResponse, resolveLandLegalContext } from "@/lib/land-legal/server";

type ReportType =
  | "legal_breakdown"
  | "cadastres"
  | "owners"
  | "rural_districts"
  | "crops"
  | "missing_cadastre"
  | "missing_owner"
  | "mismatches";

const OWNER_NOT_SET_LABEL = "Нет данных";
const DISTRICT_NOT_SET_LABEL = "Нет данных";
const CROP_NOT_SET_LABEL = "Культура не указана";
const CADASTRE_NOT_SET_LABEL = "Нет данных";

function parseReportType(value: string | null): ReportType {
  const normalized = String(value || "legal_breakdown").trim();
  const allowed = new Set<ReportType>([
    "legal_breakdown",
    "cadastres",
    "owners",
    "rural_districts",
    "crops",
    "missing_cadastre",
    "missing_owner",
    "mismatches",
  ]);
  return allowed.has(normalized as ReportType) ? (normalized as ReportType) : "legal_breakdown";
}

function parseNullableFilter(value: string | null): string | null {
  const raw = String(value || "").trim();
  if (!raw || raw === "__all") return null;
  if (raw === "__missing") return "__missing";
  return raw;
}

function parseBooleanFlag(value: string | null): boolean | null {
  if (value == null) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  if (["1", "true", "yes", "да"].includes(raw)) return true;
  if (["0", "false", "no", "нет"].includes(raw)) return false;
  return null;
}

function seasonFileSuffix(seasonYear: number | null, seasonId: string | null): string {
  if (seasonYear) return `${seasonYear}`;
  if (seasonId) return seasonId.slice(0, 8);
  return "season";
}

function fileNameByType(reportType: ReportType, seasonSuffix: string): string {
  if (reportType === "legal_breakdown") return `land-legal-${seasonSuffix}.xlsx`;
  if (reportType === "cadastres") return `land-legal-cadastres-${seasonSuffix}.xlsx`;
  if (reportType === "owners") return `land-legal-owners-${seasonSuffix}.xlsx`;
  if (reportType === "rural_districts") return `land-legal-rural-districts-${seasonSuffix}.xlsx`;
  if (reportType === "crops") return `land-legal-crops-${seasonSuffix}.xlsx`;
  if (reportType === "missing_cadastre") return `land-legal-missing-cadastre-${seasonSuffix}.xlsx`;
  if (reportType === "missing_owner") return `land-legal-missing-owner-${seasonSuffix}.xlsx`;
  return `land-legal-mismatches-${seasonSuffix}.xlsx`;
}

function sheetNameByType(reportType: ReportType): string {
  if (reportType === "legal_breakdown") return "Юр разбивка";
  if (reportType === "cadastres") return "Кадастры";
  if (reportType === "owners") return "Владельцы";
  if (reportType === "rural_districts") return "Округа";
  if (reportType === "crops") return "Культуры";
  if (reportType === "missing_cadastre") return "Без кадастра";
  if (reportType === "missing_owner") return "Без владельца";
  return "Расхождения";
}

function fitColumns(worksheet: ExcelJS.Worksheet) {
  worksheet.columns?.forEach((column) => {
    let maxLength = 10;
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      const value = cell.value == null ? "" : String(cell.value);
      if (value.length > maxLength) maxLength = Math.min(60, value.length + 2);
    });
    column.width = maxLength;
  });
}

function styleSheet(worksheet: ExcelJS.Worksheet) {
  const header = worksheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  if ((worksheet.columnCount || 0) > 0 && worksheet.rowCount > 0) {
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: worksheet.columnCount },
    };
  }
  fitColumns(worksheet);
}

function coverageStatusLabel(row: { row_source: string; missing_cadastre: boolean; owner_name: string | null }): string {
  if (row.row_source === "crop_structure_gap") return "Без юр покрытия";
  if (row.missing_cadastre) return "Без кадастра";
  if (!row.owner_name) return "Без владельца";
  return "Полное покрытие";
}

export async function GET(request: NextRequest) {
  try {
    const context = await resolveLandLegalContext(request, { write: false });
    const { supabase, companyId } = context;

    const params = request.nextUrl.searchParams;
    const reportType = parseReportType(params.get("report_type"));
    const search = String(params.get("search") || "").trim().toLowerCase();
    const fieldFilter = parseNullableFilter(params.get("field"));
    const ownerFilter = parseNullableFilter(params.get("owner"));
    const districtFilter = parseNullableFilter(params.get("rural_district"));
    const cropFilter = parseNullableFilter(params.get("crop"));
    const cadastreFilter = parseNullableFilter(params.get("cadastre"));
    const hasCadastre = parseBooleanFlag(params.get("has_cadastre"));
    const hasOwner = parseBooleanFlag(params.get("has_owner"));
    const hasDistrict = parseBooleanFlag(params.get("has_rural_district"));

    let seasonId: string | null = null;
    let seasonYear: number | null = null;

    const seasonIdRaw = String(params.get("season_id") || "").trim();
    const seasonYearRaw = String(params.get("season_year") || "").trim();

    if (isUuidLike(seasonIdRaw)) {
      seasonId = seasonIdRaw;
    } else if (seasonYearRaw) {
      const parsedYear = Number(seasonYearRaw);
      if (Number.isFinite(parsedYear)) {
        const seasonRes = await supabase
          .from("seasons")
          .select("id, year")
          .eq("company_id", companyId)
          .eq("year", parsedYear)
          .maybeSingle();
        if (seasonRes.data?.id) {
          seasonId = String(seasonRes.data.id);
          seasonYear = Number(seasonRes.data.year || parsedYear);
        }
      }
    }

    if (seasonId && seasonYear == null) {
      const seasonRes = await supabase.from("seasons").select("year").eq("id", seasonId).maybeSingle();
      seasonYear = seasonRes.data?.year ? Number(seasonRes.data.year) : null;
    }

    const dataset = await getBreakdownRowsForCompany({ supabase, companyId, seasonId });
    const rawRows = dataset.canonicalRows;

    const filteredRows = rawRows.filter((row) => {
      const fieldName = row.field_display_name || "";
      const ownerName = row.owner_name || "";
      const district = row.rural_district || "";
      const cropName = row.crop_name || "";
      const cadastre = row.cadastral_number || "";

      if (fieldFilter) {
        if (fieldFilter === "__missing") {
          if (fieldName) return false;
        } else if (fieldName !== fieldFilter) {
          return false;
        }
      }

      if (ownerFilter) {
        if (ownerFilter === "__missing") {
          if (ownerName) return false;
        } else if ((ownerName || OWNER_NOT_SET_LABEL) !== ownerFilter) {
          return false;
        }
      }

      if (districtFilter) {
        if (districtFilter === "__missing") {
          if (district) return false;
        } else if ((district || DISTRICT_NOT_SET_LABEL) !== districtFilter) {
          return false;
        }
      }

      if (cropFilter) {
        if (cropFilter === "__missing") {
          if (cropName) return false;
        } else if ((cropName || CROP_NOT_SET_LABEL) !== cropFilter) {
          return false;
        }
      }

      if (cadastreFilter) {
        if (cadastreFilter === "__missing") {
          if (cadastre) return false;
        } else if ((cadastre || CADASTRE_NOT_SET_LABEL) !== cadastreFilter) {
          return false;
        }
      }

      if (hasCadastre !== null && Boolean(cadastre) !== hasCadastre) return false;
      if (hasOwner !== null && Boolean(ownerName) !== hasOwner) return false;
      if (hasDistrict !== null && Boolean(district) !== hasDistrict) return false;

      if (!search) return true;
      return [fieldName, ownerName, district, cropName, cadastre, row.technical_key || "", row.original_field_key || ""]
        .join(" ")
        .toLowerCase()
        .includes(search);
    });

    const filteredLegalRows = filteredRows.filter((row) => row.row_source !== "crop_structure_gap");

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Travkin Flow";
    workbook.created = new Date();
    const worksheet = workbook.addWorksheet(sheetNameByType(reportType));

    if (reportType === "legal_breakdown" || reportType === "missing_cadastre" || reportType === "missing_owner") {
      const rows = (reportType === "legal_breakdown" ? filteredRows : filteredLegalRows).filter((row) => {
        if (reportType === "missing_cadastre") return !row.cadastral_number;
        if (reportType === "missing_owner") return !row.owner_name;
        return true;
      });

      worksheet.columns = [
        { header: "Поле", key: "field", width: 16 },
        { header: "Владелец / юрконтур", key: "owner", width: 28 },
        { header: "Сельский округ", key: "district", width: 22 },
        { header: "Площадь, га", key: "area", width: 14 },
        { header: "Культура / land use", key: "crop", width: 24 },
        { header: "Кадастр", key: "cadastre", width: 22 },
        { header: "Статус покрытия", key: "coverage", width: 20 },
        { header: "Источник", key: "source", width: 26 },
      ];

      rows.forEach((row) => {
        worksheet.addRow({
          field: row.field_display_name || "Нет данных",
          owner: row.owner_name || OWNER_NOT_SET_LABEL,
          district: row.rural_district || DISTRICT_NOT_SET_LABEL,
          area: Number(row.area_ha || 0),
          crop: row.crop_name || CROP_NOT_SET_LABEL,
          cadastre: row.cadastral_number || CADASTRE_NOT_SET_LABEL,
          coverage: coverageStatusLabel(row),
          source: row.source_document || row.row_source,
        });
      });

      const total = rows.reduce((sum, row) => sum + Number(row.area_ha || 0), 0);
      worksheet.addRow({});
      worksheet.addRow({
        field: "Итого",
        area: total,
      });
    } else if (reportType === "cadastres") {
      const grouped = new Map<
        string,
        {
          cadastralNumber: string;
          districts: Set<string>;
          owners: Set<string>;
          fields: Set<string>;
          crops: Set<string>;
          area: number;
        }
      >();

      filteredLegalRows.forEach((row) => {
        if (!row.cadastral_number) return;
        const key = row.cadastral_number;
        const current = grouped.get(key) || {
          cadastralNumber: row.cadastral_number,
          districts: new Set<string>(),
          owners: new Set<string>(),
          fields: new Set<string>(),
          crops: new Set<string>(),
          area: 0,
        };
        if (row.rural_district) current.districts.add(row.rural_district);
        if (row.owner_name) current.owners.add(row.owner_name);
        if (row.field_display_name) current.fields.add(row.field_display_name);
        if (row.crop_name) current.crops.add(row.crop_name);
        current.area += Number(row.area_ha || 0);
        grouped.set(key, current);
      });

      worksheet.columns = [
        { header: "Кадастр", key: "cadastre", width: 24 },
        { header: "Сельский округ", key: "district", width: 22 },
        { header: "Владелец / юрконтур", key: "owner", width: 28 },
        { header: "Связанные поля", key: "fields", width: 26 },
        { header: "Связанные культуры", key: "crops", width: 30 },
        { header: "Площадь связей, га", key: "area", width: 16 },
      ];

      Array.from(grouped.values())
        .sort((a, b) => a.cadastralNumber.localeCompare(b.cadastralNumber, "ru"))
        .forEach((item) => {
          worksheet.addRow({
            cadastre: item.cadastralNumber,
            district: item.districts.size ? Array.from(item.districts).join(", ") : DISTRICT_NOT_SET_LABEL,
            owner: item.owners.size ? Array.from(item.owners).join(", ") : OWNER_NOT_SET_LABEL,
            fields: item.fields.size ? Array.from(item.fields).join(", ") : "Нет данных",
            crops: item.crops.size ? Array.from(item.crops).join(", ") : CROP_NOT_SET_LABEL,
            area: Number(item.area.toFixed(3)),
          });
        });
    } else if (reportType === "owners") {
      const grouped = new Map<
        string,
        { ownerName: string; area: number; fields: Set<string>; cadastres: Set<string>; missingCadastre: number }
      >();

      dataset.legalEntitiesRaw.forEach((entity: any) => {
        grouped.set(String(entity.name), {
          ownerName: String(entity.name),
          area: 0,
          fields: new Set<string>(),
          cadastres: new Set<string>(),
          missingCadastre: 0,
        });
      });

      filteredLegalRows.forEach((row) => {
        const owner = row.owner_name || OWNER_NOT_SET_LABEL;
        const current = grouped.get(owner) || {
          ownerName: owner,
          area: 0,
          fields: new Set<string>(),
          cadastres: new Set<string>(),
          missingCadastre: 0,
        };
        current.area += Number(row.area_ha || 0);
        if (row.field_display_name) current.fields.add(row.field_display_name);
        if (row.cadastral_number) current.cadastres.add(row.cadastral_number);
        else current.missingCadastre += 1;
        grouped.set(owner, current);
      });

      worksheet.columns = [
        { header: "Владелец / юрконтур", key: "owner", width: 30 },
        { header: "Общая площадь, га", key: "area", width: 18 },
        { header: "Количество полей", key: "fieldCount", width: 18 },
        { header: "Количество кадастров", key: "cadastreCount", width: 20 },
        { header: "Строк без кадастра", key: "missingCadastre", width: 18 },
      ];

      Array.from(grouped.values())
        .sort((a, b) => b.area - a.area || a.ownerName.localeCompare(b.ownerName, "ru"))
        .forEach((row) => {
          worksheet.addRow({
            owner: row.ownerName,
            area: Number(row.area.toFixed(3)),
            fieldCount: row.fields.size,
            cadastreCount: row.cadastres.size,
            missingCadastre: row.missingCadastre,
          });
        });
    } else if (reportType === "rural_districts") {
      const grouped = new Map<
        string,
        { district: string; area: number; fields: Set<string>; cadastres: Set<string>; owners: Set<string> }
      >();

      filteredLegalRows.forEach((row) => {
        const district = row.rural_district || DISTRICT_NOT_SET_LABEL;
        const current = grouped.get(district) || {
          district,
          area: 0,
          fields: new Set<string>(),
          cadastres: new Set<string>(),
          owners: new Set<string>(),
        };
        current.area += Number(row.area_ha || 0);
        if (row.field_display_name) current.fields.add(row.field_display_name);
        if (row.cadastral_number) current.cadastres.add(row.cadastral_number);
        if (row.owner_name) current.owners.add(row.owner_name);
        grouped.set(district, current);
      });

      worksheet.columns = [
        { header: "Сельский округ", key: "district", width: 24 },
        { header: "Площадь, га", key: "area", width: 16 },
        { header: "Количество полей", key: "fields", width: 18 },
        { header: "Количество кадастров", key: "cadastres", width: 20 },
        { header: "Количество владельцев", key: "owners", width: 20 },
      ];

      Array.from(grouped.values())
        .sort((a, b) => b.area - a.area || a.district.localeCompare(b.district, "ru"))
        .forEach((row) => {
          worksheet.addRow({
            district: row.district,
            area: Number(row.area.toFixed(3)),
            fields: row.fields.size,
            cadastres: row.cadastres.size,
            owners: row.owners.size,
          });
        });
    } else if (reportType === "crops") {
      const grouped = new Map<
        string,
        { crop: string; area: number; fields: Set<string>; cadastres: Set<string>; owners: Set<string> }
      >();

      filteredLegalRows.forEach((row) => {
        const crop = row.crop_name || CROP_NOT_SET_LABEL;
        const current = grouped.get(crop) || {
          crop,
          area: 0,
          fields: new Set<string>(),
          cadastres: new Set<string>(),
          owners: new Set<string>(),
        };
        current.area += Number(row.area_ha || 0);
        if (row.field_display_name) current.fields.add(row.field_display_name);
        if (row.cadastral_number) current.cadastres.add(row.cadastral_number);
        if (row.owner_name) current.owners.add(row.owner_name);
        grouped.set(crop, current);
      });

      worksheet.columns = [
        { header: "Культура / land use", key: "crop", width: 24 },
        { header: "Площадь, га", key: "area", width: 16 },
        { header: "Количество полей", key: "fields", width: 18 },
        { header: "Количество кадастров", key: "cadastres", width: 20 },
        { header: "Количество владельцев", key: "owners", width: 20 },
      ];

      Array.from(grouped.values())
        .sort((a, b) => b.area - a.area || a.crop.localeCompare(b.crop, "ru"))
        .forEach((row) => {
          worksheet.addRow({
            crop: row.crop,
            area: Number(row.area.toFixed(3)),
            fields: row.fields.size,
            cadastres: row.cadastres.size,
            owners: row.owners.size,
          });
        });
    } else {
      const fieldDisplayById = new Map(dataset.fields.map((field) => [field.id, field.name]));
      let mismatchQuery = supabase
        .from("v_land_area_mismatches")
        .select("*")
        .eq("company_id", companyId)
        .order("field_name");
      if (seasonId) mismatchQuery = mismatchQuery.eq("season_id", seasonId);
      const mismatchRes = await mismatchQuery;
      if (mismatchRes.error) {
        return NextResponse.json({ error: mismatchRes.error.message }, { status: 400 });
      }

      worksheet.columns = [
        { header: "Поле", key: "field", width: 18 },
        { header: "Агро-площадь, га", key: "agro", width: 18 },
        { header: "Юр-площадь, га", key: "legal", width: 18 },
        { header: "Разница, га", key: "diff", width: 14 },
        { header: "Статус", key: "status", width: 20 },
      ];

      (mismatchRes.data || []).forEach((row: any) => {
        worksheet.addRow({
          field: fieldDisplayById.get(String(row.field_id || "")) || String(row.field_name || "Нет данных"),
          agro: Number(row.agro_area_ha || 0),
          legal: Number(row.legal_area_ha || 0),
          diff: Number(row.diff_area_ha || 0),
          status: String(row.mismatch_status || "warning"),
        });
      });
    }

    styleSheet(worksheet);
    const buffer = await workbook.xlsx.writeBuffer();
    const seasonSuffix = seasonFileSuffix(seasonYear, seasonId);
    const fileName = fileNameByType(reportType, seasonSuffix);

    return new NextResponse(Buffer.from(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return landLegalErrorResponse(error);
  }
}
