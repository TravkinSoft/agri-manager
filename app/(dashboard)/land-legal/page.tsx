"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Filter, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/contexts/auth-context";
import {
  inferOwnerBySourceDocument,
} from "@/lib/land-legal/breakdown";
import {
  downloadLandLegalExport,
  getLandLegalBootstrap,
  getLandLegalReports,
} from "@/lib/services/land-legal";
import type {
  CanonicalLegalBreakdownRow,
  CadastralParcel,
  LandAreaMismatchRow,
  LandSowingByCadastreRow,
  LegalEntity,
} from "@/lib/types/land-legal";

type Summary = {
  cadastral_count: number;
  legal_total_area_ha: number;
  legal_coverage_area_ha?: number;
  gap_total_area_ha?: number;
  unique_cadastral_area_ha?: number;
  agro_total_area_ha: number;
  mismatch_total_ha: number;
  active_documents: number;
  expiring_documents: number;
};

type MismatchStatus =
  | "ok"
  | "partial_legal_coverage"
  | "missing_cadastre"
  | "missing_owner"
  | "overallocated"
  | "underallocated";

type PresenceFilter = "all" | "yes" | "no";
type ReportMode = "sowing_by_cadastre" | "by_parcel" | "by_entity" | "mismatches";

const ROLE_CAN_VIEW = new Set(["global_admin", "company_admin", "director"]);
const FILTER_ALL = "__all";
const FILTER_MISSING = "__missing";
const OWNER_EMPTY_LABEL = "Нет данных";
const DISTRICT_EMPTY_LABEL = "Нет данных";
const CROP_EMPTY_LABEL = "Культура не указана";
const CADASTRE_EMPTY_LABEL = "Нет данных";
const OWNER_NOT_SET_LABEL = OWNER_EMPTY_LABEL;
const DISTRICT_NOT_SET_LABEL = DISTRICT_EMPTY_LABEL;
const CROP_NOT_SET_LABEL = CROP_EMPTY_LABEL;
const CADASTRE_NOT_SET_LABEL = CADASTRE_EMPTY_LABEL;

const fmtHa = (value: number) => `${value.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} га`;
const fmtDiff = (value: number) =>
  `${value > 0 ? "+" : ""}${value.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} га`;

function valueForFilter(value: string | null | undefined): string {
  const normalized = String(value || "").trim();
  return normalized.length ? normalized : FILTER_MISSING;
}

function displayValue(value: string | null | undefined, fallback: string): string {
  const normalized = String(value || "").trim();
  return normalized.length ? normalized : fallback;
}

function matchesPresence(value: string | null | undefined, filter: PresenceFilter): boolean {
  if (filter === "all") return true;
  const hasValue = Boolean(String(value || "").trim());
  return filter === "yes" ? hasValue : !hasValue;
}

function statusBadge(row: { status: MismatchStatus }) {
  if (row.status === "ok") {
    return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">OK</Badge>;
  }
  if (row.status === "partial_legal_coverage") {
    return <Badge className="bg-sky-100 text-sky-800 hover:bg-sky-100">Частичное юр-покрытие</Badge>;
  }
  if (row.status === "missing_cadastre") {
    return <Badge variant="outline">{CADASTRE_NOT_SET_LABEL}</Badge>;
  }
  if (row.status === "missing_owner") {
    return <Badge variant="outline">{OWNER_NOT_SET_LABEL}</Badge>;
  }
  if (row.status === "overallocated") {
    return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Overallocated</Badge>;
  }
  return <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">Underallocated</Badge>;
}

export default function LandLegalPage() {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);

  const [tab, setTab] = useState("field_legal");
  const [seasonId, setSeasonId] = useState("");
  const [reportMode, setReportMode] = useState<ReportMode>("sowing_by_cadastre");
  const [companyName, setCompanyName] = useState("—");
  const [summary, setSummary] = useState<Summary | null>(null);

  const [search, setSearch] = useState("");
  const [searchCadastre, setSearchCadastre] = useState("");
  const [searchOwner, setSearchOwner] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const [fieldFilter, setFieldFilter] = useState(FILTER_ALL);
  const [ownerFilter, setOwnerFilter] = useState(FILTER_ALL);
  const [districtFilter, setDistrictFilter] = useState(FILTER_ALL);
  const [cropFilter, setCropFilter] = useState(FILTER_ALL);
  const [cadastreFilter, setCadastreFilter] = useState(FILTER_ALL);
  const [hasCadastre, setHasCadastre] = useState<PresenceFilter>("all");
  const [hasOwner, setHasOwner] = useState<PresenceFilter>("all");
  const [hasDistrict, setHasDistrict] = useState<PresenceFilter>("all");

  const [seasons, setSeasons] = useState<Array<{ id: string; year: number; name: string | null }>>([]);
  const [fields, setFields] = useState<Array<{ id: string; name: string; technical_key?: string | null; original_field_key?: string | null; area: number }>>([]);
  const [legalEntities, setLegalEntities] = useState<LegalEntity[]>([]);
  const [cadastres, setCadastres] = useState<CadastralParcel[]>([]);
  const [breakdownRows, setBreakdownRows] = useState<CanonicalLegalBreakdownRow[]>([]);
  const [mismatches, setMismatches] = useState<LandAreaMismatchRow[]>([]);
  const [sowingRows, setSowingRows] = useState<LandSowingByCadastreRow[]>([]);
  const [reportByParcel, setReportByParcel] = useState<
    Array<{
      cadastral_number: string;
      rural_district: string | null;
      rural_districts?: string[];
      has_rural_district_conflict?: boolean;
      declared_area_ha: number;
      linked_area_ha: number;
      fields: string[];
      crops: string[];
    }>
  >([]);
  const [reportByEntity, setReportByEntity] = useState<
    Array<{ legal_entity_name: string; area_ha: number; cadastre_count: number; fields: string[]; crops: string[] }>
  >([]);

  const [backendDiagnostics, setBackendDiagnostics] = useState<Record<string, number> | null>(null);

  const canView = ROLE_CAN_VIEW.has(profile?.role || "");
  const currentSeasonId = seasonId || seasons[0]?.id || "";

  const fieldSearchById = useMemo(
    () =>
      new Map(
        fields.map((field) => [
          field.id,
          [field.name, field.technical_key || "", field.original_field_key || ""].join(" ").toLowerCase(),
        ]),
      ),
    [fields],
  );

  const canonicalRows = useMemo(() => {
    return breakdownRows.map((row) => ({
      key: row.key,
      fieldId: row.field_id,
      fieldName: row.field_display_name || "Нет данных",
      technicalKey: row.technical_key || null,
      originalFieldKey: row.original_field_key || null,
      ownerName: row.owner_name || inferOwnerBySourceDocument(row.source_document) || null,
      ruralDistrict: row.rural_district || null,
      ruralDistrictMissing: Boolean(row.rural_district_missing || !row.rural_district),
      areaHa: Number(row.area_ha || 0),
      cropName: row.crop_name || null,
      cadastreNumber: row.cadastral_number || null,
      sourceDocument: row.source_document || null,
      missingCadastre: Boolean(row.missing_cadastre || !row.cadastral_number),
      missingCrop: Boolean(row.missing_crop || !row.crop_name),
      allocationStatus: row.allocation_status || "active",
    }));
  }, [breakdownRows]);

  const canonicalRowsWithLayer = useMemo(() => {
    const sourceByKey = new Map(
      (breakdownRows || []).map((row) => [row.key, row.row_source]),
    );
    return canonicalRows.map((row) => {
      const rowSource = sourceByKey.get(row.key) || "field_cadastre_link";
      const coverageStatus =
        rowSource === "crop_structure_gap"
          ? "Без юр покрытия"
          : row.missingCadastre
            ? "Без кадастра"
            : row.ownerName
              ? "Полное покрытие"
              : "Без владельца";
      return { ...row, rowSource, coverageStatus };
    });
  }, [breakdownRows, canonicalRows]);

  const legalRows = useMemo(
    () => canonicalRowsWithLayer.filter((row) => row.rowSource !== "crop_structure_gap"),
    [canonicalRowsWithLayer],
  );
  const gapRows = useMemo(
    () => canonicalRowsWithLayer.filter((row) => row.rowSource === "crop_structure_gap"),
    [canonicalRowsWithLayer],
  );

  const filterOptions = useMemo(() => {
    const sortRu = (values: string[]) => values.sort((a, b) => a.localeCompare(b, "ru"));
    const unique = (values: string[]) => Array.from(new Set(values));
    return {
      fields: sortRu(unique(canonicalRowsWithLayer.map((row) => row.fieldName).filter(Boolean))),
      owners: sortRu(unique(canonicalRowsWithLayer.map((row) => row.ownerName || "").filter(Boolean))),
      districts: sortRu(unique(canonicalRowsWithLayer.map((row) => row.ruralDistrict || "").filter(Boolean))),
      crops: sortRu(unique(canonicalRowsWithLayer.map((row) => row.cropName || "").filter(Boolean))),
      cadastres: sortRu(unique(canonicalRowsWithLayer.map((row) => row.cadastreNumber || "").filter(Boolean))),
    };
  }, [canonicalRowsWithLayer]);

  const filteredFieldRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return canonicalRowsWithLayer.filter((row) => {
      if (fieldFilter !== FILTER_ALL && valueForFilter(row.fieldName) !== fieldFilter) return false;
      if (ownerFilter !== FILTER_ALL && valueForFilter(row.ownerName) !== ownerFilter) return false;
      if (districtFilter !== FILTER_ALL && valueForFilter(row.ruralDistrict) !== districtFilter) return false;
      if (cropFilter !== FILTER_ALL && valueForFilter(row.cropName) !== cropFilter) return false;
      if (cadastreFilter !== FILTER_ALL && valueForFilter(row.cadastreNumber) !== cadastreFilter) return false;
      if (!matchesPresence(row.cadastreNumber, hasCadastre)) return false;
      if (!matchesPresence(row.ownerName, hasOwner)) return false;
      if (!matchesPresence(row.ruralDistrict, hasDistrict)) return false;

      if (!query) return true;
      return [
        row.fieldName,
        row.ownerName || "",
        row.ruralDistrict || "",
        row.cropName || "",
        row.cadastreNumber || "",
        fieldSearchById.get(row.fieldId) || "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [
    canonicalRowsWithLayer,
    search,
    fieldFilter,
    ownerFilter,
    districtFilter,
    cropFilter,
    cadastreFilter,
    hasCadastre,
    hasOwner,
    hasDistrict,
    fieldSearchById,
  ]);

  const ownerRows = useMemo(() => {
    const map = new Map<
      string,
      { ownerName: string; totalAreaHa: number; fields: Set<string>; cadastres: Set<string>; crops: Set<string>; missingCadastre: number }
    >();

    legalEntities.forEach((entity) => {
      map.set(entity.name, {
        ownerName: entity.name,
        totalAreaHa: 0,
        fields: new Set<string>(),
        cadastres: new Set<string>(),
        crops: new Set<string>(),
        missingCadastre: 0,
      });
    });

    legalRows.forEach((row) => {
      const owner = row.ownerName || OWNER_EMPTY_LABEL;
      const current = map.get(owner) || {
        ownerName: owner,
        totalAreaHa: 0,
        fields: new Set<string>(),
        cadastres: new Set<string>(),
        crops: new Set<string>(),
        missingCadastre: 0,
      };
      current.totalAreaHa += Number(row.areaHa || 0);
      current.fields.add(row.fieldName);
      if (row.cadastreNumber) current.cadastres.add(row.cadastreNumber);
      else current.missingCadastre += 1;
      if (row.cropName) current.crops.add(row.cropName);
      map.set(owner, current);
    });

    const query = searchOwner.trim().toLowerCase();
    return Array.from(map.values())
      .filter((row) => (query ? row.ownerName.toLowerCase().includes(query) : true))
      .sort((a, b) => b.totalAreaHa - a.totalAreaHa || a.ownerName.localeCompare(b.ownerName, "ru"));
  }, [legalEntities, legalRows, searchOwner]);

  const cadastreRows = useMemo(() => {
    const byNumber = new Map<
      string,
      {
        id: string;
        cadastral_number: string;
        district: string | null;
        linkedAreaHa: number;
        fields: Set<string>;
        owners: Set<string>;
        crops: Set<string>;
        districts: Set<string>;
      }
    >();

    cadastres.forEach((cadastre) => {
      const key = cadastre.cadastral_number;
      byNumber.set(key, {
        id: cadastre.id,
        cadastral_number: cadastre.cadastral_number,
        district: cadastre.rural_district || null,
        linkedAreaHa: 0,
        fields: new Set<string>(),
        owners: new Set<string>(),
        crops: new Set<string>(),
        districts: cadastre.rural_district ? new Set<string>([cadastre.rural_district]) : new Set<string>(),
      });
    });

    legalRows.forEach((row) => {
      if (!row.cadastreNumber) return;
      const current = byNumber.get(row.cadastreNumber) || {
        id: row.cadastreNumber,
        cadastral_number: row.cadastreNumber,
        district: null,
        linkedAreaHa: 0,
        fields: new Set<string>(),
        owners: new Set<string>(),
        crops: new Set<string>(),
        districts: new Set<string>(),
      };
      current.linkedAreaHa += Number(row.areaHa || 0);
      if (row.fieldName) current.fields.add(row.fieldName);
      if (row.ownerName) current.owners.add(row.ownerName);
      if (row.cropName) current.crops.add(row.cropName);
      if (row.ruralDistrict) current.districts.add(row.ruralDistrict);
      if (!current.district && row.ruralDistrict) current.district = row.ruralDistrict;
      byNumber.set(row.cadastreNumber, current);
    });

    const query = searchCadastre.trim().toLowerCase();
    return Array.from(byNumber.values())
      .filter((row) => {
        if (!query) return true;
        return [
          row.cadastral_number,
          row.district || "",
          Array.from(row.fields).join(" "),
          Array.from(row.owners).join(" "),
          Array.from(row.crops).join(" "),
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .sort((a, b) => a.cadastral_number.localeCompare(b.cadastral_number, "ru"));
  }, [cadastres, legalRows, searchCadastre]);

  const mismatchRows = useMemo(() => {
    const rowsByFieldId = new Map<string, typeof legalRows>();
    legalRows.forEach((row) => {
      const current = rowsByFieldId.get(row.fieldId) || [];
      current.push(row);
      rowsByFieldId.set(row.fieldId, current);
    });
    const gapByFieldId = new Set(gapRows.map((row) => row.fieldId));

    return mismatches.map((row) => {
      const related = rowsByFieldId.get(String(row.field_id || "")) || [];
      const hasMissingCadastre = related.some((item) => item.missingCadastre);
      const hasMissingOwner = related.some((item) => !item.ownerName);
      const diff = Number(row.diff_area_ha || 0);
      let status: MismatchStatus = "ok";
      if (!related.length || Number(row.link_count || 0) === 0 || gapByFieldId.has(String(row.field_id || ""))) {
        status = "partial_legal_coverage";
      }
      else if (hasMissingCadastre) status = "missing_cadastre";
      else if (hasMissingOwner) status = "missing_owner";
      else if (diff > 0.01) status = "overallocated";
      else if (diff < -0.01) status = "underallocated";
      return { ...row, status };
    });
  }, [mismatches, legalRows, gapRows]);

  const diagnostics = useMemo(() => {
    const rowsWithDistrict = legalRows.filter((row) => row.ruralDistrict).length;
    const rowsWithoutDistrict = legalRows.length - rowsWithDistrict;
    const distinctDistricts = new Set(
      legalRows
        .map((row) => String(row.ruralDistrict || "").trim())
        .filter((value) => value.length > 0),
    ).size;
    return {
      ui_rows_field_legal: filteredFieldRows.length,
      ui_rows_cadastres: cadastreRows.length,
      ui_rows_owners: ownerRows.length,
      legal_breakdown_rows_total: canonicalRowsWithLayer.length,
      legal_breakdown_rows_canonical: legalRows.length,
      legal_breakdown_rows_gaps: gapRows.length,
      legal_breakdown_rows_with_rural_district:
        backendDiagnostics?.legal_breakdown_rows_with_rural_district ?? rowsWithDistrict,
      legal_breakdown_rows_missing_rural_district:
        backendDiagnostics?.legal_breakdown_rows_missing_rural_district ?? rowsWithoutDistrict,
      legal_breakdown_distinct_rural_districts:
        backendDiagnostics?.legal_breakdown_distinct_rural_districts ?? distinctDistricts,
      cadastral_count: backendDiagnostics?.cadastral_count ?? cadastres.length,
      legal_entities_count: legalEntities.length,
      stem_rows: backendDiagnostics?.stem_links ?? 0,
      karagash_rows: backendDiagnostics?.karagash_links ?? 0,
      owner_sheet_rows: backendDiagnostics?.owner_sheet_rows ?? 0,
    };
  }, [
    backendDiagnostics,
    cadastreRows.length,
    cadastres.length,
    canonicalRowsWithLayer.length,
    filteredFieldRows.length,
    gapRows.length,
    legalEntities.length,
    legalRows,
    ownerRows.length,
  ]);

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; value: string }> = [];
    if (fieldFilter !== FILTER_ALL) chips.push({ key: "field", label: "Поле", value: displayValue(fieldFilter, "Нет данных") });
    if (ownerFilter !== FILTER_ALL) chips.push({ key: "owner", label: "Владелец", value: displayValue(ownerFilter, OWNER_EMPTY_LABEL) });
    if (districtFilter !== FILTER_ALL) chips.push({ key: "district", label: "Округ", value: displayValue(districtFilter, DISTRICT_EMPTY_LABEL) });
    if (cropFilter !== FILTER_ALL) chips.push({ key: "crop", label: "Культура", value: displayValue(cropFilter, CROP_EMPTY_LABEL) });
    if (cadastreFilter !== FILTER_ALL) chips.push({ key: "cadastre", label: "Кадастр", value: displayValue(cadastreFilter, CADASTRE_EMPTY_LABEL) });
    if (hasCadastre !== "all") chips.push({ key: "has_cadastre", label: "Кадастр", value: hasCadastre === "yes" ? "есть" : "нет" });
    if (hasOwner !== "all") chips.push({ key: "has_owner", label: "Владелец", value: hasOwner === "yes" ? "есть" : "нет" });
    if (hasDistrict !== "all") chips.push({ key: "has_district", label: "Округ", value: hasDistrict === "yes" ? "есть" : "нет" });
    return chips;
  }, [cadastreFilter, cropFilter, districtFilter, fieldFilter, hasCadastre, hasDistrict, hasOwner, ownerFilter]);

  const clearFilterChip = (key: string) => {
    if (key === "field") setFieldFilter(FILTER_ALL);
    if (key === "owner") setOwnerFilter(FILTER_ALL);
    if (key === "district") setDistrictFilter(FILTER_ALL);
    if (key === "crop") setCropFilter(FILTER_ALL);
    if (key === "cadastre") setCadastreFilter(FILTER_ALL);
    if (key === "has_cadastre") setHasCadastre("all");
    if (key === "has_owner") setHasOwner("all");
    if (key === "has_district") setHasDistrict("all");
  };

  const resetAllFilters = () => {
    setFieldFilter(FILTER_ALL);
    setOwnerFilter(FILTER_ALL);
    setDistrictFilter(FILTER_ALL);
    setCropFilter(FILTER_ALL);
    setCadastreFilter(FILTER_ALL);
    setHasCadastre("all");
    setHasOwner("all");
    setHasDistrict("all");
  };

  const reload = async (requestedSeasonId?: string) => {
    try {
      setLoading(true);
      const payload = await getLandLegalBootstrap(requestedSeasonId || currentSeasonId || undefined);
      setCompanyName(payload.company?.name || "—");
      setSummary(payload.summary || null);
      setSeasons(payload.seasons || []);
      setFields(payload.fields || []);
      setLegalEntities(payload.legalEntities || []);
      setCadastres(payload.cadastres || []);
      setMismatches(payload.mismatches || []);
      setSowingRows(payload.sowingRows || []);
      setBackendDiagnostics((payload.diagnostics as Record<string, number>) || null);

      const fromBackend = Array.isArray(payload.breakdownRows) ? payload.breakdownRows : [];
      setBreakdownRows(fromBackend);

      if (!seasonId && payload.seasons?.length) setSeasonId(payload.seasons[0].id);
    } catch (error) {
      toast({
        title: "Ошибка",
        description: error instanceof Error ? error.message : "Не удалось загрузить модуль",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadReports = async (mode = reportMode) => {
    if (!currentSeasonId) return;
    try {
      setReportLoading(true);
      const payload = await getLandLegalReports({ seasonId: currentSeasonId, mode });
      setSowingRows(payload.sowingRows || []);
      setMismatches(payload.mismatches || []);
      setReportByParcel(payload.byParcel || []);
      setReportByEntity(payload.byEntity || []);
    } catch (error) {
      toast({
        title: "Ошибка",
        description: error instanceof Error ? error.message : "Не удалось загрузить отчёты",
        variant: "destructive",
      });
    } finally {
      setReportLoading(false);
    }
  };

  const exportXlsx = async (
    reportType:
      | "legal_breakdown"
      | "cadastres"
      | "owners"
      | "rural_districts"
      | "crops"
      | "missing_cadastre"
      | "missing_owner"
      | "mismatches",
  ) => {
    try {
      setExporting(true);
      const { blob, fileName } = await downloadLandLegalExport({
        report_type: reportType,
        season_id: currentSeasonId || undefined,
        search: search || undefined,
        field: fieldFilter !== FILTER_ALL ? fieldFilter : undefined,
        owner: ownerFilter !== FILTER_ALL ? ownerFilter : undefined,
        rural_district: districtFilter !== FILTER_ALL ? districtFilter : undefined,
        crop: cropFilter !== FILTER_ALL ? cropFilter : undefined,
        cadastre: cadastreFilter !== FILTER_ALL ? cadastreFilter : undefined,
        has_cadastre: hasCadastre,
        has_owner: hasOwner,
        has_rural_district: hasDistrict,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({
        title: "Ошибка",
        description: error instanceof Error ? error.message : "Не удалось выгрузить Excel",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    if (!profile) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, profile?.company_id]);

  useEffect(() => {
    if (!seasonId) return;
    void reload(seasonId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonId]);

  if (!canView) {
    return (
      <div className="space-y-4">
        <PageHeader title="Кадастр и право" description="Недостаточно прав для просмотра этого раздела." />
        <Card>
          <CardContent className="pt-6 text-sm text-slate-700">
            Доступ разрешён ролям: <b>global_admin</b>, <b>company_admin</b>, <b>director</b>.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Кадастр и право" description={`Юридическая разбивка по полям. Компания: ${companyName}`} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Card><CardContent className="pt-4"><div className="text-xs text-slate-500">Кадастров</div><div className="text-xl font-semibold">{summary?.cadastral_count || 0}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-xs text-slate-500">Юридическое покрытие</div><div className="text-xl font-semibold">{fmtHa((summary?.legal_coverage_area_ha ?? summary?.legal_total_area_ha) || 0)}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-xs text-slate-500">Агро-площадь</div><div className="text-xl font-semibold">{fmtHa(summary?.agro_total_area_ha || 0)}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-xs text-slate-500">Без юр покрытия</div><div className="text-xl font-semibold">{fmtHa(summary?.gap_total_area_ha || 0)}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-xs text-slate-500">Уникальная площадь кадастров</div><div className="text-xl font-semibold">{fmtHa(summary?.unique_cadastral_area_ha || 0)}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-xs text-slate-500">Активные документы</div><div className="text-xl font-semibold">{summary?.active_documents || 0}</div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="pt-4 text-xs text-slate-600">
          <div className="flex flex-wrap gap-4">
            <span>rows: <b>{diagnostics.legal_breakdown_rows_total}</b></span>
            <span>canonical: <b>{diagnostics.legal_breakdown_rows_canonical ?? 0}</b></span>
            <span>gaps: <b>{diagnostics.legal_breakdown_rows_gaps ?? 0}</b></span>
            <span>STEM: <b>{diagnostics.stem_rows}</b></span>
            <span>Карагаш: <b>{diagnostics.karagash_rows}</b></span>
            <span>owner-sheet: <b>{diagnostics.owner_sheet_rows}</b></span>
            <span>district set: <b>{diagnostics.legal_breakdown_rows_with_rural_district}</b></span>
            <span>district missing: <b>{diagnostics.legal_breakdown_rows_missing_rural_district}</b></span>
            <span>districts: <b>{diagnostics.legal_breakdown_distinct_rural_districts}</b></span>
            <span>cadastres: <b>{diagnostics.cadastral_count}</b></span>
            <span>legal entities: <b>{diagnostics.legal_entities_count}</b></span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-slate-600">Сезон</span>
            <Select value={currentSeasonId} onValueChange={setSeasonId}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Выберите сезон" />
              </SelectTrigger>
              <SelectContent>
                {seasons.map((season) => (
                  <SelectItem key={season.id} value={season.id}>{season.year}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {loading ? <Loader2 className="h-4 w-4 animate-spin text-slate-500" /> : null}
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex w-full flex-wrap justify-start gap-2 bg-transparent p-0">
          <TabsTrigger value="field_legal">Поля / юр-разбивка</TabsTrigger>
          <TabsTrigger value="cadastres">Кадастры</TabsTrigger>
          <TabsTrigger value="owners">Владельцы</TabsTrigger>
          <TabsTrigger value="mismatches">Расхождения</TabsTrigger>
          <TabsTrigger value="reports">Отчёты</TabsTrigger>
          <TabsTrigger value="import">Импорт</TabsTrigger>
        </TabsList>

        <TabsContent value="field_legal" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Поля / юридическая разбивка</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Input
                  className="max-w-xl"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Поиск: поле, владелец, округ, культура, кадастр..."
                />
                <Button variant="outline" size="sm" onClick={() => setShowFilters((prev) => !prev)}>
                  <Filter className="mr-2 h-4 w-4" />
                  Фильтры
                </Button>
                <Button variant="outline" size="sm" disabled={exporting} onClick={() => void exportXlsx("legal_breakdown")}>
                  {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                  Экспорт Excel (.xlsx)
                </Button>
              </div>

              {showFilters ? (
                <div className="grid gap-3 rounded-lg border p-3 md:grid-cols-2 xl:grid-cols-4">
                  <Select value={fieldFilter} onValueChange={setFieldFilter}>
                    <SelectTrigger><SelectValue placeholder="Поле" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={FILTER_ALL}>Все поля</SelectItem>
                      {filterOptions.fields.map((option) => <SelectItem key={`field-${option}`} value={option}>{option}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                    <SelectTrigger><SelectValue placeholder="Владелец" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={FILTER_ALL}>Все владельцы</SelectItem>
                      <SelectItem value={FILTER_MISSING}>{OWNER_NOT_SET_LABEL}</SelectItem>
                      {filterOptions.owners.map((option) => <SelectItem key={`owner-${option}`} value={option}>{option}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={districtFilter} onValueChange={setDistrictFilter}>
                    <SelectTrigger><SelectValue placeholder="Сельский округ" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={FILTER_ALL}>Все округа</SelectItem>
                      <SelectItem value={FILTER_MISSING}>{DISTRICT_NOT_SET_LABEL}</SelectItem>
                      {filterOptions.districts.map((option) => <SelectItem key={`district-${option}`} value={option}>{option}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={cropFilter} onValueChange={setCropFilter}>
                    <SelectTrigger><SelectValue placeholder="Культура / land use" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={FILTER_ALL}>Все культуры</SelectItem>
                      <SelectItem value={FILTER_MISSING}>{CROP_NOT_SET_LABEL}</SelectItem>
                      {filterOptions.crops.map((option) => <SelectItem key={`crop-${option}`} value={option}>{option}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={cadastreFilter} onValueChange={setCadastreFilter}>
                    <SelectTrigger><SelectValue placeholder="Кадастр" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={FILTER_ALL}>Все кадастры</SelectItem>
                      <SelectItem value={FILTER_MISSING}>{CADASTRE_NOT_SET_LABEL}</SelectItem>
                      {filterOptions.cadastres.map((option) => <SelectItem key={`cadastre-${option}`} value={option}>{option}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={hasCadastre} onValueChange={(value) => setHasCadastre(value as PresenceFilter)}>
                    <SelectTrigger><SelectValue placeholder="Наличие кадастра" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Кадастр: все</SelectItem>
                      <SelectItem value="yes">Кадастр: есть</SelectItem>
                      <SelectItem value="no">Кадастр: нет</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={hasOwner} onValueChange={(value) => setHasOwner(value as PresenceFilter)}>
                    <SelectTrigger><SelectValue placeholder="Наличие владельца" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Владелец: все</SelectItem>
                      <SelectItem value="yes">Владелец: есть</SelectItem>
                      <SelectItem value="no">Владелец: нет</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={hasDistrict} onValueChange={(value) => setHasDistrict(value as PresenceFilter)}>
                    <SelectTrigger><SelectValue placeholder="Наличие округа" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Округ: все</SelectItem>
                      <SelectItem value="yes">Округ: есть</SelectItem>
                      <SelectItem value="no">Округ: нет</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {activeFilterChips.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {activeFilterChips.map((chip) => (
                    <button key={`${chip.key}-${chip.value}`} type="button" className="inline-flex" onClick={() => clearFilterChip(chip.key)}>
                      <Badge variant="secondary">{chip.label}: {chip.value} ×</Badge>
                    </button>
                  ))}
                  <Button variant="ghost" size="sm" onClick={resetAllFilters}>Сбросить фильтры</Button>
                </div>
              ) : null}

              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Поле</TableHead>
                      <TableHead>Владелец / юрконтур</TableHead>
                      <TableHead>Сельский округ</TableHead>
                      <TableHead>Площадь</TableHead>
                      <TableHead>Культура / land use</TableHead>
                      <TableHead>Кадастр</TableHead>
                      <TableHead>Статус покрытия</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredFieldRows.map((row) => (
                      <TableRow key={row.key} className={row.rowSource === "crop_structure_gap" ? "bg-amber-50/40" : undefined}>
                        <TableCell className="font-medium">{row.fieldName}</TableCell>
                        <TableCell>
                          <Badge variant={row.ownerName ? "secondary" : "outline"}>
                            {row.ownerName || OWNER_NOT_SET_LABEL}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {row.ruralDistrict ? <Badge variant="secondary">{row.ruralDistrict}</Badge> : <Badge variant="outline">{DISTRICT_NOT_SET_LABEL}</Badge>}
                        </TableCell>
                        <TableCell>{fmtHa(row.areaHa)}</TableCell>
                        <TableCell>
                          {row.cropName ? (
                            <Badge className="bg-slate-100 text-slate-800 hover:bg-slate-100">{row.cropName}</Badge>
                          ) : (
                            <Badge variant="outline">{CROP_NOT_SET_LABEL}</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {row.cadastreNumber ? (
                            <button
                              type="button"
                              className="cursor-pointer underline underline-offset-2"
                              onClick={() => {
                                setSearchCadastre(row.cadastreNumber || "");
                                setTab("cadastres");
                              }}
                            >
                              {row.cadastreNumber}
                            </button>
                          ) : (
                            <Badge variant="outline">{CADASTRE_NOT_SET_LABEL}</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              row.coverageStatus === "Полное покрытие"
                                ? "secondary"
                                : row.coverageStatus === "Без юр покрытия"
                                  ? "destructive"
                                  : "outline"
                            }
                          >
                            {row.coverageStatus}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cadastres" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Кадастры</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Input
                  className="max-w-xl"
                  value={searchCadastre}
                  onChange={(event) => setSearchCadastre(event.target.value)}
                  placeholder="Поиск: кадастр, округ, поле, владелец, культура..."
                />
                <Button variant="outline" size="sm" disabled={exporting} onClick={() => void exportXlsx("cadastres")}>
                  {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                  Экспорт Excel (.xlsx)
                </Button>
              </div>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Кадастр</TableHead>
                      <TableHead>Сельский округ</TableHead>
                      <TableHead>Владелец / юрконтур</TableHead>
                      <TableHead>Связанные поля</TableHead>
                      <TableHead>Связанные культуры</TableHead>
                      <TableHead>Площадь связей</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cadastreRows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">{row.cadastral_number}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {row.district ? <Badge variant="secondary">{row.district}</Badge> : <Badge variant="outline">{DISTRICT_NOT_SET_LABEL}</Badge>}
                            {row.districts.size > 1 ? <Badge variant="destructive">есть расхождение</Badge> : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {row.owners.size ? Array.from(row.owners).slice(0, 3).map((owner) => (
                              <Badge key={`${row.id}-${owner}`} variant="secondary">{owner}</Badge>
                            )) : <Badge variant="outline">{OWNER_NOT_SET_LABEL}</Badge>}
                            {row.owners.size > 3 ? <Badge variant="outline">+{row.owners.size - 3}</Badge> : null}
                          </div>
                        </TableCell>
                        <TableCell>{row.fields.size ? Array.from(row.fields).join(", ") : "Нет данных"}</TableCell>
                        <TableCell>{row.crops.size ? Array.from(row.crops).join(", ") : CROP_NOT_SET_LABEL}</TableCell>
                        <TableCell>{fmtHa(row.linkedAreaHa)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="owners" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Владельцы</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Input
                  className="max-w-xl"
                  value={searchOwner}
                  onChange={(event) => setSearchOwner(event.target.value)}
                  placeholder="Поиск владельца..."
                />
                <Button variant="outline" size="sm" disabled={exporting} onClick={() => void exportXlsx("owners")}>
                  {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                  Экспорт Excel (.xlsx)
                </Button>
              </div>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Владелец / юрконтур</TableHead>
                      <TableHead>Общая площадь</TableHead>
                      <TableHead>Кол-во полей</TableHead>
                      <TableHead>Кол-во кадастров</TableHead>
                      <TableHead>Без кадастра</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ownerRows.map((row) => (
                      <TableRow key={row.ownerName}>
                        <TableCell className="font-medium">{row.ownerName}</TableCell>
                        <TableCell>{fmtHa(row.totalAreaHa)}</TableCell>
                        <TableCell>{row.fields.size}</TableCell>
                        <TableCell>{row.cadastres.size}</TableCell>
                        <TableCell>{row.missingCadastre}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mismatches" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Расхождения</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button variant="outline" size="sm" disabled={exporting} onClick={() => void exportXlsx("mismatches")}>
                {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                Экспорт Excel (.xlsx)
              </Button>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Поле</TableHead>
                      <TableHead>Агро-площадь</TableHead>
                      <TableHead>Юр-площадь</TableHead>
                      <TableHead>Разница</TableHead>
                      <TableHead>Статус</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mismatchRows.map((row) => (
                      <TableRow key={`${row.field_id}-${row.season_id || "none"}`}>
                        <TableCell className="font-medium">{row.field_name}</TableCell>
                        <TableCell>{fmtHa(Number(row.agro_area_ha || 0))}</TableCell>
                        <TableCell>{fmtHa(Number(row.legal_area_ha || 0))}</TableCell>
                        <TableCell>{fmtDiff(Number(row.diff_area_ha || 0))}</TableCell>
                        <TableCell>{statusBadge(row)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Отчёты</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Select value={reportMode} onValueChange={(value) => setReportMode(value as ReportMode)}>
                  <SelectTrigger className="w-[280px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sowing_by_cadastre">Посевная по кадастрам</SelectItem>
                    <SelectItem value="by_parcel">Отчёт по кадастрам</SelectItem>
                    <SelectItem value="by_entity">Отчёт по владельцам</SelectItem>
                    <SelectItem value="mismatches">Расхождения по полям</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={() => void loadReports(reportMode)} disabled={reportLoading}>
                  {reportLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Обновить
                </Button>
                <Button
                  variant="outline"
                  disabled={exporting}
                  onClick={() =>
                    void exportXlsx(
                      reportMode === "by_parcel"
                        ? "cadastres"
                        : reportMode === "by_entity"
                          ? "owners"
                          : reportMode === "mismatches"
                            ? "mismatches"
                            : "legal_breakdown",
                    )
                  }
                >
                  {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                  Экспорт Excel (.xlsx)
                </Button>
              </div>

              {reportMode === "sowing_by_cadastre" ? (
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Поле</TableHead>
                        <TableHead>Владелец / юрконтур</TableHead>
                        <TableHead>Сельский округ</TableHead>
                        <TableHead>Кадастр</TableHead>
                        <TableHead>Площадь</TableHead>
                        <TableHead>Культура</TableHead>
                        <TableHead>Сорт</TableHead>
                        <TableHead>Репродукция</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sowingRows.map((row) => (
                        <TableRow key={`${row.field_id}-${row.cadastral_parcel_id}-${row.crop_id || "none"}-${row.area_ha}`}>
                          <TableCell>{row.field_name}</TableCell>
                          <TableCell>{row.owner_legal_entity_name || inferOwnerBySourceDocument(row.source_document) || OWNER_NOT_SET_LABEL}</TableCell>
                          <TableCell>{row.rural_district || DISTRICT_NOT_SET_LABEL}</TableCell>
                          <TableCell>{row.cadastral_number || CADASTRE_NOT_SET_LABEL}</TableCell>
                          <TableCell>{fmtHa(Number(row.area_ha || 0))}</TableCell>
                          <TableCell>{row.crop_name || CROP_NOT_SET_LABEL}</TableCell>
                          <TableCell>{row.variety_name || "—"}</TableCell>
                          <TableCell>{row.reproduction_name || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}

              {reportMode === "by_parcel" ? (
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Кадастр</TableHead>
                        <TableHead>Сельский округ</TableHead>
                        <TableHead>Площадь связей</TableHead>
                        <TableHead>Поля</TableHead>
                        <TableHead>Культуры</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reportByParcel.map((row) => (
                        <TableRow key={row.cadastral_number}>
                          <TableCell>{row.cadastral_number}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {row.rural_district ? <Badge variant="secondary">{row.rural_district}</Badge> : <Badge variant="outline">{DISTRICT_NOT_SET_LABEL}</Badge>}
                              {row.has_rural_district_conflict ? <Badge variant="destructive">есть расхождение</Badge> : null}
                            </div>
                          </TableCell>
                          <TableCell>{fmtHa(Number(row.linked_area_ha || 0))}</TableCell>
                          <TableCell>{row.fields.join(", ") || "Нет данных"}</TableCell>
                          <TableCell>{row.crops.join(", ") || CROP_NOT_SET_LABEL}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}

              {reportMode === "by_entity" ? (
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Владелец</TableHead>
                        <TableHead>Площадь</TableHead>
                        <TableHead>Кадастров</TableHead>
                        <TableHead>Поля</TableHead>
                        <TableHead>Культуры</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reportByEntity.map((row) => (
                        <TableRow key={row.legal_entity_name}>
                          <TableCell>{row.legal_entity_name}</TableCell>
                          <TableCell>{fmtHa(Number(row.area_ha || 0))}</TableCell>
                          <TableCell>{row.cadastre_count}</TableCell>
                          <TableCell>{row.fields.join(", ") || "Нет данных"}</TableCell>
                          <TableCell>{row.crops.join(", ") || CROP_NOT_SET_LABEL}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}

              {reportMode === "mismatches" ? (
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Поле</TableHead>
                        <TableHead>Агро-площадь</TableHead>
                        <TableHead>Юр-площадь</TableHead>
                        <TableHead>Разница</TableHead>
                        <TableHead>Статус</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {mismatchRows.map((row) => (
                        <TableRow key={`${row.field_id}-${row.season_id || "none"}-report`}>
                          <TableCell>{row.field_name}</TableCell>
                          <TableCell>{fmtHa(Number(row.agro_area_ha || 0))}</TableCell>
                          <TableCell>{fmtHa(Number(row.legal_area_ha || 0))}</TableCell>
                          <TableCell>{fmtDiff(Number(row.diff_area_ha || 0))}</TableCell>
                          <TableCell>{row.status}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="import">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Импорт</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-slate-700">
              Импорт юридических документов выполняется через pipeline preview → confirm с сохранением import batch и warnings.
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
