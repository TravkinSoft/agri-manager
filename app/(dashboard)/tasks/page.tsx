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
import type {
  OperationCompletionRequest,
  OperationProgressReport,
  OperationWithDetails,
} from '@/lib/types/operation';
import {
  confirmWarehouseReceipt,
  getRecipientWarehouseIssueRequests,
  returnWarehouseRequestMaterials,
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
  Play,
  RotateCcw,
  Search,
} from 'lucide-react';

interface OperationLine {
  id: string;
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

type TaskPhase = 'active' | 'accepted' | 'in_progress' | 'awaiting_approval' | 'completed';
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
    task.operation_status === 'ready_to_close' ||
    task.specialist_task_status === 'in_progress' ||
    task.specialist_task_status === 'paused' ||
    task.specialist_task_status === 'ready_to_close'
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

const MATERIAL_QTY_EPS = 0.000001;

function findOperationMaterialForRequestItem(operation: Operation | null | undefined, item: WarehouseIssueRequest['items'][number]) {
  const productId = String(item.product_id || '');
  if (!productId) return null;
  return (operation?.operation_materials || []).find((material) => String(material.product_id || '') === productId) || null;
}

function getReturnResolution(request: WarehouseIssueRequest, operation?: Operation | null) {
  const rows = (request.items || []).map((item) => {
    const materialFact = findOperationMaterialForRequestItem(operation, item);
    const issued = toNumber(item.issued_quantity, 0);
    const returned = item.returned_quantity ?? materialFact?.returned_quantity ?? null;
    const consumed = item.consumed_quantity ?? materialFact?.consumed_quantity ?? null;
    const consumptionKnown = consumed !== null && consumed !== undefined;
    const returnedValue = returned == null ? 0 : toNumber(returned, 0);
    const consumedValue = consumptionKnown ? toNumber(consumed, 0) : 0;
    const dueReturnQty = consumptionKnown ? Math.max(issued - consumedValue - returnedValue, 0) : null;
    const resolved =
      issued <= MATERIAL_QTY_EPS ||
      (consumptionKnown && (dueReturnQty || 0) <= MATERIAL_QTY_EPS);
    const maxReturnQty = dueReturnQty ?? Math.max(issued - returnedValue, 0);
    return { item, issued, returned, consumed, consumptionKnown, returnedValue, consumedValue, dueReturnQty, resolved, maxReturnQty };
  });

  return {
    rows,
    pendingRows: rows.filter((row) => row.issued > MATERIAL_QTY_EPS && !row.resolved),
  };
}

function requestNeedsReturnDecision(request: WarehouseIssueRequest, operation?: Operation | null): boolean {
  if (!['issued', 'issued_by_warehouse', 'partially_issued'].includes(request.status)) return false;
  return getReturnResolution(request, operation).pendingRows.length > 0;
}

function operationMaterialName(material: OperationMaterial): string {
  return material.products?.trade_name || material.products?.name || material.material_type || 'Материал';
}

function operationVisibleMaterials(operation: Operation): OperationMaterial[] {
  return (operation.operation_materials || []).filter((material) => !hasQaDataMarker(operationMaterialName(material)));
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

function operationLineDefaultArea(operation: Operation): string {
  const firstLine = operation.operation_lines?.[0];
  const area = firstLine?.actual_area_ha ?? firstLine?.planned_area_ha ?? null;
  return area == null ? '' : String(area);
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
  const [lineFactDraft, setLineFactDraft] = useState<Record<string, string>>({});
  const [materialFactDraft, setMaterialFactDraft] = useState<Record<string, { consumed: string; returned: string; loss: string; actualRate: string }>>({});
  const [completionComment, setCompletionComment] = useState('Выполнено специалистом');
  const [progressAreaDraft, setProgressAreaDraft] = useState('');
  const [progressStopReason, setProgressStopReason] = useState('');
  const [progressWeatherNote, setProgressWeatherNote] = useState('');
  const [progressComment, setProgressComment] = useState('');
  const [finishVarianceReason, setFinishVarianceReason] = useState('');
  const [confirmationKind, setConfirmationKind] = useState<ConfirmationKind | null>(null);
  const [returnDraftByItemId, setReturnDraftByItemId] = useState<Record<string, string>>({});
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
            operation_config,
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
              crop_id,
              variety_id,
              reproduction_id,
              planned_area_ha,
              actual_area_ha,
              crops:crop_id(name,name_ru),
              varieties:variety_id(name),
              reproductions:reproduction_id(name,name_ru)
            ),
            operation_materials(
              id,
              material_type,
              product_id,
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

      const returnDraft: Record<string, string> = {};
      cleanRequests
        .filter((request) => ['received_confirmed', 'issued', 'issued_by_warehouse', 'partially_issued'].includes(request.status))
        .forEach((request) => {
          (request.items || []).forEach((item) => {
            returnDraft[item.id] = returnDraftByItemId[item.id] ?? '0';
          });
        });
      setReturnDraftByItemId(returnDraft);
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

  const operationById = useMemo(() => {
    return new Map(operations.map((operation) => [operation.id, operation]));
  }, [operations]);

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
    return phase === 'accepted' || phase === 'in_progress' || phase === 'awaiting_approval';
  });
  const completedOperations = operations.filter((operation) => getTaskPhase(operation) === 'completed');
  const receiptHistory = materialRequests.filter((request) => requestNeedsReturnDecision(request, operationById.get(request.operation_id)));

  const selectedOperation = useMemo(
    () => operations.find((operation) => operation.id === selectedOperationId) || null,
    [operations, selectedOperationId]
  );
  const selectedOperationCropIdentity = useMemo(
    () => (selectedOperation ? getOperationCropIdentity(selectedOperation) : null),
    [selectedOperation]
  );
  const selectedPresentation = useMemo(
    () => (selectedOperation ? operationPresentation(selectedOperation) : null),
    [selectedOperation]
  );

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
    const lineDraft: Record<string, string> = {};
    (operation.operation_lines || []).forEach((line) => {
      const area = line.actual_area_ha ?? line.planned_area_ha;
      lineDraft[line.id] = area == null ? '' : String(area);
    });
    if (Object.keys(lineDraft).length === 0) {
      lineDraft.__fallback = operationLineDefaultArea(operation);
    }

    const materialDraft: Record<string, { consumed: string; returned: string; loss: string; actualRate: string }> = {};
    (operation.operation_materials || []).forEach((material) => {
      const consumed = material.consumed_quantity ?? null;
      const returned = material.returned_quantity ?? 0;
      const loss = material.loss_quantity ?? 0;
      materialDraft[material.id] = {
        consumed: consumed == null ? '' : String(consumed),
        returned: returned == null ? '0' : String(returned),
        loss: loss == null ? '0' : String(loss),
        actualRate: material.actual_rate == null ? '' : String(material.actual_rate),
      };
    });

    setLineFactDraft(lineDraft);
    setMaterialFactDraft(materialDraft);
    setCompletionComment('Выполнено специалистом');
    setProgressAreaDraft('');
    setProgressStopReason('');
    setProgressWeatherNote('');
    setProgressComment('');
    setFinishVarianceReason('');
    setConfirmationKind(null);
    setSelectedOperationId(operation.id);
  };

  const runOperationAction = async (action: 'accept' | 'start', operationId: string) => {
    if (!profile?.company_id) return;
    const labels = {
      accept: 'Задача принята',
      start: 'Работа начата',
    };
    try {
      setBusyKey(`${action}:${operationId}`);
      const idempotencyKey = crypto.randomUUID();
      const headers = { ...(await buildAuthHeaders()), 'Idempotency-Key': idempotencyKey };
      const response = await fetch(`/api/operations/${encodeURIComponent(operationId)}/${action}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ companyId: profile.company_id, idempotency_key: idempotencyKey }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Действие не выполнено');
      toast({ title: labels[action] });
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
    const lineFacts = Object.entries(lineFactDraft)
      .filter(([lineId]) => lineId !== '__fallback')
      .map(([lineId, value]) => ({ lineId, actualAreaHa: value.trim() ? Number(value) : null }));

    const operationRequests = requestsByOperation.get(operation.id) || [];
    const warehouseProductIds = new Set(
      operationRequests.flatMap((request) => (request.items || []).map((item) => String(item.product_id || '')))
    );
    const materialFacts = operationVisibleMaterials(operation)
      .filter((material) => warehouseProductIds.has(String(material.product_id || '')))
      .map((material) => {
      const draft = materialFactDraft[material.id] || { consumed: '', returned: '0', loss: '0', actualRate: '' };
      const issued = toNumber(material.issued_quantity, 0);
      const returnedQuantity = draft.returned.trim() ? Number(draft.returned) : 0;
      const consumedQuantity = draft.consumed.trim() ? Number(draft.consumed) : NaN;
      const lossQuantity = draft.loss.trim() ? Number(draft.loss) : 0;
      const completedArea = areaStats.completed + currentShiftArea;
      const actualRate = completedArea > 0 ? Number((consumedQuantity / completedArea).toFixed(4)) : null;
      return {
        materialId: material.id,
        actualRate,
        consumedQuantity,
        returnedQuantity,
        lossQuantity,
        issuedQuantity: issued,
      };
      });
    const invalidMaterial = materialFacts.find((fact) => {
      const consumedInvalid = fact.consumedQuantity == null || !Number.isFinite(fact.consumedQuantity) || fact.consumedQuantity < 0;
      const returnedInvalid = fact.returnedQuantity == null || !Number.isFinite(fact.returnedQuantity) || fact.returnedQuantity < 0;
      const lossInvalid = fact.lossQuantity == null || !Number.isFinite(fact.lossQuantity) || fact.lossQuantity < 0;
      const rateInvalid = fact.actualRate != null && (!Number.isFinite(fact.actualRate) || fact.actualRate < 0);
      const sumInvalid = Math.abs(fact.consumedQuantity + fact.returnedQuantity + fact.lossQuantity - fact.issuedQuantity) > MATERIAL_QTY_EPS;
      return consumedInvalid || returnedInvalid || lossInvalid || rateInvalid || sumInvalid;
    });
    if (invalidMaterial) {
      toast({ title: 'Ошибка', description: 'Проверьте фактический расход и возврат материалов.', variant: 'destructive' });
      return;
    }

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
          lineFacts,
          materialFacts,
          idempotency_key: idempotencyKey,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Операция не закрыта');
      const awaitingApproval =
        payload?.awaiting_agronomist_approval === true ||
        payload?.status === 'awaiting_approval' ||
        Boolean(payload?.completion_request);
      toast({ title: awaitingApproval ? 'Факт отправлен агроному' : 'Операция закрыта' });
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

  const handleSubmitMaterialReconciliation = async (operation: Operation) => {
    if (!profile?.company_id) return;
    try {
      const requests = (requestsByOperation.get(operation.id) || []).filter((request) => request.status !== 'cancelled');
      if (requests.length !== 1) {
        throw new Error('Для операции должна быть ровно одна активная складская заявка.');
      }

      const request = requests[0];
      const items = (request.items || []).map((item) => {
        const material = findOperationMaterialForRequestItem(operation, item);
        if (!material) {
          throw new Error(`Материал заявки ${item.product_name || item.product_id} не связан с операцией.`);
        }
        const draft = materialFactDraft[material.id] || { consumed: '', returned: '0', loss: '0', actualRate: '' };
        const consumedQuantity = draft.consumed.trim() ? Number(draft.consumed) : NaN;
        const returnedQuantity = draft.returned.trim() ? Number(draft.returned) : 0;
        const lossQuantity = draft.loss.trim() ? Number(draft.loss) : 0;
        const issuedQuantity = toNumber(item.issued_quantity ?? material.issued_quantity, 0);
        const values = [consumedQuantity, returnedQuantity, lossQuantity];
        if (values.some((value) => !Number.isFinite(value) || value < 0)) {
          throw new Error(`Проверьте расход, возврат и потери: ${item.product_name || 'материал'}.`);
        }
        if (Math.abs(consumedQuantity + returnedQuantity + lossQuantity - issuedQuantity) > MATERIAL_QTY_EPS) {
          throw new Error(
            `Сверка не сходится для ${item.product_name || 'материала'}: выдано должно равняться расходу, возврату и потерям.`
          );
        }
        return {
          itemId: item.id,
          consumedQuantity: Number(consumedQuantity.toFixed(4)),
          returnedQuantity: Number(returnedQuantity.toFixed(4)),
          lossQuantity: Number(lossQuantity.toFixed(4)),
        };
      });

      setBusyKey(`reconcile:${operation.id}`);
      await returnWarehouseRequestMaterials({
        requestId: request.id,
        companyId: profile.company_id,
        items,
        closeWithoutReturn: items.every((item) => item.returnedQuantity <= MATERIAL_QTY_EPS),
      });
      toast({
        title: items.some((item) => item.returnedQuantity > MATERIAL_QTY_EPS)
          ? 'Возврат передан складу'
          : 'Расход материалов сверён',
        description: items.some((item) => item.returnedQuantity > MATERIAL_QTY_EPS)
          ? 'После приёмки возврата складом операцию можно будет закрыть.'
          : 'Материалы подтверждены без физического возврата.',
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
        description: error?.message || 'Сверка материалов не сохранена',
        variant: 'destructive',
      });
    } finally {
      setBusyKey(null);
    }
  };

  const handleConfirmReturn = async (request: WarehouseIssueRequest) => {
    if (!profile?.company_id) return;
    try {
      const operation = operationById.get(request.operation_id);
      const returnResolution = getReturnResolution(request, operation);
      const hasUnknownConsumption = returnResolution.pendingRows.some((row) => !row.consumptionKnown);
      if (hasUnknownConsumption) {
        throw new Error('Сначала закройте работу и укажите фактический расход. Без факта расхода система не знает, сколько нужно вернуть.');
      }

      let items = returnResolution.pendingRows
        .map((row) => {
          const qty = Number(returnDraftByItemId[row.item.id] || 0);
          if (!Number.isFinite(qty) || qty <= 0) return null;
          if (qty > row.maxReturnQty + MATERIAL_QTY_EPS) {
            throw new Error(`Возврат больше выданного остатка: ${row.item.product_name || 'материал'}`);
          }
          return { itemId: row.item.id, returnedQuantity: Number(qty.toFixed(4)) };
        })
        .filter(Boolean) as Array<{ itemId: string; returnedQuantity: number }>;

      if (items.length === 0) {
        throw new Error('Укажите количество возврата. Если материал израсходован полностью, карточка исчезнет после факта расхода.');
      }

      setBusyKey(`return:${request.id}`);
      await returnWarehouseRequestMaterials({ requestId: request.id, companyId: profile.company_id, items });
      toast({ title: 'Возврат зарегистрирован' });
      await loadTasks();
    } catch (error: any) {
      toast({
        title: 'Ошибка',
        description: error?.message || 'Не удалось зарегистрировать возврат',
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
    const readyForStart = materialRequestsReadyForStart(requests);
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
    const canStartOperation = readyForStart && !hasAgrochemicalWithoutRequest;
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
              : phase === 'accepted' && canStartOperation
                ? 'Можно начинать работу'
                : phase === 'in_progress'
                  ? 'Работа выполняется'
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
                    void runOperationAction('accept', operation.id);
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

              {phase === 'accepted' && canStartOperation ? (
                <Button
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={(event: MouseEvent<HTMLButtonElement>) => {
                    event.stopPropagation();
                    void runOperationAction('start', operation.id);
                  }}
                  disabled={busyKey === `start:${operation.id}`}
                >
                  <Play className="mr-2 h-4 w-4" />
                  Начать работу
                </Button>
              ) : null}

              {phase === 'in_progress' ? (
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
                  Сдать факт
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

  const renderReceiptHistoryCard = (request: WarehouseIssueRequest) => {
    const operation = operationById.get(request.operation_id);
    const fieldName = operation?.fields?.name || request.field_name || '-';
    const returnResolution = getReturnResolution(request, operation);
    const pendingReturnRows = returnResolution.pendingRows;

    return (
      <Card key={request.id} className="rounded-2xl border-slate-800 bg-slate-900/70">
        <CardContent className="space-y-2.5 p-3 sm:p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-white">{request.request_number}</div>
              <div className="truncate text-xs text-slate-400">
                {fieldName} • {request.operation_type || '-'}
              </div>
            </div>
            {requestStatusBadge(request.status)}
          </div>
          <div className="space-y-1">
            {(request.items || []).slice(0, 3).map((item) => (
              <div key={item.id} className="flex justify-between gap-2 text-xs text-slate-300">
                <span className="truncate">{item.product_name || 'Материал'}</span>
                <span className="shrink-0 text-slate-400">
                  {formatQty(item.issued_quantity ?? item.planned_quantity ?? item.required_quantity, localizeUnit(item.unit || item.product_unit || '', language))}
                </span>
              </div>
            ))}
            {(request.items || []).length > 3 ? <div className="text-xs text-slate-500">+ ещё {(request.items || []).length - 3}</div> : null}
          </div>
          {pendingReturnRows.length > 0 ? (
            <div className="space-y-2 rounded-lg bg-slate-950/60 p-3">
              <div className="text-xs font-semibold text-slate-200">Возврат материалов</div>
              <div className="text-[11px] text-slate-500">
                Возврат нужен только по остатку после фактического расхода. Если материал израсходован на 100%, карточка исчезнет сама.
              </div>
              {pendingReturnRows.map((row) => {
                const item = row.item;
                return (
                  <div key={item.id} className="grid grid-cols-[1fr_88px] gap-2 text-xs">
                    <div className="min-w-0">
                      <div className="truncate text-slate-400">{item.product_name || 'Материал'}</div>
                      <div className="text-[11px] text-slate-500">
                        {row.consumptionKnown
                          ? `К возврату: ${formatQty(row.maxReturnQty, localizeUnit(item.unit || item.product_unit || '', language))}`
                          : 'Сначала нужен факт расхода'}
                      </div>
                    </div>
                    <Input
                      type="number"
                      min={0}
                      max={row.maxReturnQty}
                      step="0.01"
                      value={returnDraftByItemId[item.id] ?? '0'}
                      onChange={(event) =>
                        setReturnDraftByItemId((prev) => ({ ...prev, [item.id]: event.target.value }))
                      }
                      className="h-8"
                    />
                  </div>
                );
              })}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setReturnDraftByItemId((prev) => {
                      const next = { ...prev };
                      pendingReturnRows.forEach((row) => {
                        next[row.item.id] = row.maxReturnQty.toFixed(2);
                      });
                      return next;
                    });
                  }}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Вернуть всё
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => handleConfirmReturn(request)}
                  disabled={busyKey === `return:${request.id}`}
                >
                  Подтвердить возврат
                </Button>
              </div>
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
          filteredCompletedOperations.length + receiptHistory.length,
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
            ) : filteredCompletedOperations.length === 0 && receiptHistory.length === 0 ? (
              <Card className="border-slate-700 bg-slate-900/70"><CardContent className="p-5 text-center text-slate-400">Истории пока нет.</CardContent></Card>
            ) : (
              <>
                {filteredCompletedOperations.map((task) => renderOperationCard(task, true))}
                {receiptHistory.map(renderReceiptHistoryCard)}
              </>
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
                <div className="grid gap-3 rounded-lg border border-slate-800 bg-slate-900/70 p-4 md:grid-cols-2">
                  <div>
                    <div className="text-xs text-slate-500">Поле</div>
                    <div className="font-semibold text-white">{selectedOperation.fields?.name || 'Поле не указано'}</div>
                  </div>
                  {selectedOperationCropIdentity?.cropName ? <div>
                    <div className="text-xs text-slate-500">Культура</div>
                    <div className="font-semibold text-white">{selectedOperationCropIdentity.cropName}</div>
                  </div> : null}
                  {selectedOperationCropIdentity?.varietyName ? <div>
                    <div className="text-xs text-slate-500">Сорт</div>
                    <div className="text-slate-200">{selectedOperationCropIdentity.varietyName}</div>
                  </div> : null}
                  {selectedOperationCropIdentity?.reproductionName ? <div>
                    <div className="text-xs text-slate-500">Репродукция</div>
                    <div className="text-slate-200">{selectedOperationCropIdentity.reproductionName}</div>
                  </div> : null}
                  <div>
                    <div className="text-xs text-slate-500">Плановая площадь</div>
                    <div className="text-slate-200">{selectedPresentation?.plannedAreaHa.toFixed(2)} га</div>
                  </div>
                  {selectedPresentation?.machineName ? <div>
                    <div className="text-xs text-slate-500">Машина</div>
                    <div className="text-slate-200">{selectedPresentation.machineName}</div>
                  </div> : null}
                  {selectedPresentation?.equipmentName ? <div>
                    <div className="text-xs text-slate-500">Оборудование</div>
                    <div className="text-slate-200">{selectedPresentation.equipmentName}</div>
                  </div> : null}
                </div>

                {(selectedPresentation?.details.length || 0) > 0 ? (
                  <div className="grid gap-3 rounded-lg border border-slate-800 bg-slate-900/70 p-4 md:grid-cols-2">
                    {selectedPresentation?.details.map((detail) => (
                      <div key={detail.key}>
                        <div className="text-xs text-slate-500">{detail.label}</div>
                        <div className="text-sm font-medium text-slate-100">{detail.value}</div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {selectedPresentation?.agronomistComment ? (
                  <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-300">
                    <div className="mb-1 text-xs text-slate-500">Комментарий агронома</div>
                    {selectedPresentation.agronomistComment}
                  </div>
                ) : null}

                {getTaskPhase(selectedOperation) === 'in_progress' ? (
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

                {operationVisibleMaterials(selectedOperation).length > 0 ? <div className="space-y-2">
                  <h3 className="font-semibold text-white">Материалы</h3>
                  <div className="space-y-2">
                    {operationVisibleMaterials(selectedOperation).map((material) => (
                        <div key={material.id} className="rounded-md border border-slate-800 bg-slate-900/70 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="font-medium text-white">{operationMaterialName(material)}</div>
                            <div className="text-sm text-slate-400">
                              План: {formatQty(material.planned_quantity, localizeUnit(material.unit || material.products?.unit || '', language))}
                            </div>
                          </div>
                          <div className="mt-2 grid gap-2 md:grid-cols-4">
                            <div className="rounded-md border border-slate-800 bg-slate-950/40 p-2 text-xs">
                              <div className="text-slate-500">Выдано</div>
                              <div className="font-semibold text-slate-100">
                                {formatQty(material.issued_quantity || 0, localizeUnit(material.unit || material.products?.unit || '', language))}
                              </div>
                            </div>
                            <div>
                              <Label className="text-xs text-slate-400">Фактический расход</Label>
                              <Input
                                type="number"
                                min={0}
                                max={material.issued_quantity || undefined}
                                step="0.01"
                                value={materialFactDraft[material.id]?.consumed ?? ''}
                                onChange={(event) => {
                                  const consumed = event.target.value;
                                  setMaterialFactDraft((prev) => ({
                                    ...prev,
                                    [material.id]: { ...(prev[material.id] || { returned: '0', loss: '0', actualRate: '' }), consumed },
                                  }));
                                }}
                              />
                            </div>
                            <div>
                              <Label className="text-xs text-slate-400">Вернуть на склад</Label>
                              <Input
                                type="number"
                                min={0}
                                max={material.issued_quantity || undefined}
                                step="0.01"
                                value={materialFactDraft[material.id]?.returned ?? '0'}
                                onChange={(event) => {
                                  const returned = event.target.value;
                                  setMaterialFactDraft((prev) => ({
                                    ...prev,
                                    [material.id]: { ...(prev[material.id] || { consumed: '', loss: '0', actualRate: '' }), returned },
                                  }));
                                }}
                              />
                            </div>
                            <div>
                              <Label className="text-xs text-slate-400">Потери / списание</Label>
                              <Input
                                type="number"
                                min={0}
                                max={material.issued_quantity || undefined}
                                step="0.01"
                                value={materialFactDraft[material.id]?.loss ?? '0'}
                                onChange={(event) => {
                                  const loss = event.target.value;
                                  setMaterialFactDraft((prev) => ({
                                    ...prev,
                                    [material.id]: { ...(prev[material.id] || { consumed: '', returned: '0', actualRate: '' }), loss },
                                  }));
                                }}
                              />
                            </div>
                          </div>
                        </div>
                    ))}
                  </div>
                </div> : null}

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
                          <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-950/30 p-3 text-sm text-amber-100">
                            <div>Перед закрытием передайте фактический расход, возврат и потери на складскую сверку.</div>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => handleSubmitMaterialReconciliation(selectedOperation)}
                              disabled={busyKey === `reconcile:${selectedOperation.id}`}
                            >
                              <RotateCcw className="mr-2 h-4 w-4" />
                              {busyKey === `reconcile:${selectedOperation.id}` ? 'Сохраняем сверку...' : 'Передать сверку материалов'}
                            </Button>
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
                            disabled={!reconciliationReady || busyKey === `complete:${selectedOperation.id}`}
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
