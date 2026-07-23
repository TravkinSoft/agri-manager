'use client';

import { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/contexts/auth-context';
import { useLanguage } from '@/lib/contexts/language-context';
import { localizeUnit } from '@/lib/i18n/helpers';
import { supabase } from '@/lib/supabase/client';
import { hasQaDataMarker } from '@/lib/utils/qa-data';
import { resolveWorkTitle } from '@/lib/operations/work-title';
import { resolveCropIdentity } from '@/lib/operations/crop-identity';
import {
  buildOperationPresentation,
  type OperationPresentation,
} from '@/lib/operations/operation-presentation';
import { OperationPlanDetails } from '@/components/operations/operation-plan-details';
import type {
  OperationCompletionRequest,
  OperationProgressReport,
  OperationWithDetails,
} from '@/lib/types/operation';
import {
  confirmWarehouseReceipt,
  getRecipientWarehouseIssueRequests,
} from '@/lib/services/warehouse-requests';
import {
  attachOperationAssetRelations,
  getOperationAssetCatalog,
} from '@/lib/services/operations';
import type { WarehouseIssueRequest } from '@/lib/types/warehouse-request';
import {
  CalendarDays,
  CheckCircle,
  Clock,
  PackageCheck,
  Search,
} from 'lucide-react';

interface OperationLine {
  id: string;
  field_id?: string | null;
  field_name?: string | null;
  crop_id: string | null;
  variety_id: string | null;
  reproduction_id: string | null;
  planned_area_ha: number | null;
  actual_area_ha: number | null;
  crop_name?: string | null;
  variety_name?: string | null;
  reproduction_name?: string | null;
  crops?: { name: string | null; name_ru?: string | null } | null;
  varieties?: { name: string | null } | null;
  reproductions?: { name: string | null; name_ru?: string | null } | null;
}

interface OperationMaterial {
  id: string;
  product_id: string | null;
  material_type: string | null;
  planned_rate?: number | null;
  rate_basis?: string | null;
  planned_quantity: number | null;
  issued_quantity: number | null;
  consumed_quantity: number | null;
  returned_quantity: number | null;
  loss_quantity?: number | null;
  actual_rate: number | null;
  unit: string | null;
  products?: { name: string | null; trade_name?: string | null; unit?: string | null } | null;
}

interface TaskCropIdentity {
  operation_id: string;
  crop_name: string | null;
  variety_name: string | null;
  reproduction_name: string | null;
}

interface Operation {
  id: string;
  operation_type: string;
  operation_category_slug?: string | null;
  operation_type_slug?: string | null;
  operation_engine_label?: string | null;
  operation_engine_type?: string | null;
  planned_area_ha?: number | null;
  completed_area_ha?: number | null;
  remaining_area_ha?: number | null;
  progress_percent?: number | null;
  operation_target?: string | null;
  rate_per_ha?: number | null;
  spray_volume_per_ha?: number | null;
  operation_params?: Record<string, unknown> | null;
  operation_config?: Record<string, unknown> | null;
  date: string;
  notes: string | null;
  status?: string | null;
  operation_status?: string | null;
  specialist_task_status?: string | null;
  work_status?: 'active' | 'in_progress' | 'completed' | null;
  accepted_at?: string | null;
  completed_at: string | null;
  started_at?: string | null;
  responsible_name?: string | null;
  machine_id?: string | null;
  equipment_id?: string | null;
  transport_id?: string | null;
  machine?: Record<string, unknown> | Record<string, unknown>[] | null;
  equipment?: Record<string, unknown> | Record<string, unknown>[] | null;
  transport?: Record<string, unknown> | Record<string, unknown>[] | null;
  fields?: { name: string | null } | null;
  crop_structure?: {
    crops?: { name: string | null; name_ru?: string | null } | null;
    varieties?: { name: string | null } | null;
    seed_reproductions?: { name: string | null; name_ru?: string | null } | null;
  } | null;
  operation_lines?: OperationLine[];
  operation_materials?: OperationMaterial[];
  operation_progress?: OperationProgressReport[];
  operation_completion_requests?: OperationCompletionRequest[];
  task_crop_identity?: TaskCropIdentity | null;
}

type TaskPhase =
  | 'active'
  | 'accepted'
  | 'in_progress'
  | 'awaiting_reconciliation'
  | 'awaiting_approval'
  | 'completed';
type ConfirmationKind = 'progress' | 'finish';

const STOP_REASONS = [
  'Дождь',
  'Ветер',
  'Температура',
  'Поломка',
  'Нет материалов',
  'Ожидание склада',
  'Состояние поля',
  'Решение агронома',
  'Конец смены',
  'Другое',
];

function operationHasQaMarker(operation: Operation): boolean {
  return hasQaDataMarker(
    [
      operation.operation_type,
      operation.notes,
      operation.fields?.name,
      operation.crop_structure?.crops?.name,
      operation.crop_structure?.crops?.name_ru,
      operation.crop_structure?.varieties?.name,
    ].join(' ')
  );
}

function requestHasQaMarker(request: WarehouseIssueRequest): boolean {
  return hasQaDataMarker(
    [
      request.request_number,
      request.comment,
      request.operation_type,
      request.field_name,
      request.source_warehouse_name,
      ...(request.items || []).map((item) => `${item.product_name || ''} ${item.product_type || ''}`),
    ].join(' ')
  );
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function toNumber(value: unknown, fallback = 0): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function normalizeOperationRow(row: any): Operation {
  const cropStructure = relationOne(row.crop_structure);
  return {
    ...row,
    fields: relationOne(row.fields),
    machine: relationOne(row.machine),
    equipment: relationOne(row.equipment),
    transport: relationOne(row.transport),
    operation_progress: Array.isArray(row.operation_progress) ? row.operation_progress : [],
    operation_completion_requests: Array.isArray(row.operation_completion_requests)
      ? row.operation_completion_requests
      : [],
    crop_structure: cropStructure
      ? {
          ...cropStructure,
          crops: relationOne(cropStructure.crops),
          varieties: relationOne(cropStructure.varieties),
          seed_reproductions: relationOne(cropStructure.seed_reproductions),
        }
      : null,
    operation_lines: Array.isArray(row.operation_lines)
      ? row.operation_lines.map((line: any) => ({
          id: String(line.id),
          field_id: line.field_id || null,
          field_name: line.field_name || relationOne(line.fields)?.name || null,
          crop_id: line.crop_id || null,
          variety_id: line.variety_id || null,
          reproduction_id: line.reproduction_id || null,
          planned_area_ha: line.planned_area_ha == null ? null : toNumber(line.planned_area_ha),
          actual_area_ha: line.actual_area_ha == null ? null : toNumber(line.actual_area_ha),
          crop_name: line.crop_name || null,
          variety_name: line.variety_name || null,
          reproduction_name: line.reproduction_name || null,
          crops: relationOne(line.crops),
          varieties: relationOne(line.varieties),
          reproductions: relationOne(line.reproductions),
        }))
      : [],
    operation_materials: Array.isArray(row.operation_materials)
      ? row.operation_materials.map((material: any) => ({
          ...material,
          products: relationOne(material.products),
          planned_quantity: material.planned_quantity == null ? null : toNumber(material.planned_quantity),
          issued_quantity: material.issued_quantity == null ? null : toNumber(material.issued_quantity),
          consumed_quantity: material.consumed_quantity == null ? null : toNumber(material.consumed_quantity),
          returned_quantity: material.returned_quantity == null ? null : toNumber(material.returned_quantity),
          loss_quantity: material.loss_quantity == null ? null : toNumber(material.loss_quantity),
          actual_rate: material.actual_rate == null ? null : toNumber(material.actual_rate),
        }))
      : [],
  } as Operation;
}

function getOperationCropIdentity(operation: Operation) {
  const line = operation.operation_lines?.find(
    (item) => item.crop_id || item.variety_id || item.reproduction_id || item.crops || item.varieties || item.reproductions
  );
  return resolveCropIdentity(
    {
      cropName: operation.task_crop_identity?.crop_name,
      varietyName: operation.task_crop_identity?.variety_name,
      reproductionName: operation.task_crop_identity?.reproduction_name,
    },
    {
      cropName: operation.crop_structure?.crops?.name_ru || operation.crop_structure?.crops?.name,
      varietyName: operation.crop_structure?.varieties?.name,
      reproductionName:
        operation.crop_structure?.seed_reproductions?.name_ru || operation.crop_structure?.seed_reproductions?.name,
    },
    {
      cropName: line?.crop_name || line?.crops?.name_ru || line?.crops?.name,
      varietyName: line?.variety_name || line?.varieties?.name,
      reproductionName: line?.reproduction_name || line?.reproductions?.name_ru || line?.reproductions?.name,
    }
  );
}

function getTaskPhase(task: Operation): TaskPhase {
  if (
    task.operation_status === 'ready_to_close' ||
    task.specialist_task_status === 'ready_to_close'
  ) {
    return 'awaiting_reconciliation';
  }
  if (
    task.operation_status === 'awaiting_approval' ||
    task.specialist_task_status === 'awaiting_approval' ||
    (task.operation_completion_requests || []).some((request) => request.status === 'pending')
  ) {
    return 'awaiting_approval';
  }
  if (task.work_status === 'completed' || task.status === 'completed') return 'completed';
  if (
    task.work_status === 'in_progress' ||
    task.status === 'in_progress' ||
    task.operation_status === 'in_progress' ||
    task.operation_status === 'paused' ||
    task.specialist_task_status === 'in_progress' ||
    task.specialist_task_status === 'paused'
  ) return 'in_progress';
  if (
    task.status === 'accepted' ||
    task.operation_status === 'accepted' ||
    task.specialist_task_status === 'accepted' ||
    task.accepted_at
  ) return 'accepted';
  return 'active';
}

function materialRequestsReadyForStart(requests: WarehouseIssueRequest[]): boolean {
  const activeRequests = requests.filter((request) => request.status !== 'cancelled');
  if (activeRequests.length === 0) return true;
  return activeRequests.every((request) => {
    if (request.status === 'issued' || request.status === 'issued_by_warehouse') return true;
    return request.status === 'received_confirmed' && Boolean(request.issued_at);
  });
}

function materialRequestsReconciled(requests: WarehouseIssueRequest[]): boolean {
  const activeRequests = requests.filter((request) => request.status !== 'cancelled');
  if (activeRequests.length === 0) return false;
  return activeRequests.every(
    (request) =>
      request.warehouse_request_status === 'closed' &&
      (request.items || []).length > 0 &&
      (request.items || []).every((item) => item.reconciliation_status === 'reconciled')
  );
}

function materialStatusText(requests: WarehouseIssueRequest[]): string {
  const activeRequests = requests.filter((request) => request.status !== 'cancelled');
  if (activeRequests.length === 0) return 'Материалы не требуются';
  if (activeRequests.some((request) => request.status === 'new' || request.status === 'active')) return 'Заявка на складе';
  if (activeRequests.some((request) => request.status === 'ready')) return 'Материалы готовы, нужно принять';
  if (activeRequests.some((request) => request.status === 'received_confirmed' && !request.issued_at)) {
    return 'Товар принят, ждём выдачу склада';
  }
  if (materialRequestsReadyForStart(activeRequests)) return 'Материалы выданы';
  if (activeRequests.some((request) => request.status === 'preparing')) return 'Склад готовит материалы';
  return 'Заявка на складе';
}

function taskStatusBadge(phase: TaskPhase, readyWithoutMaterials = false) {
  if (readyWithoutMaterials && (phase === 'active' || phase === 'accepted')) {
    return <Badge className="bg-emerald-500/15 text-emerald-200 border border-emerald-400/30">Готово к работе</Badge>;
  }
  const map: Record<TaskPhase, { label: string; className: string }> = {
    active: { label: 'Новая', className: 'bg-slate-700 text-slate-100' },
    accepted: { label: 'Принята', className: 'bg-blue-500/15 text-blue-200 border border-blue-400/30' },
    in_progress: { label: 'В работе', className: 'bg-amber-500/15 text-amber-200 border border-amber-400/30' },
    awaiting_reconciliation: {
      label: 'Ожидает сверку',
      className: 'bg-orange-500/15 text-orange-200 border border-orange-400/30',
    },
    awaiting_approval: { label: 'На подтверждении', className: 'bg-violet-500/15 text-violet-200 border border-violet-400/30' },
    completed: { label: 'Закончена', className: 'bg-emerald-500/15 text-emerald-200 border border-emerald-400/30' },
  };
  const item = map[phase];
  return <Badge className={item.className}>{item.label}</Badge>;
}

function requestStatusBadge(status: string) {
  if (status === 'ready') return <Badge className="bg-blue-500/15 text-blue-200 border border-blue-400/30">Готово к выдаче</Badge>;
  if (status === 'received_confirmed') return <Badge className="bg-emerald-500/15 text-emerald-200 border border-emerald-400/30">Товар принят</Badge>;
  if (status === 'issued' || status === 'issued_by_warehouse') {
    return <Badge className="bg-violet-500/15 text-violet-200 border border-violet-400/30">Выдано</Badge>;
  }
  if (status === 'partially_issued') return <Badge className="bg-amber-500/15 text-amber-200 border border-amber-400/30">Частично выдано</Badge>;
  if (status === 'preparing') return <Badge className="bg-cyan-500/15 text-cyan-200 border border-cyan-400/30">Готовится</Badge>;
  return <Badge className="bg-slate-700 text-slate-100">На складе</Badge>;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Дата не указана';
  return new Date(value).toLocaleDateString('ru-RU');
}

function formatQty(value: unknown, unit?: string | null): string {
  const numeric = toNumber(value, 0);
  const formatted = numeric % 1 === 0 ? numeric.toFixed(0) : numeric.toFixed(2);
  return `${formatted} ${unit || ''}`.trim();
}

function operationMaterialName(material: OperationMaterial): string {
  return material.products?.trade_name || material.products?.name || material.material_type || 'Материал';
}

function operationVisibleMaterials(operation: Operation): OperationMaterial[] {
  return (operation.operation_materials || []).filter((material) => !hasQaDataMarker(operationMaterialName(material)));
}

function operationReadyForProgress(
  operation: Operation,
  requests: WarehouseIssueRequest[]
): boolean {
  const hasAgrochemicalWithoutRequest =
    requests.length === 0 &&
    operationVisibleMaterials(operation).some((material) =>
      ['pesticide', 'fertilizer', 'adjuvant', 'ph_corrector', 'defoamer', 'biological', 'organic', 'other'].includes(
        String(material.material_type || '')
      )
    );
  return materialRequestsReadyForStart(requests) && !hasAgrochemicalWithoutRequest;
}

function operationWorkTitle(operation: Operation): string {
  return operationPresentation(operation).workTitle || resolveWorkTitle({
    operationType: operation.operation_type,
    operationTypeSlug: operation.operation_type_slug,
    operationCategorySlug: operation.operation_category_slug,
    operationEngineLabel: operation.operation_engine_label,
    materials: operationVisibleMaterials(operation).map((material) => ({
      material_type: material.material_type,
      product_type: material.material_type,
      product_name: operationMaterialName(material),
    })),
  });
}

function operationPresentation(operation: Operation): OperationPresentation {
  const cropIdentity = getOperationCropIdentity(operation);
  return buildOperationPresentation({
    ...operation,
    field_id: null,
    crop_structure_id: null,
    responsible_user_id: null,
    user_id: '',
    created_at: '',
    updated_at: '',
    archived: false,
    field_name: operation.fields?.name || undefined,
    crop_name: cropIdentity.cropName || undefined,
    variety_name: cropIdentity.varietyName || undefined,
    reproduction_name: cropIdentity.reproductionName || undefined,
    materials: operation.operation_materials as any,
    operation_lines: operation.operation_lines as any,
    progress_reports: operation.operation_progress || [],
    completion_requests: operation.operation_completion_requests || [],
  } as OperationWithDetails);
}

function operationAreaStats(operation: Operation) {
  const presentation = operationPresentation(operation);
  return {
    planned: presentation.plannedAreaHa,
    completed: presentation.completedAreaHa,
    remaining: presentation.remainingAreaHa,
    deviation: presentation.deviationAreaHa,
    percent: presentation.progressPercent,
  };
}

export default function TasksPage() {
  const { profile } = useAuth();
  const { language } = useLanguage();
  const { toast } = useToast();

  const [operations, setOperations] = useState<Operation[]>([]);
  const [materialRequests, setMaterialRequests] = useState<WarehouseIssueRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null);
  const [completionComment, setCompletionComment] = useState('Выполнено специалистом');
  const [progressAreaDraft, setProgressAreaDraft] = useState('');
  const [progressStopReason, setProgressStopReason] = useState('');
  const [progressWeatherNote, setProgressWeatherNote] = useState('');
  const [progressComment, setProgressComment] = useState('');
  const [finishVarianceReason, setFinishVarianceReason] = useState('');
  const [confirmationKind, setConfirmationKind] = useState<ConfirmationKind | null>(null);
  const [acceptOperationId, setAcceptOperationId] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState('');
  const [historyFrom, setHistoryFrom] = useState('');
  const [historyTo, setHistoryTo] = useState('');

  const isTaskRole = profile?.role === 'specialist' || profile?.role === 'brigadier';

  const buildAuthHeaders = async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session?.access_token) {
      throw new Error('Сессия не найдена. Войдите заново.');
    }
    return {
      Authorization: `Bearer ${data.session.access_token}`,
      'Content-Type': 'application/json',
    };
  };

  const getTaskCropIdentities = async (): Promise<TaskCropIdentity[]> => {
    if (!profile?.company_id) return [];
    const response = await fetch(
      `/api/tasks/operation-identities?companyId=${encodeURIComponent(profile.company_id)}`,
      { headers: await buildAuthHeaders(), cache: 'no-store' }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || 'Не удалось загрузить identity задач');
    return Array.isArray(payload?.identities) ? payload.identities : [];
  };

  const loadTasks = async () => {
    if (!profile?.id || !profile.company_id) return;
    setLoading(true);
    try {
      const [operationsResult, requestsResult, assetCatalog] = await Promise.all([
        supabase
          .from('operations')
          .select(
            `
            id,
            operation_type,
            operation_category_slug,
            operation_type_slug,
            operation_target,
            rate_per_ha,
            spray_volume_per_ha,
            operation_params,
            operation_config,
            operation_engine_label,
            operation_engine_type,
            responsible_name,
            planned_area_ha,
            completed_area_ha,
            remaining_area_ha,
            progress_percent,
            date,
            notes,
            status,
            operation_status,
            specialist_task_status,
            work_status,
            accepted_at,
            started_at,
            completed_at,
            machine_id,
            equipment_id,
            transport_id,
            fields(name),
            crop_structure(
              crops(name,name_ru),
              varieties(name),
              seed_reproductions(name,name_ru)
            ),
            operation_lines(
              id,
              field_id,
              crop_id,
              variety_id,
              reproduction_id,
              planned_area_ha,
              actual_area_ha,
              fields:field_id(name),
              crops:crop_id(name,name_ru),
              varieties:variety_id(name),
              reproductions:reproduction_id(name,name_ru)
            ),
            operation_materials(
              id,
              material_type,
              product_id,
              planned_rate,
              rate_basis,
              planned_quantity,
              issued_quantity,
              consumed_quantity,
              returned_quantity,
              loss_quantity,
              actual_rate,
              unit,
              products(name,trade_name,unit)
            ),
            operation_progress:operation_progress(
              id,
              operation_id,
              company_id,
              reported_by,
              reported_at,
              completed_area_ha,
              remaining_area_ha,
              progress_percent,
              status_after_report,
              stop_reason,
              comment,
              weather_note
            ),
            operation_completion_requests:operation_completion_requests(
              id,
              operation_id,
              company_id,
              requested_by,
              planned_area_ha,
              actual_area_ha,
              deviation_area_ha,
              variance_reason,
              specialist_comment,
              material_facts,
              status,
              reviewed_by,
              review_comment,
              requested_at,
              reviewed_at
            )
          `
          )
          .eq('company_id', profile.company_id)
          .or(`responsible_user_id.eq.${profile.id},assigned_to.eq.${profile.id}`)
          .eq('archived', false)
          .order('date', { ascending: true }),
        getRecipientWarehouseIssueRequests({
          companyId: profile.company_id,
          recipientUserId: profile.id,
        }),
        getOperationAssetCatalog(profile.company_id),
      ]);

      if (operationsResult.error) throw operationsResult.error;

      const cleanOperations = attachOperationAssetRelations(
        (operationsResult.data || []) as any[],
        assetCatalog
      )
        .map(normalizeOperationRow)
        .filter((operation) => !operationHasQaMarker(operation));
      let identityByOperationId = new Map<string, TaskCropIdentity>();
      try {
        identityByOperationId = new Map(
          (await getTaskCropIdentities()).map((identity) => [identity.operation_id, identity])
        );
      } catch {
        // Client-side relations remain a read-only fallback when the identity API is temporarily unavailable.
      }
      const operationsWithCanonicalIdentity = cleanOperations.map((operation) => ({
        ...operation,
        task_crop_identity: identityByOperationId.get(operation.id) || null,
      }));
      const cleanRequests = (requestsResult || []).filter((request) => !requestHasQaMarker(request));
      setOperations(operationsWithCanonicalIdentity);
      setMaterialRequests(cleanRequests);

    } catch (error: any) {
      toast({
        title: 'Ошибка',
        description: error?.message || 'Не удалось загрузить задачи',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (profile?.id && profile.company_id) void loadTasks();
  }, [profile?.id, profile?.company_id, language]);

  const requestsByOperation = useMemo(() => {
    const map = new Map<string, WarehouseIssueRequest[]>();
    materialRequests.forEach((request) => {
      const operationId = String(request.operation_id || '');
      if (!operationId) return;
      const list = map.get(operationId) || [];
      list.push(request);
      map.set(operationId, list);
    });
    return map;
  }, [materialRequests]);

  const activeOperations = operations.filter((operation) => getTaskPhase(operation) === 'active');
  const currentOperations = operations.filter((operation) => {
    const phase = getTaskPhase(operation);
    return (
      phase === 'accepted' ||
      phase === 'in_progress' ||
      phase === 'awaiting_reconciliation' ||
      phase === 'awaiting_approval'
    );
  });
  const completedOperations = operations.filter((operation) => getTaskPhase(operation) === 'completed');

  const selectedOperation = useMemo(
    () => operations.find((operation) => operation.id === selectedOperationId) || null,
    [operations, selectedOperationId]
  );
  const selectedPresentation = useMemo(
    () => (selectedOperation ? operationPresentation(selectedOperation) : null),
    [selectedOperation]
  );
  const selectedWarehouseMaterials = useMemo(() => {
    if (!selectedOperation) return [];
    return (requestsByOperation.get(selectedOperation.id) || []).flatMap((request) =>
      (request.items || []).map((item) => ({
        productId: item.product_id,
        preparedQuantity: toNumber(item.prepared_quantity, 0),
        issuedQuantity: toNumber(item.issued_quantity, 0),
        statusLabel: materialStatusText([request]),
      }))
    );
  }, [requestsByOperation, selectedOperation]);

  const filteredCompletedOperations = useMemo(() => {
    const search = historySearch.trim().toLowerCase();
    return completedOperations.filter((operation) => {
      const text = `${operationWorkTitle(operation)} ${operation.fields?.name || ''} ${operation.notes || ''}`.toLowerCase();
      const dateValue = operation.completed_at || operation.date;
      const date = dateValue ? dateValue.slice(0, 10) : '';
      const matchesSearch = !search || text.includes(search);
      const matchesFrom = !historyFrom || date >= historyFrom;
      const matchesTo = !historyTo || date <= historyTo;
      return matchesSearch && matchesFrom && matchesTo;
    });
  }, [completedOperations, historyFrom, historySearch, historyTo]);

  const openOperationDetails = (operation: Operation) => {
    setCompletionComment('Выполнено специалистом');
    setProgressAreaDraft('');
    setProgressStopReason('');
    setProgressWeatherNote('');
    setProgressComment('');
    setFinishVarianceReason('');
    setConfirmationKind(null);
    setSelectedOperationId(operation.id);
  };

  const runOperationAction = async (operationId: string) => {
    if (!profile?.company_id) return;
    try {
      setBusyKey(`accept:${operationId}`);
      const idempotencyKey = crypto.randomUUID();
      const headers = { ...(await buildAuthHeaders()), 'Idempotency-Key': idempotencyKey };
      const response = await fetch(`/api/operations/${encodeURIComponent(operationId)}/accept`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ companyId: profile.company_id, idempotency_key: idempotencyKey }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Действие не выполнено');
      toast({ title: 'Задача принята' });
      setAcceptOperationId(null);
      await loadTasks();
    } catch (error: any) {
      toast({
        title: 'Ошибка',
        description: error?.message || 'Действие не выполнено',
        variant: 'destructive',
      });
    } finally {
      setBusyKey(null);
    }
  };

  const requestProgressConfirmation = (operation: Operation) => {
    const completedAreaHa = Number(progressAreaDraft);
    if (!Number.isFinite(completedAreaHa) || completedAreaHa <= 0) {
      toast({ title: 'Ошибка', description: 'Укажите выполненную площадь за смену.', variant: 'destructive' });
      return;
    }
    const stats = operationAreaStats(operation);
    if (stats.completed + completedAreaHa < stats.planned - 0.000001 && !progressStopReason.trim()) {
      toast({
        title: 'Нужна причина остановки',
        description: 'Выберите причину, почему работа будет продолжена позже.',
        variant: 'destructive',
      });
      return;
    }
    if (progressStopReason === 'Другое' && !progressComment.trim()) {
      toast({ title: 'Нужен комментарий', description: 'Опишите другую причину остановки.', variant: 'destructive' });
      return;
    }
    setConfirmationKind('progress');
  };

  const handleReportProgress = async (operation: Operation) => {
    if (!profile?.company_id) return;
    const completedAreaHa = Number(progressAreaDraft);
    try {
      setBusyKey(`progress:${operation.id}`);
      const idempotencyKey = crypto.randomUUID();
      const headers = { ...(await buildAuthHeaders()), 'Idempotency-Key': idempotencyKey };
      const response = await fetch(`/api/operations/${encodeURIComponent(operation.id)}/progress`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          companyId: profile.company_id,
          completedAreaHa,
          stopReason: progressStopReason.trim() || null,
          weatherNote: progressWeatherNote.trim() || null,
          comment: progressComment.trim() || null,
          idempotency_key: idempotencyKey,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Прогресс не сохранён');
      const progress = payload?.progress;
      toast({
        title: 'Прогресс сохранён',
        description: progress
          ? `Выполнено ${progress.completed_area_ha} из ${progress.planned_area_ha} га. Осталось ${progress.remaining_area_ha} га.`
          : undefined,
      });
      setProgressAreaDraft('');
      setProgressStopReason('');
      setProgressWeatherNote('');
      setProgressComment('');
      setConfirmationKind(null);
      await loadTasks();
    } catch (error: any) {
      toast({
        title: 'Ошибка',
        description: error?.message || 'Прогресс не сохранён',
        variant: 'destructive',
      });
    } finally {
      setBusyKey(null);
    }
  };

  const requestFinishConfirmation = (operation: Operation) => {
    const areaStats = operationAreaStats(operation);
    const currentShiftArea = progressAreaDraft.trim() ? Number(progressAreaDraft) : 0;
    if (!Number.isFinite(currentShiftArea) || currentShiftArea < 0) {
      toast({
        title: 'Ошибка',
        description: 'Площадь текущей смены должна быть неотрицательным числом.',
        variant: 'destructive',
      });
      return;
    }
    const finalArea = areaStats.completed + currentShiftArea;
    if (finalArea <= 0) {
      toast({ title: 'Ошибка', description: 'Итоговая фактическая площадь должна быть больше нуля.', variant: 'destructive' });
      return;
    }
    if (Math.abs(finalArea - areaStats.planned) > 0.000001 && !finishVarianceReason.trim()) {
      toast({
        title: 'Нужна причина отклонения',
        description: 'Укажите, почему итоговая площадь отличается от плана.',
        variant: 'destructive',
      });
      return;
    }
    setConfirmationKind('finish');
  };

  const handleCompleteOperation = async (operation: Operation) => {
    if (!profile?.company_id) return;
    const areaStats = operationAreaStats(operation);
    const currentShiftArea = progressAreaDraft.trim() ? Number(progressAreaDraft) : 0;

    try {
      setBusyKey(`complete:${operation.id}`);
      const idempotencyKey = crypto.randomUUID();
      const headers = { ...(await buildAuthHeaders()), 'Idempotency-Key': idempotencyKey };
      const response = await fetch(`/api/operations/${encodeURIComponent(operation.id)}/complete`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          companyId: profile.company_id,
          comment: completionComment.trim() || 'Выполнено специалистом',
          currentShiftAreaHa: currentShiftArea,
          varianceReason: finishVarianceReason.trim() || null,
          lineFacts: [],
          materialFacts: [],
          idempotency_key: idempotencyKey,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Операция не закрыта');
      const awaitingApproval =
        payload?.awaiting_agronomist_approval === true ||
        payload?.status === 'awaiting_approval' ||
        (Boolean(payload?.completion_request) && payload?.waiting_material_reconciliation !== true);
      const waitingReconciliation = payload?.waiting_material_reconciliation === true;
      toast({
        title: waitingReconciliation
          ? 'Факт сохранён, ожидается сверка склада'
          : awaitingApproval
            ? 'Факт отправлен агроному'
            : 'Операция закрыта',
      });
      setConfirmationKind(null);
      setSelectedOperationId(null);
      await loadTasks();
    } catch (error: any) {
      toast({
        title: 'Ошибка',
        description: error?.message || 'Операция не закрыта',
        variant: 'destructive',
      });
    } finally {
      setBusyKey(null);
    }
  };

  const handleConfirmReceipt = async (requestId: string) => {
    if (!profile?.company_id) return;
    try {
      setBusyKey(`receipt:${requestId}`);
      await confirmWarehouseReceipt({ requestId, companyId: profile.company_id });
      toast({
        title: 'Товар принят',
        description: 'Теперь склад может подтвердить фактическую выдачу.',
      });
      await loadTasks();
    } catch (error: any) {
      toast({
        title: 'Ошибка',
        description: error?.message || 'Не удалось принять товар',
        variant: 'destructive',
      });
    } finally {
      setBusyKey(null);
    }
  };

  const renderMaterialPreview = (operation: Operation, requests: WarehouseIssueRequest[]) => {
    const requestItems = requests.flatMap((request) => request.items || []);
    const operationMaterials = operationVisibleMaterials(operation);
    const previewRows =
      requestItems.length > 0
        ? requestItems.map((item) => ({
            id: item.id,
            name: item.product_name || 'Материал',
            qty: formatQty(item.planned_quantity ?? item.required_quantity, localizeUnit(item.unit || item.product_unit || '', language)),
          }))
        : operationMaterials.map((material) => ({
            id: material.id,
            name: operationMaterialName(material),
            qty: formatQty(material.planned_quantity, localizeUnit(material.unit || material.products?.unit || '', language)),
          }));

    if (previewRows.length === 0) {
      return <div className="text-xs text-slate-400">{materialStatusText(requests)}</div>;
    }

    const visible = previewRows.slice(0, 3);
    const hiddenCount = previewRows.length - visible.length;
    return (
      <div className="space-y-1">
        {visible.map((item) => (
          <div key={item.id} className="flex justify-between gap-2 text-xs text-slate-300">
            <span className="truncate">{item.name}</span>
            <span className="shrink-0 text-slate-400">{item.qty}</span>
          </div>
        ))}
        {hiddenCount > 0 ? <div className="text-xs text-slate-500">+ ещё {hiddenCount}</div> : null}
      </div>
    );
  };

  const renderOperationCard = (operation: Operation, isCompleted = false) => {
    const phase = getTaskPhase(operation);
    const requests = requestsByOperation.get(operation.id) || [];
    const readyRequest = requests.find((request) => request.status === 'ready');
    const hasMaterialRequests = requests.filter((request) => request.status !== 'cancelled').length > 0;
    const warehouseIsPreparing = requests.some((request) => ['new', 'active', 'preparing'].includes(request.status));
    const waitingWarehouseIssue = requests.some((request) => request.status === 'received_confirmed' && !request.issued_at);
    const cropIdentity = getOperationCropIdentity(operation);
    const visibleOperationMaterials = operationVisibleMaterials(operation);
    const hasAgrochemicalWithoutRequest =
      requests.length === 0 &&
      visibleOperationMaterials.some((material) =>
        ['pesticide', 'fertilizer', 'adjuvant', 'ph_corrector', 'defoamer', 'biological', 'organic', 'other'].includes(
          String(material.material_type || '')
        )
      );
    const readyForProgress = operationReadyForProgress(operation, requests);
    const areaStats = operationAreaStats(operation);
    const presentation = operationPresentation(operation);
    const stepText =
      phase === 'active'
        ? 'Нужно принять операцию'
        : phase === 'accepted' && readyRequest
          ? 'Склад подготовил товар'
          : phase === 'accepted' && hasMaterialRequests && warehouseIsPreparing
            ? 'Склад готовит материалы'
            : phase === 'accepted' && waitingWarehouseIssue
              ? 'Ждём фактическую выдачу склада'
              : phase === 'accepted' && readyForProgress
                ? 'Можно сдавать прогресс по смене'
                : phase === 'in_progress'
                  ? 'Работа выполняется'
                  : phase === 'awaiting_reconciliation'
                    ? 'Факт сдан, склад завершает сверку материалов'
                  : phase === 'awaiting_approval'
                    ? 'Факт передан агроному'
                  : isCompleted
                    ? 'Операция закрыта'
                    : materialStatusText(requests);

    return (
      <Card
        key={operation.id}
        role="button"
        tabIndex={0}
        onClick={() => openOperationDetails(operation)}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openOperationDetails(operation);
          }
        }}
        className="cursor-pointer rounded-2xl border-slate-800 bg-slate-900/70 transition hover:border-yellow-500/60 hover:bg-slate-900"
      >
        <CardContent className="space-y-2.5 p-3 sm:p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="truncate text-base font-bold leading-tight text-white">{presentation.workTitle}</div>
              <div className="truncate text-[13px] text-slate-300">{operation.fields?.name || 'Поле не указано'}</div>
              <div className="truncate text-xs text-slate-400">
                {[cropIdentity.cropName, cropIdentity.varietyName, cropIdentity.reproductionName].filter(Boolean).join(' • ') || 'Культура не указана'}
              </div>
            </div>
            {taskStatusBadge(phase, !hasMaterialRequests && !hasAgrochemicalWithoutRequest)}
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/45 px-2.5 py-2 text-xs text-slate-300">
            {stepText}
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <CalendarDays className="h-3.5 w-3.5" />
            {formatDate(operation.date)}
          </div>

          {areaStats.planned > 0 ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[13px] text-slate-300">
                <span>{areaStats.completed.toFixed(2)} / {areaStats.planned.toFixed(2)} га</span>
                <span>{areaStats.percent.toFixed(1)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: `${Math.max(0, Math.min(areaStats.percent, 100))}%` }}
                />
              </div>
              <div className="text-[13px] text-slate-500">
                {areaStats.deviation > 0
                  ? `Перевыполнение +${areaStats.deviation.toFixed(2)} га`
                  : `Осталось ${areaStats.remaining.toFixed(2)} га`}
              </div>
            </div>
          ) : null}

          {!isCompleted ? (
            <div className="flex flex-wrap gap-2">
              {phase === 'active' ? (
                <Button
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={(event: MouseEvent<HTMLButtonElement>) => {
                    event.stopPropagation();
                    setAcceptOperationId(operation.id);
                  }}
                  disabled={busyKey === `accept:${operation.id}`}
                >
                  <Clock className="mr-2 h-4 w-4" />
                  Принять
                </Button>
              ) : null}

              {phase === 'accepted' && readyRequest ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={(event: MouseEvent<HTMLButtonElement>) => {
                    event.stopPropagation();
                    void handleConfirmReceipt(readyRequest.id);
                  }}
                  disabled={busyKey === `receipt:${readyRequest.id}`}
                >
                  <PackageCheck className="mr-2 h-4 w-4" />
                  Товар принят
                </Button>
              ) : null}

              {phase === 'accepted' && hasMaterialRequests && !readyRequest && warehouseIsPreparing ? (
                <Button size="sm" variant="outline" className="w-full sm:w-auto" disabled onClick={(event) => event.stopPropagation()}>
                  Ждём склад
                </Button>
              ) : null}

              {phase === 'accepted' && hasAgrochemicalWithoutRequest ? (
                <Button size="sm" variant="outline" className="w-full sm:w-auto" disabled onClick={(event) => event.stopPropagation()}>
                  Нет заявки склада
                </Button>
              ) : null}

              {phase === 'accepted' && waitingWarehouseIssue ? (
                <Button size="sm" variant="outline" className="w-full sm:w-auto" disabled onClick={(event) => event.stopPropagation()}>
                  Ждём выдачу склада
                </Button>
              ) : null}

              {(phase === 'in_progress' || (phase === 'accepted' && readyForProgress)) ? (
                <Button
                  size="sm"
                  className="w-full bg-green-600 hover:bg-green-700 sm:w-auto"
                  onClick={(event: MouseEvent<HTMLButtonElement>) => {
                    event.stopPropagation();
                    openOperationDetails(operation);
                  }}
                  disabled={busyKey === `complete:${operation.id}`}
                >
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Сдать прогресс
                </Button>
              ) : null}
            </div>
          ) : operation.completed_at ? (
            <div className="text-xs text-emerald-300">
              Выполнена: {new Date(operation.completed_at).toLocaleString('ru-RU')}
            </div>
          ) : null}
        </CardContent>
      </Card>
    );
  };

  const renderColumn = (title: string, count: number, children: React.ReactNode) => (
    <section className="min-h-[320px] rounded-2xl border border-slate-800/80 bg-slate-950/30 p-2.5 sm:p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-white">{title}</h2>
        <Badge className="bg-slate-800 text-slate-200">{count}</Badge>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );

  if (!isTaskRole) {
    return (
      <div>
        <PageHeader title="Мои задачи" description="Операции и материалы специалиста" />
        <Alert variant="destructive">
          <AlertDescription>Эта страница доступна специалистам и бригадирам.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Мои задачи" description="Работы, получение материалов и история выполнения" />

      <div className="grid gap-4 xl:grid-cols-3">
        {renderColumn(
          'Активные',
          activeOperations.length,
          loading ? (
            <Card className="border-slate-700 bg-slate-900/70"><CardContent className="p-5 text-center text-slate-400">Загрузка задач...</CardContent></Card>
          ) : activeOperations.length === 0 ? (
            <Card className="border-slate-700 bg-slate-900/70"><CardContent className="p-5 text-center text-slate-400">Активных задач нет.</CardContent></Card>
          ) : (
            activeOperations.map((task) => renderOperationCard(task))
          )
        )}

        {renderColumn(
          'В работе',
          currentOperations.length,
          loading ? (
            <Card className="border-slate-700 bg-slate-900/70"><CardContent className="p-5 text-center text-slate-400">Загрузка работ...</CardContent></Card>
          ) : currentOperations.length === 0 ? (
            <Card className="border-slate-700 bg-slate-900/70"><CardContent className="p-5 text-center text-slate-400">Принятых операций и работ сейчас нет.</CardContent></Card>
          ) : (
            currentOperations.map((task) => renderOperationCard(task))
          )
        )}

        {renderColumn(
          'Законченные',
          filteredCompletedOperations.length,
          <>
            <div className="space-y-2 rounded-md border border-slate-800 bg-slate-950/50 p-3">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Search className="h-3.5 w-3.5" />
                Фильтр истории
              </div>
              <Input
                value={historySearch}
                onChange={(event) => setHistorySearch(event.target.value)}
                placeholder="Поиск по полю или операции"
                className="h-8"
              />
              <div className="grid grid-cols-2 gap-2">
                <Input type="date" value={historyFrom} onChange={(event) => setHistoryFrom(event.target.value)} className="h-8" />
                <Input type="date" value={historyTo} onChange={(event) => setHistoryTo(event.target.value)} className="h-8" />
              </div>
            </div>
            {loading ? (
              <Card className="border-slate-700 bg-slate-900/70"><CardContent className="p-5 text-center text-slate-400">Загрузка истории...</CardContent></Card>
            ) : filteredCompletedOperations.length === 0 ? (
              <Card className="border-slate-700 bg-slate-900/70"><CardContent className="p-5 text-center text-slate-400">Истории пока нет.</CardContent></Card>
            ) : (
              filteredCompletedOperations.map((task) => renderOperationCard(task, true))
            )}
          </>
        )}
      </div>

      <Dialog open={Boolean(selectedOperation)} onOpenChange={(open) => !open && setSelectedOperationId(null)}>
        <DialogContent className="grid h-[100dvh] w-screen max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden border-slate-700 bg-slate-950 p-0 text-slate-100 sm:h-auto sm:max-h-[88vh] sm:w-[calc(100vw-1rem)] sm:max-w-3xl">
          {selectedOperation ? (
            <>
              <DialogHeader className="border-b border-slate-800 bg-slate-950 px-5 py-4">
                <div className="flex items-start justify-between gap-3 pr-8">
                  <div>
                    <DialogTitle className="text-xl text-white">{selectedPresentation?.workTitle}</DialogTitle>
                    <div className="mt-1 text-xs text-slate-500">{selectedPresentation?.categoryTitle}</div>
                  </div>
                  {taskStatusBadge(getTaskPhase(selectedOperation))}
                </div>
                <DialogDescription className="text-slate-400">
                  {selectedOperation.fields?.name || 'Поле не указано'} • {formatDate(selectedOperation.date)}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
                {selectedPresentation ? (
                  <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
                    <OperationPlanDetails
                      presentation={selectedPresentation}
                      warehouseMaterials={selectedWarehouseMaterials}
                      showExecutionFacts
                    />
                  </div>
                ) : null}

                {(['accepted', 'in_progress'] as TaskPhase[]).includes(getTaskPhase(selectedOperation)) &&
                operationReadyForProgress(
                  selectedOperation,
                  requestsByOperation.get(selectedOperation.id) || []
                ) ? (
                  (() => {
                    const areaStats = operationAreaStats(selectedOperation);
                    return (
                      <div className="space-y-3 rounded-lg border border-emerald-700/40 bg-emerald-950/10 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h3 className="font-semibold text-white">Сдача смены</h3>
                            <div className="text-sm text-slate-400">
                              Текущая смена добавляется к уже принятому факту, план не изменяется.
                            </div>
                          </div>
                          <Badge className="bg-emerald-500/15 text-emerald-200 border border-emerald-400/30">
                            {areaStats.percent.toFixed(0)}%
                          </Badge>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="h-full rounded-full bg-emerald-500"
                            style={{ width: `${Math.max(0, Math.min(areaStats.percent, 100))}%` }}
                          />
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div><div className="text-slate-500">План</div><div className="font-semibold">{areaStats.planned.toFixed(2)} га</div></div>
                          <div><div className="text-slate-500">Выполнено ранее</div><div className="font-semibold">{areaStats.completed.toFixed(2)} га</div></div>
                          <div>
                            <div className="text-slate-500">{areaStats.deviation > 0 ? 'Перевыполнение' : 'Осталось по плану'}</div>
                            <div className="font-semibold">
                              {areaStats.deviation > 0 ? `+${areaStats.deviation.toFixed(2)}` : areaStats.remaining.toFixed(2)} га
                            </div>
                          </div>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div>
                            <Label className="text-xs text-slate-400">Выполнено за смену, га</Label>
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              value={progressAreaDraft}
                              onChange={(event) => setProgressAreaDraft(event.target.value)}
                            />
                            {Number(progressAreaDraft) > 0 ? (
                              <div className="mt-1 text-xs text-slate-500">
                                Итого после сдачи: {(areaStats.completed + Number(progressAreaDraft)).toFixed(2)} га.{' '}
                                {areaStats.completed + Number(progressAreaDraft) > areaStats.planned
                                  ? `Перевыполнение +${(areaStats.completed + Number(progressAreaDraft) - areaStats.planned).toFixed(2)} га`
                                  : `Останется ${Math.max(areaStats.planned - areaStats.completed - Number(progressAreaDraft), 0).toFixed(2)} га`}
                              </div>
                            ) : null}
                          </div>
                          <div>
                            <Label className="text-xs text-slate-400">Причина остановки, если работа не закончена</Label>
                            <Select
                              value={progressStopReason}
                              onValueChange={setProgressStopReason}
                            >
                              <SelectTrigger><SelectValue placeholder="Выберите причину" /></SelectTrigger>
                              <SelectContent>
                                {STOP_REASONS.map((reason) => <SelectItem key={reason} value={reason}>{reason}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs text-slate-400">Погода</Label>
                            <Input
                              value={progressWeatherNote}
                              onChange={(event) => setProgressWeatherNote(event.target.value)}
                              placeholder="ветер, дождь, температура"
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-slate-400">Комментарий</Label>
                            <Input
                              value={progressComment}
                              onChange={(event) => setProgressComment(event.target.value)}
                              placeholder="что важно передать агроному"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })()
                ) : null}

                {(requestsByOperation.get(selectedOperation.id) || []).length > 0 ? <div className="space-y-2">
                  <h3 className="font-semibold text-white">Заявки склада</h3>
                  {(requestsByOperation.get(selectedOperation.id) || []).map((request) => (
                      <div key={request.id} className="rounded-md border border-slate-800 bg-slate-900/70 p-3">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <div className="font-medium text-white">{request.request_number}</div>
                          {requestStatusBadge(request.status)}
                        </div>
                        <div className="space-y-1">
                          {(request.items || []).map((item) => (
                            <div key={item.id} className="flex justify-between gap-3 text-sm text-slate-300">
                              <span>{item.product_name || 'Материал'}</span>
                              <span className="shrink-0">
                                {formatQty(item.planned_quantity ?? item.required_quantity, localizeUnit(item.unit || item.product_unit || '', language))}
                              </span>
                            </div>
                          ))}
                        </div>
                        {request.status === 'ready' ? (
                          <Button
                            size="sm"
                            className="mt-3 bg-green-600 hover:bg-green-700"
                            onClick={() => handleConfirmReceipt(request.id)}
                            disabled={busyKey === `receipt:${request.id}`}
                          >
                            <PackageCheck className="mr-2 h-4 w-4" />
                            Товар принят
                          </Button>
                        ) : null}
                      </div>
                  ))}
                </div> : null}

                {(selectedOperation.operation_progress || []).length > 0 ? (
                  <div className="space-y-2">
                    <h3 className="font-semibold text-white">История смен</h3>
                    {(selectedOperation.operation_progress || [])
                      .slice()
                      .sort((a, b) => new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime())
                      .map((report) => (
                        <div key={report.id} className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-800 py-2 text-sm">
                          <div>
                            <div className="font-medium text-slate-100">+{Number(report.completed_area_ha).toFixed(2)} га</div>
                            {report.stop_reason ? <div className="text-xs text-slate-400">{report.stop_reason}</div> : null}
                            {report.comment ? <div className="text-xs text-slate-500">{report.comment}</div> : null}
                          </div>
                          <div className="text-xs text-slate-500">{new Date(report.reported_at).toLocaleString('ru-RU')}</div>
                        </div>
                      ))}
                  </div>
                ) : null}

                {getTaskPhase(selectedOperation) === 'in_progress' ? (
                  (() => {
                    const areaStats = operationAreaStats(selectedOperation);
                    const operationRequests = requestsByOperation.get(selectedOperation.id) || [];
                    const hasWarehouseMaterials = operationRequests.length > 0;
                    const reconciliationReady = !hasWarehouseMaterials || materialRequestsReconciled(operationRequests);
                    const currentShift = progressAreaDraft.trim() ? Number(progressAreaDraft) : 0;
                    const finalArea = areaStats.completed + (Number.isFinite(currentShift) ? currentShift : 0);
                    const hasVariance = Math.abs(finalArea - areaStats.planned) > 0.000001;
                    return (
                      <div className="space-y-3 border-t border-slate-800 pt-4">
                        <h3 className="font-semibold text-white">Закрытие работы</h3>
                        {hasWarehouseMaterials && !reconciliationReady ? (
                          <div className="rounded-md border border-amber-500/40 bg-amber-950/30 p-3 text-sm text-amber-100">
                            Склад ещё не завершил возврат и сверку материалов. Итог можно сдать сейчас:
                            операция сохранит факт и перейдёт в ожидание склада.
                          </div>
                        ) : null}
                        <div>
                          <Label className="text-xs text-slate-400">Комментарий к закрытию</Label>
                          <Input value={completionComment} onChange={(event) => setCompletionComment(event.target.value)} />
                        </div>
                        {hasVariance ? (
                          <div>
                            <Label className="text-xs text-slate-400">Причина отклонения от плана</Label>
                            <Input
                              value={finishVarianceReason}
                              onChange={(event) => setFinishVarianceReason(event.target.value)}
                              placeholder={finalArea < areaStats.planned ? 'например: часть участка недоступна' : 'например: уточнена площадь'}
                            />
                          </div>
                        ) : null}
                        <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-slate-800 bg-slate-950 px-4 py-3 sm:-mx-5 sm:px-5">
                          <Button
                            type="button"
                            variant="outline"
                            className="flex-1"
                            onClick={() => requestProgressConfirmation(selectedOperation)}
                            disabled={busyKey === `progress:${selectedOperation.id}`}
                          >
                            Сдать прогресс
                          </Button>
                          <Button
                            className="flex-1 bg-yellow-500 text-slate-950 hover:bg-yellow-400"
                            onClick={() => requestFinishConfirmation(selectedOperation)}
                            disabled={busyKey === `complete:${selectedOperation.id}`}
                          >
                            <CheckCircle className="mr-2 h-4 w-4" />
                            Завершить работу
                          </Button>
                        </div>
                      </div>
                    );
                  })()
                ) : null}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(acceptOperationId)}
        onOpenChange={(open) => !open && setAcceptOperationId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Принять задачу?</AlertDialogTitle>
            <AlertDialogDescription>
              После подтверждения задача перейдёт в раздел «В работе». Отдельно запускать её не нужно:
              первый сохранённый прогресс за смену отметит фактическое начало работы.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (acceptOperationId) void runOperationAction(acceptOperationId);
              }}
              disabled={!acceptOperationId || busyKey === `accept:${acceptOperationId}`}
            >
              {busyKey === `accept:${acceptOperationId}` ? 'Принимаем...' : 'Принять'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(confirmationKind && selectedOperation)} onOpenChange={(open) => !open && setConfirmationKind(null)}>
        <AlertDialogContent>
          {selectedOperation && confirmationKind ? (() => {
            const stats = operationAreaStats(selectedOperation);
            const shiftArea = progressAreaDraft.trim() ? Number(progressAreaDraft) : 0;
            const finalArea = stats.completed + (Number.isFinite(shiftArea) ? shiftArea : 0);
            const remaining = Math.max(stats.planned - finalArea, 0);
            const deviation = finalArea - stats.planned;
            const isProgress = confirmationKind === 'progress';
            return (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>{isProgress ? 'Подтвердить сдачу прогресса?' : 'Подтвердить завершение работы?'}</AlertDialogTitle>
                  <AlertDialogDescription>
                    До подтверждения данные не записываются.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="grid grid-cols-2 gap-3 rounded-md bg-muted/40 p-3 text-sm">
                  <div><span className="text-muted-foreground">План:</span> {stats.planned.toFixed(2)} га</div>
                  <div><span className="text-muted-foreground">Выполнено ранее:</span> {stats.completed.toFixed(2)} га</div>
                  <div><span className="text-muted-foreground">Текущая смена:</span> {shiftArea.toFixed(2)} га</div>
                  <div><span className="text-muted-foreground">Итого:</span> {finalArea.toFixed(2)} га</div>
                  <div>
                    <span className="text-muted-foreground">{deviation > 0 ? 'Перевыполнение:' : 'Останется:'}</span>{' '}
                    {deviation > 0 ? `+${deviation.toFixed(2)}` : remaining.toFixed(2)} га
                  </div>
                  <div><span className="text-muted-foreground">Процент:</span> {stats.planned > 0 ? ((finalArea / stats.planned) * 100).toFixed(1) : '0'}%</div>
                </div>
                {isProgress && progressStopReason ? (
                  <div className="text-sm"><span className="text-muted-foreground">Причина остановки:</span> {progressStopReason}</div>
                ) : null}
                {isProgress && progressComment ? (
                  <div className="text-sm"><span className="text-muted-foreground">Комментарий:</span> {progressComment}</div>
                ) : null}
                {!isProgress && finishVarianceReason ? (
                  <div className="text-sm"><span className="text-muted-foreground">Причина отклонения:</span> {finishVarianceReason}</div>
                ) : null}
                <AlertDialogFooter>
                  <AlertDialogCancel>Отмена</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(event) => {
                      event.preventDefault();
                      if (isProgress) void handleReportProgress(selectedOperation);
                      else void handleCompleteOperation(selectedOperation);
                    }}
                    disabled={Boolean(busyKey)}
                  >
                    {busyKey
                      ? 'Сохраняем...'
                      : isProgress
                        ? 'Подтвердить сдачу'
                        : 'Подтвердить завершение'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </>
            );
          })() : null}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
