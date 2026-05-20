"use client";

import { useState, useEffect } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Plus, Pencil, Archive, ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { OperationFormDialog } from "@/components/operations/operation-form-dialog";
import {
  getOperations,
  createOperation,
  updateOperation,
  archiveOperation,
  getAssignableSpecialists,
  getOperationLines,
  createOperationLine,
  updateOperationLine,
  deleteOperationLine,
  getPotatoMaterialConsumptionReport,
} from "@/lib/services/operations";
import { getFields } from "@/lib/services/fields";
import { getCropStructures } from "@/lib/services/crop-structure";
import {
  OperationLine,
  OperationLineFormData,
  OperationWithDetails,
  PotatoMaterialConsumptionRow,
} from "@/lib/types/operation";
import { OperationFormData } from "@/lib/types/operation";
import { SpecialistAssignee } from "@/lib/types/operation";
import { Field } from "@/lib/types/field";
import { CropStructureWithDetails } from "@/lib/types/crop-structure";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/contexts/auth-context";
import { useLanguage } from "@/lib/contexts/language-context";
import { getWarehouseIssueRequests } from "@/lib/services/warehouse-requests";

function isRowCrop(cropName: string | null | undefined): boolean {
  const normalized = String(cropName || "").trim().toLowerCase();
  if (!normalized) return false;
  return [
    "картофель",
    "морковь",
    "лук",
    "кукуруза",
    "свекла",
  ].some((token) => normalized.includes(token));
}

export default function OperationsPage() {
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
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [requestStatusByOperationId, setRequestStatusByOperationId] = useState<Record<string, string>>({});
  const [operationLinesByOperationId, setOperationLinesByOperationId] = useState<Record<string, OperationLine[]>>({});
  const [linesLoadingByOperationId, setLinesLoadingByOperationId] = useState<Record<string, boolean>>({});
  const [lineDraftByOperationId, setLineDraftByOperationId] = useState<Record<string, OperationLineFormData>>({});
  const [lineMutationBusyByOperationId, setLineMutationBusyByOperationId] = useState<Record<string, boolean>>({});
  const [potatoConsumptionRows, setPotatoConsumptionRows] = useState<PotatoMaterialConsumptionRow[]>([]);
  const [potatoConsumptionLoading, setPotatoConsumptionLoading] = useState(false);
  const { toast } = useToast();
  const { profile } = useAuth();
  const canManageOperationLines =
    profile?.role === "company_admin" ||
    profile?.role === "global_admin" ||
    profile?.role === "agronomist";
  const canUpdateOperationFacts =
    canManageOperationLines ||
    profile?.role === "brigadier";

  const loadData = async () => {
    if (!profile?.company_id) return;

    try {
      setLoading(true);
      setPotatoConsumptionLoading(true);
      const [operationsResult, fieldsResult, cropStructuresResult, specialistsResult, requestsResult, potatoReportResult] = await Promise.allSettled([
        getOperations(profile.company_id),
        getFields(profile.company_id),
        getCropStructures(profile.company_id),
        getAssignableSpecialists(profile.company_id),
        getWarehouseIssueRequests(profile.company_id, language),
        getPotatoMaterialConsumptionReport(profile.company_id, { seasonYear: new Date().getFullYear(), limit: 2000 }),
      ]);

      if (operationsResult.status === "fulfilled") {
        setOperations(operationsResult.value);
      } else {
        throw operationsResult.reason;
      }

      setFields(fieldsResult.status === "fulfilled" ? fieldsResult.value : []);
      setCropStructures(cropStructuresResult.status === "fulfilled" ? cropStructuresResult.value : []);
      setSpecialists(specialistsResult.status === "fulfilled" ? specialistsResult.value : []);
      if (requestsResult.status === "fulfilled") {
        const nextMap: Record<string, string> = {};
        requestsResult.value.forEach((row) => {
          if (row.operation_id) nextMap[row.operation_id] = row.status;
        });
        setRequestStatusByOperationId(nextMap);
      } else {
        setRequestStatusByOperationId({});
      }

      if (potatoReportResult.status === "fulfilled") {
        setPotatoConsumptionRows(potatoReportResult.value);
      } else {
        setPotatoConsumptionRows([]);
      }
    } catch {
      toast({
        title: "Error",
        description: "Failed to load data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      setPotatoConsumptionLoading(false);
    }
  };

  useEffect(() => {
    if (profile?.company_id) loadData();
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

  const upsertLineDraft = (operationId: string, patch: Partial<OperationLineFormData>) => {
    setLineDraftByOperationId((prev) => {
      const existing = prev[operationId];
      if (!existing) return prev;
      return { ...prev, [operationId]: { ...existing, ...patch } };
    });
  };

  const loadOperationLines = async (operationId: string) => {
    if (!profile?.company_id) return;
    try {
      setLinesLoadingByOperationId((prev) => ({ ...prev, [operationId]: true }));
      const lines = await getOperationLines(operationId, profile.company_id);
      setOperationLinesByOperationId((prev) => ({ ...prev, [operationId]: lines }));
    } catch (error: any) {
      toast({
        title: "Error",
        description: error?.message || "Failed to load operation lines",
        variant: "destructive",
      });
    } finally {
      setLinesLoadingByOperationId((prev) => ({ ...prev, [operationId]: false }));
    }
  };

  const ensureOperationLinesLoaded = async (operation: OperationWithDetails) => {
    if (!operationLinesByOperationId[operation.id]) {
      await loadOperationLines(operation.id);
    }
    setLineDraftByOperationId((prev) => {
      if (prev[operation.id]) return prev;
      return { ...prev, [operation.id]: makeDefaultLineDraft(operation) };
    });
  };

  const handleAddOperationLine = async (operation: OperationWithDetails) => {
    if (!profile?.company_id || !canManageOperationLines) return;
    const draft = lineDraftByOperationId[operation.id] || makeDefaultLineDraft(operation);
    if (!Number.isFinite(draft.planned_area_ha) || Number(draft.planned_area_ha) < 0) {
      toast({
        title: "Validation",
        description: "Planned area must be >= 0",
        variant: "destructive",
      });
      return;
    }
    try {
      setLineMutationBusyByOperationId((prev) => ({ ...prev, [operation.id]: true }));
      await createOperationLine(operation.id, profile.company_id, draft);
      await loadOperationLines(operation.id);
      setLineDraftByOperationId((prev) => ({ ...prev, [operation.id]: makeDefaultLineDraft(operation) }));
      toast({ title: "Success", description: "Operation line created" });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error?.message || "Failed to create operation line",
        variant: "destructive",
      });
    } finally {
      setLineMutationBusyByOperationId((prev) => ({ ...prev, [operation.id]: false }));
    }
  };

  const handleSaveFact = async (operationId: string, line: OperationLine) => {
    if (!profile?.company_id || !canUpdateOperationFacts) return;
    try {
      await updateOperationLine(line.id, profile.company_id, { completed: true });
      await loadOperationLines(operationId);
      toast({ title: "Success", description: "Line fact saved" });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error?.message || "Failed to save fact line",
        variant: "destructive",
      });
    }
  };

  const handlePatchOperationLineFact = async (
    operationId: string,
    lineId: string,
    patch: Partial<OperationLineFormData>
  ) => {
    if (!profile?.company_id || !canUpdateOperationFacts) return;
    try {
      await updateOperationLine(lineId, profile.company_id, patch);
      await loadOperationLines(operationId);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error?.message || "Failed to update operation line",
        variant: "destructive",
      });
    }
  };

  const handleDeleteLine = async (operationId: string, lineId: string) => {
    if (!profile?.company_id || !canManageOperationLines) return;
    try {
      await deleteOperationLine(lineId, profile.company_id);
      await loadOperationLines(operationId);
      toast({ title: "Success", description: "Operation line deleted" });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error?.message || "Failed to delete operation line",
        variant: "destructive",
      });
    }
  };

  const handleCreate = async (data: OperationFormData) => {
    if (!profile?.company_id) return;
    try {
      await createOperation(profile.company_id, data);
      setIsFormOpen(false);
      await loadData();
      toast({ title: "Success", description: "Operation added successfully" });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to add operation",
        variant: "destructive",
      });
    }
  };

  const handleUpdate = async (data: OperationFormData) => {
    if (!editingOperation) return;
    try {
      await updateOperation(editingOperation.id, data);
      setEditingOperation(null);
      setIsFormOpen(false);
      await loadData();
      toast({ title: "Success", description: "Operation updated successfully" });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update operation",
        variant: "destructive",
      });
    }
  };

  const handleArchive = async () => {
    if (!operationToArchive) return;
    try {
      await archiveOperation(operationToArchive.id);
      setArchiveDialogOpen(false);
      setOperationToArchive(null);
      await loadData();
      toast({ title: "Success", description: "Operation archived successfully" });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to archive operation",
        variant: "destructive",
      });
    }
  };

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  const getStatusBadge = (status: string) => {
    const styles = {
      active: "bg-slate-100 text-slate-800",
      in_progress: "bg-orange-100 text-orange-800",
      completed: "bg-green-100 text-green-800",
    };
    return (
      <Badge className={styles[status as keyof typeof styles] || "bg-slate-100 text-slate-800"}>
        {status?.replace("_", " ") || "active"}
      </Badge>
    );
  };

  const activeOperations = operations.filter((op) => (op.work_status || "active") === "active");
  const inProgressOperations = operations.filter((op) => (op.work_status || "active") === "in_progress");
  const completedOperations = operations.filter((op) => (op.work_status || "active") === "completed");

  const toggleExpand = (operation: OperationWithDetails) => {
    setExpandedIds((prev) => {
      const nextExpanded = !prev[operation.id];
      if (nextExpanded) void ensureOperationLinesLoaded(operation);
      return { ...prev, [operation.id]: nextExpanded };
    });
  };

  const specialistLabelById = specialists.reduce<Record<string, string>>((acc, item) => {
    const baseName = String(item.full_name || "").trim() || item.email;
    acc[item.id] = `${baseName} (${item.role})`;
    return acc;
  }, {});

  const OperationCards = ({ ops, emptyLabel }: { ops: OperationWithDetails[]; emptyLabel: string }) => {
    if (loading) return <div className="p-6 text-center text-slate-500">Loading...</div>;
    if (ops.length === 0) return <div className="p-6 text-center text-slate-500">{emptyLabel}</div>;

    return (
      <div className="space-y-3 p-4">
        {ops.map((operation) => {
          const expanded = !!expandedIds[operation.id];
          return (
            <Card key={operation.id}>
              <CardHeader className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="text-base">
                      {operation.operation_type} • {operation.field_name}
                    </CardTitle>
                    <div className="text-sm text-slate-500">
                      {formatDate(operation.date)} • {operation.crop_name}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(operation.work_status || "active")}
                    <Button variant="ghost" size="sm" onClick={() => toggleExpand(operation)}>
                      {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
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
              {expanded && (
                <CardContent className="pt-0">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div><span className="text-slate-500">Target:</span> {operation.draft_target || "-"}</div>
                    <div><span className="text-slate-500">Основной препарат:</span> {operation.draft_main_product || "-"}</div>
                    <div><span className="text-slate-500">Дополнительные препараты:</span> {operation.draft_additional_products || "-"}</div>
                    <div><span className="text-slate-500">Норма препарата на га:</span> {operation.draft_rate_per_ha || "-"}</div>
                    <div><span className="text-slate-500">Норма вылива:</span> {operation.draft_mixture_volume_per_ha || "-"}</div>
                    <div><span className="text-slate-500">Machine / equipment:</span> {operation.draft_equipment || "-"}</div>
                    <div>
                      <span className="text-slate-500">Responsible:</span>{" "}
                      {operation.responsible_user_id
                        ? specialistLabelById[operation.responsible_user_id] || operation.draft_responsible || operation.responsible_user_id
                        : operation.draft_responsible || "-"}
                    </div>
                    <div><span className="text-slate-500">Work status:</span> {operation.work_status || "active"}</div>
                    <div><span className="text-slate-500">Specialist comment:</span> {operation.specialist_comment || "-"}</div>
                    <div>
                      <span className="text-slate-500">Warehouse request:</span>{" "}
                      {requestStatusByOperationId[operation.id] || "-"}
                    </div>
                  </div>
                  <div className="mt-3 text-sm">
                    <div className="text-slate-500">Details</div>
                    <div className="whitespace-pre-wrap">{operation.notes || "-"}</div>
                  </div>

                  <div className="mt-4 rounded-md border p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-sm font-semibold">Operation Lines</div>
                      <Badge variant="outline">{(operationLinesByOperationId[operation.id] || []).length}</Badge>
                    </div>

                    {linesLoadingByOperationId[operation.id] ? (
                      <div className="text-xs text-slate-500">Loading lines...</div>
                    ) : null}

                    {(operationLinesByOperationId[operation.id] || []).length === 0 && !linesLoadingByOperationId[operation.id] ? (
                      <div className="text-xs text-slate-500">No operation lines yet.</div>
                    ) : null}

                    <div className="space-y-2">
                      {(operationLinesByOperationId[operation.id] || []).map((line) => {
                        const rowCrop = isRowCrop(line.crop_name || operation.crop_name);
                        const plantsPerHa = Number(line.calculated_plants_per_ha || 0);
                        const totalPlants = Number(line.calculated_total_plants || 0);
                        return (
                          <div key={line.id} className="rounded-md border bg-slate-50 p-2 text-xs">
                            <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
                              <div>
                                <div className="text-slate-500">Crop</div>
                                <div className="font-medium">{line.crop_name || operation.crop_name || "—"}</div>
                              </div>
                              <div>
                                <div className="text-slate-500">Variety</div>
                                <div className="font-medium">{line.variety_name || "—"}</div>
                              </div>
                              <div>
                                <div className="text-slate-500">Reproduction</div>
                                <div className="font-medium">{line.reproduction_name || "—"}</div>
                              </div>
                              <div>
                                <div className="text-slate-500">Plan, ha</div>
                                <div className="font-medium">{Number(line.planned_area_ha || 0).toFixed(2)}</div>
                              </div>
                              <div>
                                <div className="text-slate-500">Fact, ha</div>
                                <Input
                                  className="h-7 text-xs"
                                  defaultValue={line.actual_area_ha == null ? "" : String(line.actual_area_ha)}
                                  onBlur={(event) => {
                                    const value = event.target.value.trim();
                                    void handlePatchOperationLineFact(operation.id, line.id, {
                                      actual_area_ha: value ? Number(value) : null,
                                    });
                                  }}
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
                                  Mark fact
                                </Button>
                                {canManageOperationLines ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-xs text-red-600 hover:text-red-700"
                                    onClick={() => void handleDeleteLine(operation.id, line.id)}
                                  >
                                    Delete
                                  </Button>
                                ) : null}
                              </div>
                            </div>

                            {rowCrop ? (
                              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-5">
                                <div>
                                  <div className="text-slate-500">Rows, pcs</div>
                                  <Input
                                    className="h-7 text-xs"
                                    defaultValue={line.row_count == null ? "" : String(line.row_count)}
                                    onBlur={(event) => {
                                      const value = event.target.value.trim();
                                      void handlePatchOperationLineFact(operation.id, line.id, {
                                        row_count: value ? Number(value) : null,
                                      });
                                    }}
                                    disabled={!canUpdateOperationFacts}
                                  />
                                </div>
                                <div>
                                  <div className="text-slate-500">Row spacing, m</div>
                                  <Input
                                    className="h-7 text-xs"
                                    defaultValue={line.row_spacing_m == null ? "" : String(line.row_spacing_m)}
                                    onBlur={(event) => {
                                      const value = event.target.value.trim();
                                      void handlePatchOperationLineFact(operation.id, line.id, {
                                        row_spacing_m: value ? Number(value) : null,
                                      });
                                    }}
                                    disabled={!canUpdateOperationFacts}
                                  />
                                </div>
                                <div>
                                  <div className="text-slate-500">Seed spacing, cm</div>
                                  <Input
                                    className="h-7 text-xs"
                                    defaultValue={line.seed_spacing_cm == null ? "" : String(line.seed_spacing_cm)}
                                    onBlur={(event) => {
                                      const value = event.target.value.trim();
                                      void handlePatchOperationLineFact(operation.id, line.id, {
                                        seed_spacing_cm: value ? Number(value) : null,
                                      });
                                    }}
                                    disabled={!canUpdateOperationFacts}
                                  />
                                </div>
                                <div>
                                  <div className="text-slate-500">Plants / ha</div>
                                  <div className="h-7 rounded border bg-white px-2 py-1 text-xs font-medium">
                                    {plantsPerHa > 0 ? plantsPerHa.toFixed(0) : "—"}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-slate-500">Plants total</div>
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
                        <div className="mb-2 text-xs font-medium text-slate-700">Add line</div>
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                          <div>
                            <div className="mb-1 text-[11px] text-slate-500">Plan, ha</div>
                            <Input
                              className="h-8 text-xs"
                              value={String(lineDraftByOperationId[operation.id]?.planned_area_ha ?? "")}
                              onChange={(event) => upsertLineDraft(operation.id, { planned_area_ha: Number(event.target.value || 0) })}
                            />
                          </div>
                          <div>
                            <div className="mb-1 text-[11px] text-slate-500">Fact, ha</div>
                            <Input
                              className="h-8 text-xs"
                              value={lineDraftByOperationId[operation.id]?.actual_area_ha == null ? "" : String(lineDraftByOperationId[operation.id]?.actual_area_ha)}
                              onChange={(event) =>
                                upsertLineDraft(operation.id, { actual_area_ha: event.target.value.trim() ? Number(event.target.value) : null })
                              }
                            />
                          </div>
                          <div>
                            <div className="mb-1 text-[11px] text-slate-500">Row spacing, m</div>
                            <Input
                              className="h-8 text-xs"
                              value={lineDraftByOperationId[operation.id]?.row_spacing_m == null ? "" : String(lineDraftByOperationId[operation.id]?.row_spacing_m)}
                              onChange={(event) =>
                                upsertLineDraft(operation.id, { row_spacing_m: event.target.value.trim() ? Number(event.target.value) : null })
                              }
                            />
                          </div>
                          <div>
                            <div className="mb-1 text-[11px] text-slate-500">Seed spacing, cm</div>
                            <Input
                              className="h-8 text-xs"
                              value={lineDraftByOperationId[operation.id]?.seed_spacing_cm == null ? "" : String(lineDraftByOperationId[operation.id]?.seed_spacing_cm)}
                              onChange={(event) =>
                                upsertLineDraft(operation.id, { seed_spacing_cm: event.target.value.trim() ? Number(event.target.value) : null })
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
                            Add line
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    );
  };

  return (
    <div>
      <PageHeader
        title="Operations"
        description="Track agronomic operations and work performed on your fields"
        action={{
          label: "Add Operation",
          icon: Plus,
          onClick: () => setIsFormOpen(true),
        }}
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Активные ({activeOperations.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <OperationCards ops={activeOperations} emptyLabel="Нет активных операций" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">В работе ({inProgressOperations.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <OperationCards ops={inProgressOperations} emptyLabel="Нет операций в работе" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Завершенные ({completedOperations.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <OperationCards ops={completedOperations} emptyLabel="Нет завершенных операций" />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Картофель: расход материалов</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {potatoConsumptionLoading ? (
            <div className="p-4 text-sm text-slate-500">Loading report...</div>
          ) : potatoConsumptionRows.length === 0 ? (
            <div className="p-4 text-sm text-slate-500">No potato material data yet.</div>
          ) : (
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-100">
                  <tr className="text-left text-slate-600">
                    <th className="px-3 py-2">Field</th>
                    <th className="px-3 py-2">Variety / repro</th>
                    <th className="px-3 py-2">Plan ha</th>
                    <th className="px-3 py-2">Fact ha</th>
                    <th className="px-3 py-2">% done</th>
                    <th className="px-3 py-2">Material</th>
                    <th className="px-3 py-2">Issued kg</th>
                    <th className="px-3 py-2">Fact/ha</th>
                    <th className="px-3 py-2">Norm/ha</th>
                    <th className="px-3 py-2">Deviation</th>
                  </tr>
                </thead>
                <tbody>
                  {potatoConsumptionRows.map((row) => (
                    <tr key={`${row.operation_line_id}-${row.material_name}`} className="border-t">
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
                operation_type: editingOperation.operation_type,
                date: editingOperation.date,
                responsible_user_id: editingOperation.responsible_user_id,
                notes: editingOperation.notes || "",
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
            <AlertDialogTitle>Archive Operation</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to archive this operation? This will remove it from active list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleArchive}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
