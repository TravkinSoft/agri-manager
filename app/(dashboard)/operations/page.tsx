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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OperationFormDialog } from "@/components/operations/operation-form-dialog";
import { PesticideCardLink } from "@/components/platform/pesticide-card-link";
import {
  archiveOperation,
  createOperation,
  createOperationLine,
  deleteOperationLine,
  ensureOperationMaterialRequest,
  getAssignableSpecialists,
  getOperationLines,
  getOperations,
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
  SpecialistAssignee,
} from "@/lib/types/operation";
import { Field } from "@/lib/types/field";
import { CropStructureWithDetails } from "@/lib/types/crop-structure";
import { useLanguage } from "@/lib/contexts/language-context";
import { localizeUnit } from "@/lib/i18n/helpers";
import { formatVarietyReproduction } from "@/lib/operations/crop-identity";
import {
  getPurposeDefinitionsForOperation,
  getTankMixComponentDefinition,
  resolveCanonicalOperationType,
} from "@/lib/operations/operation-engine";

function isRowCrop(cropName: string | null | undefined): boolean {
  const normalized = String(cropName || "").trim().toLowerCase();
  if (!normalized) return false;
  return ["картофель", "морковь", "лук", "кукуруза", "свекла", "potato", "carrot", "onion", "corn"].some(
    (token) => normalized.includes(token)
  );
}

function shouldShowOperationLines(operation: OperationWithDetails): boolean {
  const engine = getOperationEngine(operation);
  if (engine?.requiresCropStructure) return true;
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

function getOperationEngine(operation: OperationWithDetails) {
  return resolveCanonicalOperationType({
    categorySlug: operation.operation_category_slug || operation.operation_engine_type,
    typeSlug: operation.operation_type_slug || operation.operation_engine_type,
    operationType: operation.operation_type,
  });
}

function getOperationPurposeLabels(operation: OperationWithDetails): string[] {
  const engine = getOperationEngine(operation);
  const labels = new Map<string, string>(
    getPurposeDefinitionsForOperation(engine?.slug || operation.operation_engine_type).map((item) => [item.slug, item.label])
  );
  return (operation.operation_purposes || []).map((slug) => labels.get(String(slug)) || String(slug));
}

function getTankMixComponents(operation: OperationWithDetails): Array<Record<string, any>> {
  const tankMix = operation.tank_mix;
  if (!tankMix || typeof tankMix !== "object" || !Array.isArray(tankMix.components)) return [];
  return tankMix.components as Array<Record<string, any>>;
}

function getMaterialComponentLabel(material: { material_type?: string | null; notes?: string | null }) {
  const noteComponent = String(material.notes || "").match(/component:([a-z_]+)/i)?.[1] || null;
  return getTankMixComponentDefinition(noteComponent || material.material_type).label;
}

export default function OperationsPage() {
  const { profile, loading: authLoading } = useAuth();
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
  const [selectedOperation, setSelectedOperation] = useState<OperationWithDetails | null>(null);

  const [explorerField, setExplorerField] = useState<string>("all");
  const [explorerOperationType, setExplorerOperationType] = useState<string>("all");
  const [explorerMaterialSearch, setExplorerMaterialSearch] = useState<string>("");
  const [mobileLaneFilter, setMobileLaneFilter] = useState<"active" | "in_progress" | "completed" | "all">("active");
  const [cropFilter, setCropFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [responsibleFilter, setResponsibleFilter] = useState<string>("all");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");

  const canManageOperationLines =
    profile?.role === "company_admin" || profile?.role === "global_admin" || profile?.role === "agronomist";
  const canUpdateOperationFacts = canManageOperationLines || profile?.role === "brigadier";

  const loadData = async () => {
    if (authLoading || !profile?.company_id) return;
    const companyId = profile.company_id;
    setLoading(true);
    try {
      const [opsRes, fieldsRes, cropRes, specialistRes, requestsRes] = await Promise.allSettled([
        getOperations(companyId),
        getFields(companyId),
        getCropStructures(companyId),
        getAssignableSpecialists(companyId),
        getWarehouseIssueRequests(companyId),
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

    } catch (error) {
      console.error(error);
      toast({ title: "Ошибка", description: "Не удалось загрузить операции", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    if (profile?.company_id) void loadData();
  }, [authLoading, profile?.company_id, language]);

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
        label: formatVarietyReproduction({
          varietyName: row.variety_name,
          reproductionName: row.reproduction_name,
        }),
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

  const handleCreate = async (data: OperationFormData, options?: { idempotencyKey?: string }) => {
    if (!profile?.company_id) return;
    try {
      const created = await createOperation(profile.company_id, data, options);
      if ((created as any)?.offline_queued) {
        setIsFormOpen(false);
        toast({
          title: "Сохранено оффлайн",
          description: "План добавлен в очередь и отправится автоматически, когда появится интернет.",
        });
        return;
      }
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
      throw error;
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
      throw error;
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

  const specialistLabelById = useMemo(
    () =>
      specialists.reduce<Record<string, string>>((acc, row) => {
        const baseName = String(row.full_name || "").trim() || row.email;
        acc[row.id] = `${baseName} (${row.role})`;
        return acc;
      }, {}),
    [specialists]
  );

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
  const countLabel = (value: number) => (loading || authLoading ? "..." : String(value));
  const todayIso = new Date().toISOString().slice(0, 10);
  const waitingMaterialsCount = operations.filter((operation) => {
    const requestStatus = String(requestStatusByOperationId[operation.id] || "").toLowerCase();
    return requestStatus && !["issued", "received", "completed", "closed", "cancelled"].includes(requestStatus);
  }).length;
  const overdueCount = operations.filter((operation) => {
    const status = String(operation.work_status || "active").toLowerCase();
    return status !== "completed" && String(operation.date || "").slice(0, 10) < todayIso;
  }).length;
  const cropOptions = useMemo(() => {
    const values = Array.from(new Set(operations.map((operation) => String(operation.crop_name || "").trim()).filter(Boolean)));
    return values.sort((a, b) => a.localeCompare(b, "ru"));
  }, [operations]);
  const responsibleOptions = useMemo(() => {
    const values = Array.from(
      new Set(operations.map((operation) => String(operation.responsible_user_id || "").trim()).filter(Boolean))
    );
    return values.sort((a, b) => (specialistLabelById[a] || a).localeCompare(specialistLabelById[b] || b, "ru"));
  }, [operations, specialistLabelById]);
  const filteredOperations = useMemo(() => {
    return operations
      .filter((operation) => (explorerField === "all" ? true : operation.field_id === explorerField))
      .filter((operation) =>
        cropFilter === "all" ? true : String(operation.crop_name || "").trim() === cropFilter
      )
      .filter((operation) =>
        explorerOperationType === "all"
          ? true
          : String(operation.operation_type_slug || operation.operation_type || "") === explorerOperationType
      )
      .filter((operation) =>
        statusFilter === "all" ? true : String(operation.work_status || "active") === statusFilter
      )
      .filter((operation) =>
        responsibleFilter === "all" ? true : String(operation.responsible_user_id || "") === responsibleFilter
      )
      .filter((operation) => {
        const date = String(operation.date || "").slice(0, 10);
        if (periodFrom && date < periodFrom) return false;
        if (periodTo && date > periodTo) return false;
        return true;
      })
      .filter((operation) => {
        const token = explorerMaterialSearch.trim().toLowerCase();
        if (!token) return true;
        const haystack = [
          operation.operation_type,
          operation.field_name,
          operation.crop_name,
          operation.variety_name,
          ...(operation.materials || []).map((item) => `${item.product_name || ""} ${item.material_type || ""}`),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(token);
      });
  }, [
    cropFilter,
    explorerField,
    explorerMaterialSearch,
    explorerOperationType,
    operations,
    periodFrom,
    periodTo,
    responsibleFilter,
    statusFilter,
  ]);
  const materialAnalyticsRows = useMemo(() => {
    const grouped = new Map<
      string,
      {
        material: string;
        materialType: string;
        unit: string;
        planned: number;
        issued: number;
        consumed: number;
        returned: number;
        operations: number;
      }
    >();
    filteredOperations.forEach((operation) => {
      (operation.materials || []).forEach((material) => {
        const key = `${material.product_id}|${material.material_type}|${material.unit}`;
        const current =
          grouped.get(key) ||
          {
            material: String(material.product_name || material.product_id || "-"),
            materialType: String(material.material_type || "-"),
            unit: String(material.unit || ""),
            planned: 0,
            issued: 0,
            consumed: 0,
            returned: 0,
            operations: 0,
          };
        current.planned += Number(material.planned_quantity || 0);
        current.issued += Number(material.issued_quantity || 0);
        current.consumed += Number(material.consumed_quantity || 0);
        current.returned += Number(material.returned_quantity || 0);
        current.operations += 1;
        grouped.set(key, current);
      });
    });
    return Array.from(grouped.values()).sort((a, b) => b.issued - a.issued || a.material.localeCompare(b.material, "ru"));
  }, [filteredOperations]);
  const displayUnit = (unit: string | null | undefined) => localizeUnit(unit || "", language) || String(unit || "");
  const displayRateUnit = (unit: string | null | undefined) => localizeUnit(`${unit || ""}/ha`, language) || `${displayUnit(unit)}/га`;
  const formatQuantity = (value: number, unit: string) => `${Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ${displayUnit(unit)}`;
  const renderMaterialsText = (operation: OperationWithDetails) =>
    (operation.materials || []).length > 0
      ? (operation.materials || [])
          .map((item) => `${item.product_name || item.product_id} (${item.material_type}, ${displayUnit(item.unit)})`)
          .join("; ")
      : "—";

  const renderOperationCards = (ops: OperationWithDetails[], emptyLabel: string) => {
    if (loading) return <div className="p-6 text-center text-slate-500">Загрузка...</div>;
    if (ops.length === 0) return <div className="p-6 text-center text-slate-500">{emptyLabel}</div>;

    return (
      <div className="space-y-3 p-4">
        {ops.map((operation) => {
          const isExpanded = !!expanded[operation.id];
          const engine = getOperationEngine(operation);
          const purposeLabels = getOperationPurposeLabels(operation);
          const lines = operationLinesByOperationId[operation.id] || [];
          const linesAllowed = shouldShowOperationLines(operation);
          const rowCropContext = isRowCrop(operation.crop_name);
          const identityOptions = getOperationLineIdentityOptions(operation);
          const materialsText = (operation.materials || [])
            .map((item) => `${item.product_name || item.product_id} (${item.material_type}, ${displayUnit(item.unit)})`)
            .join("; ");

          return (
            <Card key={operation.id}>
              <CardHeader className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="text-base">
                      {operation.operation_engine_label || engine?.label || operation.operation_type} • {operation.field_name}
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
                    <div><span className="text-slate-500">Тип работ:</span> {operation.operation_engine_label || engine?.label || operation.operation_type || "-"}</div>
                    <div><span className="text-slate-500">Цели:</span> {purposeLabels.length > 0 ? purposeLabels.join(", ") : "-"}</div>
                    <div>
                      <span className="text-slate-500">Ответственный:</span>{" "}
                      {operation.responsible_user_id
                        ? specialistLabelById[operation.responsible_user_id] || operation.responsible_user_id
                        : "-"}
                    </div>
                    <div><span className="text-slate-500">Статус заявки:</span> {requestStatusByOperationId[operation.id] || "-"}</div>
                    <div><span className="text-slate-500">Способ/назначение:</span> {operation.operation_target || "-"}</div>
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
                        Создать заявку склада
                      </Button>
                    </div>
                  ) : null}

                  {linesAllowed ? (
                    <div className="rounded-md border p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-sm font-semibold">План и факт по строкам посевов</div>
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
                          <div className="mb-2 text-xs font-medium text-slate-700">Добавить строку факта</div>
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
                              Добавить строку факта
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

  const selectedOperationEngine = selectedOperation ? getOperationEngine(selectedOperation) : null;
  const selectedOperationPurposes = selectedOperation ? getOperationPurposeLabels(selectedOperation) : [];
  const selectedTankMixComponents = selectedOperation ? getTankMixComponents(selectedOperation) : [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Операции"
        description="Поле → структура посевов → операция → материалы → склад → факт"
        action={{ label: "Новая операция", icon: Plus, onClick: () => setIsFormOpen(true) }}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="rounded-md border bg-card p-3">
          <div className="text-xs text-muted-foreground">Всего</div>
          <div className="mt-1 text-2xl font-semibold">{countLabel(operations.length)}</div>
        </div>
        <div className="rounded-md border bg-card p-3">
          <div className="text-xs text-muted-foreground">Активные</div>
          <div className="mt-1 text-2xl font-semibold">{countLabel(activeOperations.length)}</div>
        </div>
        <div className="rounded-md border bg-card p-3">
          <div className="text-xs text-muted-foreground">В работе</div>
          <div className="mt-1 text-2xl font-semibold">{countLabel(inProgressOperations.length)}</div>
        </div>
        <div className="rounded-md border bg-card p-3">
          <div className="text-xs text-muted-foreground">Ожидают склад</div>
          <div className="mt-1 text-2xl font-semibold">{countLabel(waitingMaterialsCount)}</div>
        </div>
        <div className="rounded-md border bg-card p-3">
          <div className="text-xs text-muted-foreground">Просрочены</div>
          <div className="mt-1 text-2xl font-semibold">{countLabel(overdueCount)}</div>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Фильтры</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3 xl:grid-cols-6">
            <Select value={explorerField} onValueChange={setExplorerField}>
              <SelectTrigger><SelectValue placeholder="Поле" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все поля</SelectItem>
                {fields.map((field) => (
                  <SelectItem key={field.id} value={field.id}>{field.display_name || field.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={cropFilter} onValueChange={setCropFilter}>
              <SelectTrigger><SelectValue placeholder="Культура" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все культуры</SelectItem>
                {cropOptions.map((crop) => (
                  <SelectItem key={crop} value={crop}>{crop}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={explorerOperationType} onValueChange={setExplorerOperationType}>
              <SelectTrigger><SelectValue placeholder="Операция" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все операции</SelectItem>
                {operationTypeOptions.map((value) => (
                  <SelectItem key={value} value={value}>{value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger><SelectValue placeholder="Статус" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все статусы</SelectItem>
                <SelectItem value="active">Активные</SelectItem>
                <SelectItem value="in_progress">В работе</SelectItem>
                <SelectItem value="completed">Завершенные</SelectItem>
              </SelectContent>
            </Select>
            <Select value={responsibleFilter} onValueChange={setResponsibleFilter}>
              <SelectTrigger><SelectValue placeholder="Ответственный" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все ответственные</SelectItem>
                {responsibleOptions.map((id) => (
                  <SelectItem key={id} value={id}>{specialistLabelById[id] || id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Материал / поле / сорт"
              value={explorerMaterialSearch}
              onChange={(event) => setExplorerMaterialSearch(event.target.value)}
            />
          </div>
          <details className="rounded-md border px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium">Дополнительные фильтры</summary>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
              <Input type="date" value={periodFrom} onChange={(event) => setPeriodFrom(event.target.value)} />
              <Input type="date" value={periodTo} onChange={(event) => setPeriodTo(event.target.value)} />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setExplorerField("all");
                  setCropFilter("all");
                  setExplorerOperationType("all");
                  setStatusFilter("all");
                  setResponsibleFilter("all");
                  setExplorerMaterialSearch("");
                  setPeriodFrom("");
                  setPeriodTo("");
                }}
              >
                Сбросить
              </Button>
            </div>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Журнал операций ({countLabel(filteredOperations.length)})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Загрузка операций...</div>
          ) : filteredOperations.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">Операции не найдены.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата</TableHead>
                  <TableHead>Поле</TableHead>
                  <TableHead>Культура</TableHead>
                  <TableHead>Сорт</TableHead>
                  <TableHead>Операция</TableHead>
                  <TableHead>Площадь</TableHead>
                  <TableHead>Ответственный</TableHead>
                  <TableHead>Материалы</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="w-[96px]"> </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOperations.map((operation) => (
                  <TableRow
                    key={operation.id}
                    className="cursor-pointer"
                    onClick={() => {
                      setSelectedOperation(operation);
                      void ensureLinesLoaded(operation);
                    }}
                  >
                    <TableCell>{formatDate(operation.date)}</TableCell>
                    <TableCell className="font-medium">{operation.field_name}</TableCell>
                    <TableCell>{operation.crop_name || "—"}</TableCell>
                    <TableCell>{operation.variety_name || "—"}</TableCell>
                    <TableCell>{operation.operation_type}</TableCell>
                    <TableCell>{Number(operation.planned_area_ha || 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} га</TableCell>
                    <TableCell>
                      {operation.responsible_user_id
                        ? specialistLabelById[operation.responsible_user_id] || operation.responsible_user_id
                        : "—"}
                    </TableCell>
                    <TableCell className="max-w-[320px] truncate">{renderMaterialsText(operation)}</TableCell>
                    <TableCell>{statusBadge(operation.work_status)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(event) => {
                            event.stopPropagation();
                            setEditingOperation(operation);
                            setIsFormOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(event) => {
                            event.stopPropagation();
                            setOperationToArchive(operation);
                            setArchiveDialogOpen(true);
                          }}
                        >
                          <Archive className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Материалы по операциям</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {materialAnalyticsRows.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">Материалы по выбранному фильтру не найдены.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Материал</TableHead>
                  <TableHead>Тип</TableHead>
                  <TableHead>План</TableHead>
                  <TableHead>Выдано</TableHead>
                  <TableHead>Факт</TableHead>
                  <TableHead>Возврат</TableHead>
                  <TableHead>Операций</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {materialAnalyticsRows.slice(0, 30).map((row) => (
                  <TableRow key={`${row.material}-${row.materialType}-${row.unit}`}>
                    <TableCell className="font-medium">{row.material}</TableCell>
                    <TableCell>{row.materialType}</TableCell>
                    <TableCell>{formatQuantity(row.planned, row.unit)}</TableCell>
                    <TableCell>{formatQuantity(row.issued, row.unit)}</TableCell>
                    <TableCell>{formatQuantity(row.consumed, row.unit)}</TableCell>
                    <TableCell>{formatQuantity(row.returned, row.unit)}</TableCell>
                    <TableCell>{row.operations}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!selectedOperation} onOpenChange={(open) => !open && setSelectedOperation(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
          {selectedOperation ? (
            <>
              <SheetHeader>
                <SheetTitle>{selectedOperation.operation_type}</SheetTitle>
                <SheetDescription>
                  {selectedOperation.field_name} • {selectedOperation.crop_name || "без культуры"} • {formatDate(selectedOperation.date)}
                </SheetDescription>
              </SheetHeader>
              <Tabs defaultValue="general" className="mt-5">
                <TabsList className="grid h-auto w-full grid-cols-5">
                  <TabsTrigger value="general">Общее</TabsTrigger>
                  <TabsTrigger value="materials">Материалы</TabsTrigger>
                  <TabsTrigger value="warehouse">Склад</TabsTrigger>
                  <TabsTrigger value="fact">Факт</TabsTrigger>
                  <TabsTrigger value="history">История</TabsTrigger>
                </TabsList>
                <TabsContent value="general" className="space-y-3 text-sm">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div><span className="text-muted-foreground">Тип работ:</span> {selectedOperation.operation_engine_label || selectedOperationEngine?.label || selectedOperation.operation_type}</div>
                    <div><span className="text-muted-foreground">Цели:</span> {selectedOperationPurposes.length > 0 ? selectedOperationPurposes.join(", ") : "—"}</div>
                    <div><span className="text-muted-foreground">Поле:</span> {selectedOperation.field_name}</div>
                    <div>
                      <span className="text-muted-foreground">План поля:</span>{" "}
                      {selectedOperation.crop_name || "—"}
                      {selectedOperation.variety_name ? ` • ${selectedOperation.variety_name}` : ""}
                      {selectedOperation.reproduction_name ? ` • ${selectedOperation.reproduction_name}` : ""}
                    </div>
                    <div><span className="text-muted-foreground">Культура:</span> {selectedOperation.crop_name || "—"}</div>
                    <div><span className="text-muted-foreground">Сорт:</span> {selectedOperation.variety_name || "—"}</div>
                    <div><span className="text-muted-foreground">Репродукция:</span> {selectedOperation.reproduction_name || "—"}</div>
                    <div><span className="text-muted-foreground">Площадь:</span> {Number(selectedOperation.planned_area_ha || 0).toFixed(2)} га</div>
                    <div><span className="text-muted-foreground">Способ/назначение:</span> {selectedOperation.operation_target || "—"}</div>
                    <div><span className="text-muted-foreground">Статус:</span> {statusBadge(selectedOperation.work_status)}</div>
                    <div className="md:col-span-2"><span className="text-muted-foreground">Комментарий:</span> {selectedOperation.notes || "—"}</div>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={() => { setEditingOperation(selectedOperation); setIsFormOpen(true); }}>
                      Редактировать
                    </Button>
                    {canManageOperationLines && !requestStatusByOperationId[selectedOperation.id] ? (
                      <Button type="button" variant="outline" onClick={() => void handleEnsureMaterialRequest(selectedOperation)}>
                        Создать заявку склада
                      </Button>
                    ) : null}
                  </div>
                </TabsContent>
                <TabsContent value="materials">
                  {selectedOperation.tank_mix?.enabled || selectedTankMixComponents.length > 0 ? (
                    <div className="mb-3 rounded-md border bg-slate-50 p-3 text-sm">
                      <div className="font-semibold">Баковая смесь</div>
                      <div className="mt-1 text-muted-foreground">
                        Вода: {selectedOperation.tank_mix?.water_rate_l_ha ?? "—"} л/га • Рабочий раствор: {selectedOperation.tank_mix?.total_solution_l_ha ?? "—"} л/га • Компонентов: {selectedTankMixComponents.length}
                      </div>
                    </div>
                  ) : null}
                  {(selectedOperation.materials || []).length === 0 ? (
                    <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Материалы не указаны.</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Материал</TableHead>
                          <TableHead>Компонент</TableHead>
                          <TableHead>План норма</TableHead>
                          <TableHead>Факт норма</TableHead>
                          <TableHead>Выдано</TableHead>
                          <TableHead>Факт</TableHead>
                          <TableHead>Возврат</TableHead>
                          <TableHead>Потери</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(selectedOperation.materials || []).map((material) => {
                          const issued = Number(material.issued_quantity || 0);
                          const consumed = Number(material.consumed_quantity || 0);
                          const returned = Number(material.returned_quantity || 0);
                          const loss = Math.max(issued - consumed - returned, 0);
                          return (
                            <TableRow key={material.id}>
                              <TableCell className="font-medium">
                                <div className="flex items-center gap-1">
                                  <span>{material.product_name || material.product_id}</span>
                                  {String(material.product_type || "").toLowerCase() === "pesticide" ? (
                                    <PesticideCardLink productId={material.master_product_id} />
                                  ) : null}
                                </div>
                              </TableCell>
                              <TableCell>{getMaterialComponentLabel(material)}</TableCell>
                              <TableCell>{material.planned_rate ?? "—"} {displayRateUnit(material.unit)}</TableCell>
                              <TableCell>{material.actual_rate ?? "—"} {displayRateUnit(material.unit)}</TableCell>
                              <TableCell>{formatQuantity(issued, material.unit)}</TableCell>
                              <TableCell>{formatQuantity(consumed, material.unit)}</TableCell>
                              <TableCell>{formatQuantity(returned, material.unit)}</TableCell>
                              <TableCell>{formatQuantity(loss, material.unit)}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                  <div className="rounded-md border p-3">
                    <div className="mb-2 text-sm font-semibold">Факт материалов</div>
                    <div className="mb-3 text-xs text-muted-foreground">
                      Выдача не считается расходом. Закрытие операции требует фактический расход, возврат и комментарий.
                    </div>
                    {(selectedOperation.materials || []).length === 0 ? (
                      <div className="text-sm text-muted-foreground">Материалы для факта не указаны.</div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Материал</TableHead>
                            <TableHead>Выдано</TableHead>
                            <TableHead>Факт расхода</TableHead>
                            <TableHead>Возврат</TableHead>
                            <TableHead>Потери</TableHead>
                            <TableHead>Комментарий</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(selectedOperation.materials || []).map((material) => {
                            const issued = Number(material.issued_quantity || 0);
                            const consumed = Number(material.consumed_quantity || 0);
                            const returned = Number(material.returned_quantity || 0);
                            const loss = Math.max(issued - consumed - returned, 0);
                            return (
                              <TableRow key={`fact-${material.id}`}>
                                <TableCell>{material.product_name || material.product_id}</TableCell>
                                <TableCell>{formatQuantity(issued, material.unit)}</TableCell>
                                <TableCell>{material.consumed_quantity == null ? "—" : formatQuantity(consumed, material.unit)}</TableCell>
                                <TableCell>{material.returned_quantity == null ? "—" : formatQuantity(returned, material.unit)}</TableCell>
                                <TableCell>{formatQuantity(loss, material.unit)}</TableCell>
                                <TableCell>{material.notes || "—"}</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                </TabsContent>
                <TabsContent value="warehouse" className="space-y-3 text-sm">
                  <div><span className="text-muted-foreground">Статус заявки:</span> {requestStatusByOperationId[selectedOperation.id] || "заявка не создана"}</div>
                  <div className="rounded-md border border-dashed p-4 text-muted-foreground">
                    Цепочка V2: План операции → Потребность → Выдача склада → Выполнение → Факт расхода → Возврат → История поля.
                  </div>
                </TabsContent>
                <TabsContent value="fact" className="space-y-3">
                  {linesLoadingByOperationId[selectedOperation.id] ? (
                    <div className="text-sm text-muted-foreground">Загрузка факта...</div>
                  ) : (operationLinesByOperationId[selectedOperation.id] || []).length === 0 ? (
                    <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Строк факта пока нет.</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Поле</TableHead>
                          <TableHead>План, га</TableHead>
                          <TableHead>Факт, га</TableHead>
                          <TableHead>Сорт</TableHead>
                          <TableHead>Репродукция</TableHead>
                          <TableHead>Завершено</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(operationLinesByOperationId[selectedOperation.id] || []).map((line) => (
                          <TableRow key={line.id}>
                            <TableCell>{line.field_name || selectedOperation.field_name}</TableCell>
                            <TableCell>{Number(line.planned_area_ha || 0).toFixed(2)}</TableCell>
                            <TableCell>{line.actual_area_ha == null ? "—" : Number(line.actual_area_ha).toFixed(2)}</TableCell>
                            <TableCell>{line.variety_name || "—"}</TableCell>
                            <TableCell>{line.reproduction_name || "—"}</TableCell>
                            <TableCell>{line.completed_at ? formatDate(line.completed_at) : "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </TabsContent>
                <TabsContent value="history" className="space-y-2 text-sm">
                  <div><span className="text-muted-foreground">Создана:</span> {formatDate(selectedOperation.created_at)}</div>
                  <div><span className="text-muted-foreground">Обновлена:</span> {formatDate(selectedOperation.updated_at)}</div>
                  <div><span className="text-muted-foreground">Принята:</span> {selectedOperation.accepted_at ? formatDate(selectedOperation.accepted_at) : "—"}</div>
                  <div><span className="text-muted-foreground">Завершена:</span> {selectedOperation.completed_at ? formatDate(selectedOperation.completed_at) : "—"}</div>
                  <div><span className="text-muted-foreground">Комментарий специалиста:</span> {selectedOperation.specialist_comment || "—"}</div>
                </TabsContent>
              </Tabs>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <div className="hidden" aria-hidden="true">

      <div className="flex flex-wrap gap-2 md:hidden">
        <Button
          type="button"
          variant={mobileLaneFilter === "active" ? "default" : "outline"}
          onClick={() => setMobileLaneFilter("active")}
          className="h-11"
        >
          Активные ({countLabel(activeOperations.length)})
        </Button>
        <Button
          type="button"
          variant={mobileLaneFilter === "in_progress" ? "default" : "outline"}
          onClick={() => setMobileLaneFilter("in_progress")}
          className="h-11"
        >
          В работе ({countLabel(inProgressOperations.length)})
        </Button>
        <Button
          type="button"
          variant={mobileLaneFilter === "completed" ? "default" : "outline"}
          onClick={() => setMobileLaneFilter("completed")}
          className="h-11"
        >
          Завершенные ({countLabel(completedOperations.length)})
        </Button>
        <Button
          type="button"
          variant={mobileLaneFilter === "all" ? "default" : "outline"}
          onClick={() => setMobileLaneFilter("all")}
          className="h-11"
        >
          Все ({countLabel(operations.length)})
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
          <CardHeader className="pb-2"><CardTitle className="text-base">Активные ({countLabel(activeOperations.length)})</CardTitle></CardHeader>
          <CardContent className="p-0">{renderOperationCards(activeOperations, "Нет активных операций")}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">В работе ({countLabel(inProgressOperations.length)})</CardTitle></CardHeader>
          <CardContent className="p-0">{renderOperationCards(inProgressOperations, "Нет операций в работе")}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Завершенные ({countLabel(completedOperations.length)})</CardTitle></CardHeader>
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
            <div className="mt-1 text-xl font-semibold">{countLabel(explorerRows.length)}</div>
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
            <div className="rounded border px-3 py-2 text-sm text-slate-600">Найдено: {countLabel(explorerRows.length)}</div>
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

      </div>

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
                field_id: editingOperation.field_id || "",
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
                purposes: editingOperation.operation_purposes || [],
                tank_mix: editingOperation.tank_mix || undefined,
                materials: (editingOperation.materials || []).map((item) => ({
                  component_type: String(item.notes || "").match(/component:([a-z_]+)/i)?.[1] as any,
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
