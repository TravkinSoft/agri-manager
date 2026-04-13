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
import { OperationFormDialog } from "@/components/operations/operation-form-dialog";
import {
  getOperations,
  createOperation,
  updateOperation,
  archiveOperation,
  getAssignableSpecialists,
} from "@/lib/services/operations";
import { getFields } from "@/lib/services/fields";
import { getCropStructures } from "@/lib/services/crop-structure";
import { OperationWithDetails } from "@/lib/types/operation";
import { OperationFormData } from "@/lib/types/operation";
import { SpecialistAssignee } from "@/lib/types/operation";
import { Field } from "@/lib/types/field";
import { CropStructureWithDetails } from "@/lib/types/crop-structure";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/contexts/auth-context";
import { useLanguage } from "@/lib/contexts/language-context";
import { getWarehouseIssueRequests } from "@/lib/services/warehouse-requests";

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
  const { toast } = useToast();
  const { profile } = useAuth();

  const loadData = async () => {
    if (!profile?.company_id) return;

    try {
      setLoading(true);
      const [operationsResult, fieldsResult, cropStructuresResult, specialistsResult, requestsResult] = await Promise.allSettled([
        getOperations(profile.company_id),
        getFields(profile.company_id),
        getCropStructures(profile.company_id),
        getAssignableSpecialists(profile.company_id),
        getWarehouseIssueRequests(profile.company_id, language),
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
    } catch {
      toast({
        title: "Error",
        description: "Failed to load data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (profile?.company_id) loadData();
  }, [profile?.company_id, language]);

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

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
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
                    <Button variant="ghost" size="sm" onClick={() => toggleExpand(operation.id)}>
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
