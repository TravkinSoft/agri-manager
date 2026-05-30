"use client";

import { useEffect, useMemo, useState } from "react";
import { Archive, ChevronDown, ChevronUp, Pencil, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OperationFormDialog } from "@/components/operations/operation-form-dialog";
import {
  archiveOperation,
  createOperation,
  createOperationLine,
  deleteOperationLine,
  ensureOperationMaterialRequest,
  getAssignableSpecialists,
  getOperationLines,
  getOperations,
  getPotatoMaterialConsumptionReport,
  updateOperation,
  updateOperationLine,
} from "@/lib/services/operations";
import { getFields } from "@/lib/services/fields";
import { getCropStructures } from "@/lib/services/crop-structure";
import { getWarehouseIssueRequests } from "@/lib/services/warehouse-requests";
import { useAuth } from "@/lib/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import {
  OperationFormData,
  OperationLine,
  OperationLineFormData,
  OperationWithDetails,
  PotatoMaterialConsumptionRow,
  SpecialistAssignee,
} from "@/lib/types/operation";
import { Field } from "@/lib/types/field";
import { CropStructureWithDetails } from "@/lib/types/crop-structure";
import { useLanguage } from "@/lib/contexts/language-context";

function isRowCrop(cropName: string | null | undefined): boolean {
  const normalized = String(cropName || "").trim().toLowerCase();
  if (!normalized) return false;
  return ["картофель", "морковь", "лук", "кукуруза", "свекла", "potato", "carrot", "onion", "corn"].some(
    (token) => normalized.includes(token)
  );
}

function shouldShowOperationLines(operation: OperationWithDetails): boolean {
  const categorySlug = String(operation.operation_category_slug || "").trim().toLowerCase();
  if (categorySlug === "seeding_planting" || categorySlug === "harvesting") return true;

  const typeSlug = String(operation.operation_type_slug || "").trim().toLowerCase();
  const typeName = String(operation.operation_type || "").trim().toLowerCase();
  const merged = `${categorySlug} ${typeSlug} ${typeName}`;
  return ["seed", "sow", "plant", "harvest", "посев", "посад", "уборк"].some((token) => merged.includes(token));
}

function formatDate(dateString: string): string {
  if (!dateString) return "-";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return dateString;
  return d.toLocaleDateString("ru-RU", { year: "numeric", month: "short", day: "numeric" });
}

function statusBadge(status: string | null | undefined) {
  const normalized = String(status || "active").trim().toLowerCase();
  if (normalized === "completed") return <Badge className="bg-emerald-100 text-emerald-800">completed</Badge>;
  if (normalized === "in_progress") return <Badge className="bg-blue-100 text-blue-800">in progress</Badge>;
  if (normalized === "ready_to_start") return <Badge className="bg-amber-100 text-amber-800">ready</Badge>;
  return <Badge className="bg-slate-100 text-slate-800">{normalized}</Badge>;
}

export default function OperationsPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { language } = useLanguage();
  const [operations, setOperations] = useState<OperationWithDetails[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [cropStructures, setCropStructures] = useState<CropStructureWithDetails[]>([]);
  const [specialists, setSpecialists] = useState<SpecialistAssignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingOperation, setEditingOperation] = useState<OperationWithDetails | null>(null);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [operationToArchive, setOperationToArchive] = useState<OperationWithDetails | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [requestStatusByOperationId, setRequestStatusByOperationId] = useState<Record<string, string>>({});
  const [operationLinesByOperationId, setOperationLinesByOperationId] = useState<Record<string, OperationLine[]>>({});
  const [linesLoadingByOperationId, setLinesLoadingByOperationId] = useState<Record<string, boolean>>({});
  const [lineDraftByOperationId, setLineDraftByOperationId] = useState<Record<string, OperationLineFormData>>({});
  const [lineMutationBusyByOperationId, setLineMutationBusyByOperationId] = useState<Record<string, boolean>>({});
  const [potatoConsumptionRows, setPotatoConsumptionRows] = useState<PotatoMaterialConsumptionRow[]>([]);
  const [potatoConsumptionLoading, setPotatoConsumptionLoading] = useState(false);

  const [explorerField, setExplorerField] = useState<string>("all");
  const [explorerOperationType, setExplorerOperationType] = useState<string>("all");
  const [explorerMaterialSearch, setExplorerMaterialSearch] = useState<string>("");
  const [mobileLaneFilter, setMobileLaneFilter] = useState<"active" | "in_progress" | "completed" | "all">("active");

  const canManageOperationLines =
    profile?.role === "company_admin" || profile?.role === "global_admin" || profile?.role === "agronomist";
  const canUpdateOperationFacts = canManageOperationLines || profile?.role === "brigadier";

  const loadData = async () => {
    if (!profile?.company_id) return;
    setLoading(true);
    setPotatoConsumptionLoading(true);
    try {
      const [opsRes, fieldsRes, cropRes, specialistRes, requestsRes, potatoRes] = await Promise.allSettled([
        getOperations(profile.company_id),
        getFields(profile.company_id),
        getCropStructures(profile.company_id),
        getAssignableSpecialists(profile.company_id),
        getWarehouseIssueRequests(profile.company_id),
        getPotatoMaterialConsumptionReport(profile.company_id, {
          seasonYear: new Date().getFullYear(),
          limit: 2000,
        }),
      ]);

      if (opsRes.status === "fulfilled") setOperations(opsRes.value);
      else throw opsRes.reason;
      setFields(fieldsRes.status === "fulfilled" ? fieldsRes.value : []);
      setCropStructures(cropRes.status === "fulfilled" ? cropRes.value : []);
      setSpecialists(specialistRes.status === "fulfilled" ? specialistRes.value : []);

      if (requestsRes.status === "fulfilled") {
        const map: Record<string, string> = {};
        requestsRes.value.forEach((row) => {
          if (row.operation_id) map[row.operation_id] = row.status;
        });
        setRequestStatusByOperationId(map);
      } else {
        setRequestStatusByOperationId({});
      }

      setPotatoConsumptionRows(potatoRes.status === "fulfilled" ? potatoRes.value : []);
    } catch (error) {
      console.error(error);
      toast({ title: "Ошибка", description: "Не удалось загрузить операции", variant: "destructive" });
    } finally {
      setLoading(false);
      setPotatoConsumptionLoading(false);
    }
  };

  useEffect(() => {
    if (profile?.company_id) void loadData();
  }, [profile?.company_id, language]);

  const makeDefaultLineDraft = (operation: OperationWithDetails): OperationLineFormData => ({
    field_id: operation.field_id || null,
    crop_id: operation.crop_id || null,
    variety_id: null,
    reproduction_id: null,
    planned_area_ha: Number(operation.planned_area_ha || 0),
    actual_area_ha: null,
    row_count: null,
    row_spacing_m: null,
    seed_spacing_cm: null,
    notes: "",
  });

  const getOperationLineIdentityOptions = (operation: OperationWithDetails) => {
    const seen = new Set<string>();
    const options: Array<{ key: string; varietyId: string | null; reproductionId: string | null; label: string }> = [];
    cropStructures.forEach((row) => {
      if (String(row.field_id || "") !== String(operation.field_id || "")) return;
      if (operation.crop_id && String(row.crop_id || "") !== String(operation.crop_id || "")) return;
      const varietyId = row.variety_id ? String(row.variety_id) : null;
      const reproductionId = row.reproduction_id ? String(row.reproduction_id) : null;
      const key = `${varietyId || ""}|${reproductionId || ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      options.push({
        key,
        varietyId,
        reproductionId,
        label: `${row.variety_name || "без сорта"} / ${row.reproduction_name || "без репр."}`,
      });
    });
    return options.sort((a, b) => a.label.localeCompare(b.label, "ru"));
  };

  const upsertLineDraft = (operationId: string, patch: Partial<OperationLineFormData>) => {
    setLineDraftByOperationId((prev) => {
      const existing = prev[operationId];
      if (!existing) return prev;
      return { ...prev, [operationId]: { ...existing, ...patch } };
    });
  };

  const loadOperationLines = async (operationId: string) => {
    if (!profile?.company_id) return;
    setLinesLoadingByOperationId((prev) => ({ ...prev, [operationId]: true }));
    try {
      const rows = await getOperationLines(operationId, profile.company_id);
      setOperationLinesByOperationId((prev) => ({ ...prev, [operationId]: rows }));
    } catch (error: any) {
      toast({ title: "Ошибка", description: error?.message || "Не удалось загрузить строки операции", variant: "destructive" });
    } finally {
      setLinesLoadingByOperationId((prev) => ({ ...prev, [operationId]: false }));
    }
  };

  const ensureLinesLoaded = async (operation: OperationWithDetails) => {
    if (!operationLinesByOperationId[operation.id]) await loadOperationLines(operation.id);
    setLineDraftByOperationId((prev) => {
      if (prev[operation.id]) return prev;
      return { ...prev, [operation.id]: makeDefaultLineDraft(operation) };
    });
  };

  const handleCreate = async (data: OperationFormData) => {
    if (!profile?.company_id) return;
    try {
      const created = await createOperation(profile.company_id, data);
      await loadData();
      setIsFormOpen(false);
      const requestMeta = (created as any)?.material_request as { created?: boolean; request_number?: string } | undefined;
      toast({
        title: "Успешно",
        description: requestMeta?.created
          ? `Операция создана, заявка ${requestMeta.request_number || "auto"}`
          : "Операция создана",
      });
    } catch (error: any) {
      toast({ title: "Ошибка", description: error?.message || "Не удалось создать операцию", variant: "destructive" });
    }
  };

  const handleUpdate = async (data: OperationFormData) => {
    if (!editingOperation) return;
    try {
      await updateOperation(editingOperation.id, data);
      setEditingOperation(null);
      setIsFormOpen(false);
      await loadData();
      toast({ title: "Успешно", description: "Операция обновлена" });
    } catch (error: any) {
      toast({ title: "Ошибка", description: error?.message || "Не удалось обновить операцию", variant: "destructive" });
    }
  };

  const handleEnsureMaterialRequest = async (operation: OperationWithDetails) => {
    if (!profile?.company_id) return;
    try {
      const result = await ensureOperationMaterialRequest(operation.id, profile.company_id);
      await loadData();
      if (result?.created) {
        toast({ title: "Успешно", description: `Заявка создана (${String(result.request_number || "auto")})` });
      } else {
        toast({ title: "Инфо", description: `Без изменений (${String(result?.skipped_reason || "already synchronized")})` });
      }
    } catch (error: any) {
      toast({ title: "Ошибка", description: error?.message || "Не удалось создать заявку", variant: "destructive" });
    }
  };

  const handleArchive = async () => {
    if (!operationToArchive) return;
    try {
      await archiveOperation(operationToArchive.id);
      setArchiveDialogOpen(false);
      setOperationToArchive(null);
      await loadData();
      toast({ title: "Успешно", description: "Операция архивирована" });
    } catch (error: any) {
      toast({ title: "Ошибка", description: error?.message || "Не удалось архивировать", variant: "destructive" });
    }
  };

  const handleAddOperationLine = async (operation: OperationWithDetails) => {
    if (!profile?.company_id || !canManageOperationLines) return;
    const draft = lineDraftByOperationId[operation.id] || makeDefaultLineDraft(operation);
    if (!Number.isFinite(draft.planned_area_ha) || Number(draft.planned_area_ha) < 0) {
      toast({ title: "Проверка", description: "Плановая площадь должна быть >= 0", variant: "destructive" });
      return;
    }

    setLineMutationBusyByOperationId((prev) => ({ ...prev, [operation.id]: true }));
    try {
      await createOperationLine(operation.id, profile.company_id, draft);
      await loadOperationLines(operation.id);
      setLineDraftByOperationId((prev) => ({ ...prev, [operation.id]: makeDefaultLineDraft(operation) }));
      toast({ title: "Успешно", description: "Строка операции добавлена" });
    } catch (error: any) {
      toast({ title: "Ошибка", description: error?.message || "Не удалось добавить строку", variant: "destructive" });
    } finally {
      setLineMutationBusyByOperationId((prev) => ({ ...prev, [operation.id]: false }));
    }
  };

  const handlePatchOperationLineFact = async (operationId: string, lineId: string, patch: Partial<OperationLineFormData>) => {
    if (!profile?.company_id || !canUpdateOperationFacts) return;
    try {
      await updateOperationLine(lineId, profile.company_id, patch);
      await loadOperationLines(operationId);
    } catch (error: any) {
      toast({ title: "Ошибка", description: error?.message || "Не удалось обновить строку", variant: "destructive" });
    }
  };

  const handleSaveFact = async (operationId: string, line: OperationLine) => {
    if (!profile?.company_id || !canUpdateOperationFacts) return;
    try {
      await updateOperationLine(line.id, profile.company_id, { completed: true });
      await loadOperationLines(operationId);
      toast({ title: "Успешно", description: "Факт сохранён" });
    } catch (error: any) {
      toast({ title: "Ошибка", description: error?.message || "Не удалось сохранить факт", variant: "destructive" });
    }
  };

  const handleDeleteLine = async (operationId: string, lineId: string) => {
    if (!profile?.company_id || !canManageOperationLines) return;
    try {
      await deleteOperationLine(lineId, profile.company_id);
      await loadOperationLines(operationId);
      toast({ title: "Успешно", description: "Строка удалена" });
    } catch (error: any) {
      toast({ title: "Ошибка", description: error?.message || "Не удалось удалить строку", variant: "destructive" });
    }
  };

  const activeOperations = operations.filter((item) => (item.work_status || "active") === "active");
  const inProgressOperations = operations.filter((item) => (item.work_status || "active") === "in_progress");
  const completedOperations = operations.filter((item) => (item.work_status || "active") === "completed");
  const mobileOperations =
    mobileLaneFilter === "active"
      ? activeOperations
      : mobileLaneFilter === "in_progress"
        ? inProgressOperations
        : mobileLaneFilter === "completed"
          ? completedOperations
          : operations;

  const specialistLabelById = specialists.reduce<Record<string, string>>((acc, row) => {
    const baseName = String(row.full_name || "").trim() || row.email;
    acc[row.id] = `${baseName} (${row.role})`;
    return acc;
  }, {});

  const explorerRows = useMemo(() => {
    return operations
      .filter((operation) => (explorerField === "all" ? true : operation.field_id === explorerField))
      .filter((operation) =>
        explorerOperationType === "all" ? true : String(operation.operation_type_slug || operation.operation_type) === explorerOperationType
      )
      .filter((operation) => {
        const token = explorerMaterialSearch.trim().toLowerCase();
        if (!token) return true;
        const materialNames = (operation.materials || []).map((item) => String(item.product_name || "")).join(" ").toLowerCase();
        return materialNames.includes(token);
      });
  }, [explorerField, explorerMaterialSearch, explorerOperationType, operations]);

  const operationTypeOptions = useMemo(() => {
    const keys = Array.from(
      new Set(
        operations.map((operation) => String(operation.operation_type_slug || operation.operation_type || "").trim()).filter(Boolean)
      )
    );
    return keys.sort((a, b) => a.localeCompare(b, "ru"));
  }, [operations]);

  const renderOperationCards = (ops: OperationWithDetails[], emptyLabel: string) => {
    if (loading) return <div className="p-6 text-center text-slate-500">Загрузка...</div>;
    if (ops.length === 0) return <div className="p-6 text-center text-slate-500">{emptyLabel}</div>;

    return (
      <div className="space-y-3 p-4">
        {ops.map((operation) => {
          const isExpanded = !!expanded[operation.id];
          const lines = operationLinesByOperationId[operation.id] || [];
          const linesAllowed = shouldShowOperationLines(operation);
          const rowCropContext = isRowCrop(operation.crop_name);
          const identityOptions = getOperationLineIdentityOptions(operation);
          const materialsText = (operation.materials || [])
            .map((item) => `${item.product_name || item.product_id} (${item.material_type}, ${item.unit})`)
            .join("; ");

          return (
            <Card key={operation.id}>
              <CardHeader className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="text-base">
                      {operation.operation_type} • {operation.field_name}
                    </CardTitle>
                    <div className="text-sm text-slate-500">
                      {formatDate(operation.date)} • {operation.crop_name || "без культуры"} • {operation.planned_area_ha || 0} га
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {statusBadge(operation.work_status)}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const next = !expanded[operation.id];
                        setExpanded((prev) => ({ ...prev, [operation.id]: next }));
                        if (next && linesAllowed) void ensureLinesLoaded(operation);
                      }}
                    >
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { setEditingOperation(operation); setIsFormOpen(true); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { setOperationToArchive(operation); setArchiveDialogOpen(true); }}>
                      <Archive className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>

              {isExpanded ? (
                <CardContent className="pt-0 space-y-3">
                  <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                    <div><span className="text-slate-500">Категория:</span> {operation.operation_category_slug || "-"}</div>
                    <div><span className="text-slate-500">Код типа:</span> {operation.operation_type_slug || "-"}</div>
                    <div>
                      <span className="text-slate-500">Ответственный:</span>{" "}
                      {operation.responsible_user_id
                        ? specialistLabelById[operation.responsible_user_id] || operation.responsible_user_id
                        : "-"}
                    </div>
                    <div><span className="text-slate-500">Статус заявки:</span> {requestStatusByOperationId[operation.id] || "-"}</div>
                    <div><span className="text-slate-500">Target:</span> {operation.operation_target || "-"}</div>
                    <div>
                      <span className="text-slate-500">Нормы:</span>{" "}
                      {operation.rate_per_ha != null ? `${operation.rate_per_ha}/га` : "-"}{" "}
                      {operation.spray_volume_per_ha != null ? `• ${operation.spray_volume_per_ha} л/га` : ""}
                    </div>
                    <div className="md:col-span-2">
                      <span className="text-slate-500">Материалы:</span>{" "}
                      {materialsText || "не указаны"}
                    </div>
                    <div className="md:col-span-2">
                      <span className="text-slate-500">Комментарий:</span> {operation.notes || "-"}
                    </div>
                  </div>

                  {canManageOperationLines && !requestStatusByOperationId[operation.id] ? (
                    <div>
                      <Button type="button" size="sm" variant="outline" onClick={() => void handleEnsureMaterialRequest(operation)}>
                        Создать Material Request
                      </Button>
                    </div>
                  ) : null}

                  {linesAllowed ? (
                    <div className="rounded-md border p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-sm font-semibold">Operation lines</div>
                        <Badge variant="outline">{lines.length}</Badge>
                      </div>

                      {linesLoadingByOperationId[operation.id] ? (
                        <div className="text-xs text-slate-500">Загрузка строк...</div>
                      ) : null}
                      {!linesLoadingByOperationId[operation.id] && lines.length === 0 ? (
                        <div className="text-xs text-slate-500">Строк пока нет.</div>
                      ) : null}

                      <div className="space-y-2">
                        {lines.map((line) => {
                          const rowCrop = rowCropContext || isRowCrop(line.crop_name);
                          const plantsPerHa = Number(line.calculated_plants_per_ha || 0);
                          const totalPlants = Number(line.calculated_total_plants || 0);
                          return (
                            <div key={line.id} className="rounded-md border bg-slate-50 p-2 text-xs">
                              <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
                                <div>
                                  <div className="text-slate-500">Культура</div>
                                  <div className="font-medium">{line.crop_name || operation.crop_name || "—"}</div>
                                </div>
                                <div>
                                  <div className="text-slate-500">Сорт</div>
                                  <div className="font-medium">{line.variety_name || "—"}</div>
                                </div>
                                <div>
                                  <div className="text-slate-500">Репр.</div>
                                  <div className="font-medium">{line.reproduction_name || "—"}</div>
                                </div>
                                <div>
                                  <div className="text-slate-500">План, га</div>
                                  <div className="font-medium">{Number(line.planned_area_ha || 0).toFixed(2)}</div>
                                </div>
                                <div>
                                  <div className="text-slate-500">Факт, га</div>
                                  <Input
                                    className="h-7 text-xs"
                                    defaultValue={line.actual_area_ha == null ? "" : String(line.actual_area_ha)}
                                    onBlur={(event) =>
                                      void handlePatchOperationLineFact(operation.id, line.id, {
                                        actual_area_ha: event.target.value.trim() ? Number(event.target.value) : null,
                                      })
                                    }
                                    disabled={!canUpdateOperationFacts}
                                  />
                                </div>
                                <div className="flex items-end justify-end gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => void handleSaveFact(operation.id, line)}
                                    disabled={!canUpdateOperationFacts}
                                  >
                                    Сохранить факт
                                  </Button>
                                  {canManageOperationLines ? (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 px-2 text-xs text-red-600 hover:text-red-700"
                                      onClick={() => void handleDeleteLine(operation.id, line.id)}
                                    >
                                      Удалить
                                    </Button>
                                  ) : null}
                                </div>
                              </div>

                              {rowCrop ? (
                                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-5">
                                  <div>
                                    <div className="text-slate-500">Рядки, шт</div>
                                    <Input
                                      className="h-7 text-xs"
                                      defaultValue={line.row_count == null ? "" : String(line.row_count)}
                                      onBlur={(event) =>
                                        void handlePatchOperationLineFact(operation.id, line.id, {
                                          row_count: event.target.value.trim() ? Number(event.target.value) : null,
                                        })
                                      }
                                      disabled={!canUpdateOperationFacts}
                                    />
                                  </div>
                                  <div>
                                    <div className="text-slate-500">Междурядье, м</div>
                                    <Input
                                      className="h-7 text-xs"
                                      defaultValue={line.row_spacing_m == null ? "" : String(line.row_spacing_m)}
                                      onBlur={(event) =>
                                        void handlePatchOperationLineFact(operation.id, line.id, {
                                          row_spacing_m: event.target.value.trim() ? Number(event.target.value) : null,
                                        })
                                      }
                                      disabled={!canUpdateOperationFacts}
                                    />
                                  </div>
                                  <div>
                                    <div className="text-slate-500">Межсеменное, см</div>
                                    <Input
                                      className="h-7 text-xs"
                                      defaultValue={line.seed_spacing_cm == null ? "" : String(line.seed_spacing_cm)}
                                      onBlur={(event) =>
                                        void handlePatchOperationLineFact(operation.id, line.id, {
                                          seed_spacing_cm: event.target.value.trim() ? Number(event.target.value) : null,
                                        })
                                      }
                                      disabled={!canUpdateOperationFacts}
                                    />
                                  </div>
                                  <div>
                                    <div className="text-slate-500">Растений / га</div>
                                    <div className="h-7 rounded border bg-white px-2 py-1 text-xs font-medium">
                                      {plantsPerHa > 0 ? plantsPerHa.toFixed(0) : "—"}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-slate-500">Растений всего</div>
                                    <div className="h-7 rounded border bg-white px-2 py-1 text-xs font-medium">
                                      {totalPlants > 0 ? totalPlants.toFixed(0) : "—"}
                                    </div>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>

                      {canManageOperationLines ? (
                        <div className="mt-3 rounded-md border border-dashed p-2">
                          <div className="mb-2 text-xs font-medium text-slate-700">Добавить line</div>
                          <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
                            <div>
                              <div className="mb-1 text-[11px] text-slate-500">Сорт</div>
                              <Select
                                value={lineDraftByOperationId[operation.id]?.variety_id || "__none__"}
                                onValueChange={(value) => {
                                  const option = identityOptions.find((item) => item.varietyId === (value === "__none__" ? null : value));
                                  upsertLineDraft(operation.id, {
                                    variety_id: value === "__none__" ? null : value,
                                    reproduction_id: option?.reproductionId || null,
                                  });
                                }}
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue placeholder="—" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">—</SelectItem>
                                  {Array.from(
                                    new Map(
                                      identityOptions.filter((item) => item.varietyId).map((item) => [String(item.varietyId), item])
                                    ).values()
                                  ).map((item) => (
                                    <SelectItem key={item.key} value={String(item.varietyId)}>
                                      {item.label.split(" / ")[0]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <div className="mb-1 text-[11px] text-slate-500">Репр.</div>
                              <Select
                                value={lineDraftByOperationId[operation.id]?.reproduction_id || "__none__"}
                                onValueChange={(value) =>
                                  upsertLineDraft(operation.id, { reproduction_id: value === "__none__" ? null : value })
                                }
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue placeholder="—" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">—</SelectItem>
                                  {Array.from(
                                    new Map(
                                      identityOptions
                                        .filter((item) => {
                                          const selectedVarietyId = lineDraftByOperationId[operation.id]?.variety_id || null;
                                          if (!selectedVarietyId) return Boolean(item.reproductionId);
                                          return String(item.varietyId || "") === String(selectedVarietyId) && Boolean(item.reproductionId);
                                        })
                                        .map((item) => [String(item.reproductionId), item])
                                    ).values()
                                  ).map((item) => (
                                    <SelectItem key={item.key} value={String(item.reproductionId)}>
                                      {item.label.split(" / ")[1] || "—"}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <div className="mb-1 text-[11px] text-slate-500">План, га</div>
                              <Input
                                className="h-8 text-xs"
                                value={String(lineDraftByOperationId[operation.id]?.planned_area_ha ?? "")}
                                onChange={(event) =>
                                  upsertLineDraft(operation.id, { planned_area_ha: Number(event.target.value || 0) })
                                }
                              />
                            </div>
                            <div>
                              <div className="mb-1 text-[11px] text-slate-500">Факт, га</div>
                              <Input
                                className="h-8 text-xs"
                                value={
                                  lineDraftByOperationId[operation.id]?.actual_area_ha == null
                                    ? ""
                                    : String(lineDraftByOperationId[operation.id]?.actual_area_ha)
                                }
                                onChange={(event) =>
                                  upsertLineDraft(operation.id, {
                                    actual_area_ha: event.target.value.trim() ? Number(event.target.value) : null,
                                  })
                                }
                              />
                            </div>
                            <div>
                              <div className="mb-1 text-[11px] text-slate-500">Междурядье, м</div>
                              <Input
                                className="h-8 text-xs"
                                value={
                                  lineDraftByOperationId[operation.id]?.row_spacing_m == null
                                    ? ""
                                    : String(lineDraftByOperationId[operation.id]?.row_spacing_m)
                                }
                                onChange={(event) =>
                                  upsertLineDraft(operation.id, {
                                    row_spacing_m: event.target.value.trim() ? Number(event.target.value) : null,
                                  })
                                }
                              />
                            </div>
                            <div>
                              <div className="mb-1 text-[11px] text-slate-500">Межсеменное, см</div>
                              <Input
                                className="h-8 text-xs"
                                value={
                                  lineDraftByOperationId[operation.id]?.seed_spacing_cm == null
                                    ? ""
                                    : String(lineDraftByOperationId[operation.id]?.seed_spacing_cm)
                                }
                                onChange={(event) =>
                                  upsertLineDraft(operation.id, {
                                    seed_spacing_cm: event.target.value.trim() ? Number(event.target.value) : null,
                                  })
                                }
                              />
                            </div>
                          </div>
                          <div className="mt-2 flex justify-end">
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => void handleAddOperationLine(operation)}
                              disabled={lineMutationBusyByOperationId[operation.id] === true}
                            >
                              Добавить line
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      Для этого типа операции строки не используются. Работайте через материалы и факт операции.
                    </div>
                  )}
                </CardContent>
              ) : null}
            </Card>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Operations"
        description="Production-safe workflow: Operation → Material Request → Issue → Fact"
        action={{ label: "Add Operation", icon: Plus, onClick: () => setIsFormOpen(true) }}
      />

      <div className="flex flex-wrap gap-2 md:hidden">
        <Button
          type="button"
          variant={mobileLaneFilter === "active" ? "default" : "outline"}
          onClick={() => setMobileLaneFilter("active")}
          className="h-11"
        >
          Активные ({activeOperations.length})
        </Button>
        <Button
          type="button"
          variant={mobileLaneFilter === "in_progress" ? "default" : "outline"}
          onClick={() => setMobileLaneFilter("in_progress")}
          className="h-11"
        >
          В работе ({inProgressOperations.length})
        </Button>
        <Button
          type="button"
          variant={mobileLaneFilter === "completed" ? "default" : "outline"}
          onClick={() => setMobileLaneFilter("completed")}
          className="h-11"
        >
          Завершенные ({completedOperations.length})
        </Button>
        <Button
          type="button"
          variant={mobileLaneFilter === "all" ? "default" : "outline"}
          onClick={() => setMobileLaneFilter("all")}
          className="h-11"
        >
          Все ({operations.length})
        </Button>
      </div>

      <Card className="md:hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Лента операций</CardTitle>
        </CardHeader>
        <CardContent className="p-0">{renderOperationCards(mobileOperations, "Операции не найдены")}</CardContent>
      </Card>

      <div className="hidden grid-cols-1 gap-4 md:grid xl:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Активные ({activeOperations.length})</CardTitle></CardHeader>
          <CardContent className="p-0">{renderOperationCards(activeOperations, "Нет активных операций")}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">В работе ({inProgressOperations.length})</CardTitle></CardHeader>
          <CardContent className="p-0">{renderOperationCards(inProgressOperations, "Нет операций в работе")}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Завершенные ({completedOperations.length})</CardTitle></CardHeader>
          <CardContent className="p-0">{renderOperationCards(completedOperations, "Нет завершенных операций")}</CardContent>
        </Card>
      </div>

      <Card className="md:hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Быстрый обзор по полям</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="text-slate-500">Найдено операций по фильтру</div>
            <div className="mt-1 text-xl font-semibold">{explorerRows.length}</div>
          </div>
          <div className="space-y-2">
            {explorerRows.slice(0, 3).map((row) => (
              <div key={`mobile-explorer-${row.id}`} className="rounded-lg border border-slate-200 p-3">
                <div className="text-sm font-semibold">{row.operation_type}</div>
                <div className="text-xs text-slate-500">
                  {row.field_name} • {formatDate(row.date)}
                </div>
                <div className="mt-1 text-xs text-slate-600">{row.crop_name || "Без культуры"}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="hidden md:block">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Field Operations Explorer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            <Select value={explorerField} onValueChange={setExplorerField}>
              <SelectTrigger><SelectValue placeholder="Поле" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все поля</SelectItem>
                {fields.map((field) => (
                  <SelectItem key={field.id} value={field.id}>{field.display_name || field.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={explorerOperationType} onValueChange={setExplorerOperationType}>
              <SelectTrigger><SelectValue placeholder="Тип операции" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все типы</SelectItem>
                {operationTypeOptions.map((value) => (
                  <SelectItem key={value} value={value}>{value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Материал (поиск)"
              value={explorerMaterialSearch}
              onChange={(event) => setExplorerMaterialSearch(event.target.value)}
            />
            <div className="rounded border px-3 py-2 text-sm text-slate-600">Найдено: {explorerRows.length}</div>
          </div>

          <div className="max-h-[320px] overflow-auto rounded border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-100 text-slate-600">
                <tr>
                  <th className="px-2 py-2 text-left">Дата</th>
                  <th className="px-2 py-2 text-left">Поле</th>
                  <th className="px-2 py-2 text-left">Операция</th>
                  <th className="px-2 py-2 text-left">Материалы</th>
                  <th className="px-2 py-2 text-left">Статус</th>
                </tr>
              </thead>
              <tbody>
                {explorerRows.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="px-2 py-2">{formatDate(row.date)}</td>
                    <td className="px-2 py-2">{row.field_name}</td>
                    <td className="px-2 py-2">{row.operation_type}</td>
                    <td className="px-2 py-2">
                      {(row.materials || []).length > 0
                        ? (row.materials || [])
                            .map((item) => `${item.product_name || item.product_id} (${item.material_type})`)
                            .join(", ")
                        : "—"}
                    </td>
                    <td className="px-2 py-2">{statusBadge(row.work_status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="md:hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Картофель: материалы</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {potatoConsumptionLoading ? (
            <div className="text-sm text-slate-500">Загрузка отчета...</div>
          ) : potatoConsumptionRows.length === 0 ? (
            <div className="text-sm text-slate-500">Данных по картофелю пока нет.</div>
          ) : (
            <>
              <div className="rounded-lg border border-slate-200 p-3 text-sm">
                Записей: <span className="font-semibold">{potatoConsumptionRows.length}</span>
              </div>
              {potatoConsumptionRows.slice(0, 3).map((row, index) => (
                <div key={`mobile-potato-${index}`} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <div className="font-semibold">{row.field_name}</div>
                  <div className="text-xs text-slate-500">
                    {row.material_name} • выдано {Number(row.issued_qty_kg || 0).toFixed(2)} кг
                  </div>
                </div>
              ))}
            </>
          )}
        </CardContent>
      </Card>

      <Card className="hidden md:block">
        <CardHeader className="pb-2"><CardTitle className="text-base">Картофель: расход материалов</CardTitle></CardHeader>
        <CardContent className="p-0">
          {potatoConsumptionLoading ? (
            <div className="p-4 text-sm text-slate-500">Загрузка отчета...</div>
          ) : potatoConsumptionRows.length === 0 ? (
            <div className="p-4 text-sm text-slate-500">Пока нет данных по картофелю.</div>
          ) : (
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-100 text-left text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Поле</th>
                    <th className="px-3 py-2">Сорт / репр.</th>
                    <th className="px-3 py-2">План га</th>
                    <th className="px-3 py-2">Факт га</th>
                    <th className="px-3 py-2">% выполнения</th>
                    <th className="px-3 py-2">Материал</th>
                    <th className="px-3 py-2">Выдано</th>
                    <th className="px-3 py-2">Факт/га</th>
                    <th className="px-3 py-2">Норма/га</th>
                    <th className="px-3 py-2">Отклонение</th>
                    <th className="px-3 py-2">Потребность</th>
                    <th className="px-3 py-2">Остаток</th>
                  </tr>
                </thead>
                <tbody>
                  {potatoConsumptionRows.map((row, index) => (
                    <tr key={`${row.operation_line_id}-${row.material_name}-${row.linkage_scope}-${index}`} className="border-t">
                      <td className="px-3 py-2">{row.field_name}</td>
                      <td className="px-3 py-2">{row.variety_name || "—"} / {row.reproduction_name || "—"}</td>
                      <td className="px-3 py-2">{Number(row.planned_area_ha || 0).toFixed(2)}</td>
                      <td className="px-3 py-2">{row.actual_area_ha == null ? "—" : Number(row.actual_area_ha).toFixed(2)}</td>
                      <td className="px-3 py-2">{row.completion_pct == null ? "—" : `${row.completion_pct.toFixed(1)}%`}</td>
                      <td className="px-3 py-2">{row.material_name}</td>
                      <td className="px-3 py-2">{Number(row.issued_qty_kg || 0).toFixed(2)}</td>
                      <td className="px-3 py-2">{row.fact_qty_per_ha == null ? "—" : row.fact_qty_per_ha.toFixed(3)}</td>
                      <td className="px-3 py-2">{row.planned_norm_per_ha == null ? "—" : row.planned_norm_per_ha.toFixed(3)}</td>
                      <td className="px-3 py-2">{row.deviation_per_ha == null ? "—" : row.deviation_per_ha.toFixed(3)}</td>
                      <td className="px-3 py-2">{row.planned_need_kg == null ? "—" : row.planned_need_kg.toFixed(2)}</td>
                      <td className="px-3 py-2">{row.remaining_need_kg == null ? "—" : row.remaining_need_kg.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <OperationFormDialog
        open={isFormOpen}
        onOpenChange={(open) => {
          if (!open) setEditingOperation(null);
          setIsFormOpen(open);
        }}
        onSubmit={editingOperation ? handleUpdate : handleCreate}
        defaultValues={
          editingOperation
            ? {
                field_id: editingOperation.field_id,
                crop_structure_id: editingOperation.crop_structure_id,
                operation_category_slug: editingOperation.operation_category_slug || "",
                operation_type_slug: editingOperation.operation_type_slug || "",
                operation_type: editingOperation.operation_type,
                planned_area_ha: editingOperation.planned_area_ha ?? null,
                crop_id: editingOperation.crop_id || null,
                machine_id: editingOperation.machine_id || null,
                equipment_id: editingOperation.equipment_id || null,
                transport_id: editingOperation.transport_id || null,
                operation_target: editingOperation.operation_target || null,
                rate_per_ha: editingOperation.rate_per_ha ?? null,
                spray_volume_per_ha: editingOperation.spray_volume_per_ha ?? null,
                date: editingOperation.date,
                responsible_user_id: editingOperation.responsible_user_id,
                notes: editingOperation.notes || "",
                materials: (editingOperation.materials || []).map((item) => ({
                  material_type: item.material_type,
                  product_id: item.product_id,
                  batch_id: item.batch_id,
                  planned_rate: item.planned_rate,
                  actual_rate: item.actual_rate,
                  unit: item.unit,
                  notes: item.notes,
                })),
              }
            : undefined
        }
        isEdit={!!editingOperation}
        fields={fields}
        cropStructures={cropStructures}
        specialists={specialists}
      />

      <AlertDialog open={archiveDialogOpen} onOpenChange={setArchiveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Архивировать операцию</AlertDialogTitle>
            <AlertDialogDescription>
              Эта операция будет скрыта из активного списка, но останется в истории.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleArchive}>Архивировать</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
