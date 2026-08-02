'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/contexts/auth-context';
import { useLanguage } from '@/lib/contexts/language-context';
import { supabase } from '@/lib/supabase/client';
import { hasQaDataMarker } from '@/lib/utils/qa-data';
import { resolveWorkTitle } from '@/lib/operations/work-title';
import { resolveCropIdentity } from '@/lib/operations/crop-identity';
import {
  buildOperationPresentation,
  type OperationPresentation,
} from '@/lib/operations/operation-presentation';
import { SpecialistOperationPlan } from '@/components/operations/specialist-operation-plan';
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
  MapPin,
  PackageCheck,
  Search,
  X,
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
  notes?: string | null;
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
  operation_number?: string | null;
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
  fields?: {
    name: string | null;
    field_code?: string | null;
    is_test_data?: boolean | null;
    test_run_code?: string | null;
  } | null;
  is_test_data?: boolean | null;
  test_run_code?: string | null;
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
type TaskTab = 'new' | 'work' | 'completed';
type MaterialFactDraft = {
  consumed: string;
  returned: string;
  loss: string;
};

function operationHasQaMarker(operation: Operation): boolean {
  return hasQaDataMarker(
    [
      operation.operation_type,
      operation.operation_number,
      operation.notes,
      operation.test_run_code,
      operation.fields?.name,
      operation.fields?.field_code,
      operation.fields?.test_run_code,
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

function isExplicitQaCompanyName(value: unknown): boolean {
  return /(?:^|[^a-z0-9])qa(?:$|[^a-z0-9])/i.test(String(value || ''));
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function toNumber(value: unknown, fallback = 0): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function materialRateBasisFromNotes(notes: string | null | undefined): string | null {
  const matched = String(notes || '').match(/(?:^|[;\n]\s*)rate_basis\s*:\s*([a-z0-9_]+)/i);
  return matched?.[1]?.trim() || null;
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
          rate_basis: materialRateBasisFromNotes(material.notes),
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

function materialStatusText(requests: WarehouseIssueRequest[]): string {
  const activeRequests = requests.filter((request) => request.status !== 'cancelled');
  if (activeRequests.length === 0) return 'Материалы не требуются';
  if (activeRequests.some((request) => ['new', 'active', 'preparing'].includes(request.status))) {
    return 'Склад готовит материалы';
  }
  if (activeRequests.some((request) => request.status === 'ready')) return 'Готово к выдаче';
  if (activeRequests.some((request) => request.status === 'received_confirmed' && !request.issued_at)) {
    return 'Получение подтверждено';
  }
  if (
    activeRequests.some((request) =>
      ['awaiting_return', 'return_declared', 'return_pending'].includes(request.status)
    )
  ) {
    return 'Ожидается возврат';
  }
  if (
    activeRequests.every((request) =>
      ['reconciled', 'return_accepted', 'closed'].includes(
        String(request.warehouse_request_status || request.status || '')
      )
    )
  ) {
    return 'Сверка завершена';
  }
  if (materialRequestsReadyForStart(activeRequests)) return 'Выдано';
  return 'Склад готовит материалы';
}

function taskStatusBadge(phase: TaskPhase) {
  const map: Record<TaskPhase, { label: string; className: string }> = {
    active: { label: 'Новая', className: 'bg-slate-700 text-slate-100' },
    accepted: { label: 'Принято', className: 'bg-blue-500/15 text-blue-200 border border-blue-400/30' },
    in_progress: { label: 'В работе', className: 'bg-amber-500/15 text-amber-200 border border-amber-400/30' },
    awaiting_reconciliation: {
      label: 'Ожидает сверку материалов',
      className: 'bg-orange-500/15 text-orange-200 border border-orange-400/30',
    },
    awaiting_approval: { label: 'На подтверждении агронома', className: 'bg-violet-500/15 text-violet-200 border border-violet-400/30' },
    completed: { label: 'Завершено', className: 'bg-emerald-500/15 text-emerald-200 border border-emerald-400/30' },
  };
  const item = map[phase];
  return <Badge className={item.className}>{item.label}</Badge>;
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
    materials: operationVisibleMaterials(operation).map((material) => ({
      ...material,
      product_name: operationMaterialName(material),
    })) as any,
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
  const [progressAreaDraft, setProgressAreaDraft] = useState('');
  const [progressComment, setProgressComment] = useState('');
  const [confirmationKind, setConfirmationKind] = useState<ConfirmationKind | null>(null);
  const [acceptOperationId, setAcceptOperationId] = useState<string | null>(null);
  const [taskTab, setTaskTab] = useState<TaskTab>('new');
  const [taskSearch, setTaskSearch] = useState('');
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [historyFrom, setHistoryFrom] = useState('');
  const [historyTo, setHistoryTo] = useState('');
  const [isQaCompany, setIsQaCompany] = useState(false);
  const [showTestData, setShowTestData] = useState(false);
  const [materialFactDrafts, setMaterialFactDrafts] = useState<
    Record<string, MaterialFactDraft>
  >({});

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
      const [operationsResult, requestsResult, assetCatalog, companyResult] = await Promise.all([
        supabase
          .from('operations')
          .select(
            `
            id,
            operation_number,
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
            is_test_data,
            test_run_code,
            machine_id,
            equipment_id,
            transport_id,
            fields(name,field_code,is_test_data,test_run_code),
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
              notes,
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
          includeTestData: showTestData,
        }),
        getOperationAssetCatalog(profile.company_id),
        supabase
          .from('companies')
          .select('name')
          .eq('id', profile.company_id)
          .maybeSingle(),
      ]);

      if (operationsResult.error) throw operationsResult.error;
      if (companyResult.error) throw companyResult.error;

      const allowQaData = isExplicitQaCompanyName(companyResult.data?.name);
      setIsQaCompany(allowQaData);
      const cleanOperations = attachOperationAssetRelations(
        (operationsResult.data || []) as any[],
        assetCatalog
      )
        .map(normalizeOperationRow)
        .filter(
          (operation) =>
            (allowQaData && showTestData) ||
            (!operation.is_test_data &&
              !operation.fields?.is_test_data &&
              !operationHasQaMarker(operation))
        );
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
        responsible_name: operation.responsible_name || profile.full_name || profile.email,
        task_crop_identity: identityByOperationId.get(operation.id) || null,
      }));
      const cleanRequests = (requestsResult || []).filter(
        (request) =>
          (allowQaData && showTestData) ||
          (!request.is_test_data && !requestHasQaMarker(request))
      );
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
  }, [profile?.id, profile?.company_id, language, showTestData]);

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
  const acceptOperation = useMemo(
    () => operations.find((operation) => operation.id === acceptOperationId) || null,
    [acceptOperationId, operations]
  );
  const acceptPresentation = useMemo(
    () => (acceptOperation ? operationPresentation(acceptOperation) : null),
    [acceptOperation]
  );
  const selectedWarehouseMaterials = useMemo(() => {
    if (!selectedOperation) return [];
    return (requestsByOperation.get(selectedOperation.id) || [])
      .filter((request) => request.status !== 'cancelled')
      .flatMap((request) =>
        (request.items || []).map((item) => ({
          productId: item.product_id,
          preparedQuantity: toNumber(item.prepared_quantity, 0),
          issuedQuantity: toNumber(item.issued_quantity, 0),
          expectedReturnQuantity: toNumber(
            item.expected_return_quantity,
            Math.max(
              toNumber(item.issued_quantity, 0) -
                toNumber(item.planned_quantity ?? item.required_quantity, 0),
              0
            )
          ),
          statusLabel: materialStatusText([request]),
        }))
      );
  }, [requestsByOperation, selectedOperation]);

  const visibleOperations = useMemo(() => {
    const source =
      taskTab === 'new'
        ? activeOperations
        : taskTab === 'work'
          ? currentOperations
          : completedOperations;
    const search = taskSearch.trim().toLowerCase();
    return source.filter((operation) => {
      const identity = getOperationCropIdentity(operation);
      const text = [
        operationWorkTitle(operation),
        operation.fields?.name,
        identity.cropName,
        identity.varietyName,
        operation.notes,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      const dateValue = operation.completed_at || operation.date;
      const date = dateValue ? dateValue.slice(0, 10) : '';
      const matchesSearch = !search || text.includes(search);
      const matchesFrom = taskTab !== 'completed' || !historyFrom || date >= historyFrom;
      const matchesTo = taskTab !== 'completed' || !historyTo || date <= historyTo;
      return matchesSearch && matchesFrom && matchesTo;
    });
  }, [
    activeOperations,
    completedOperations,
    currentOperations,
    historyFrom,
    historyTo,
    taskSearch,
    taskTab,
  ]);

  useEffect(() => {
    if (visibleOperations.length === 0) {
      setSelectedOperationId(null);
      setMobileDetailOpen(false);
      return;
    }
    if (!visibleOperations.some((operation) => operation.id === selectedOperationId)) {
      setSelectedOperationId(visibleOperations[0].id);
    }
  }, [selectedOperationId, visibleOperations]);

  const openOperationDetails = (operation: Operation) => {
    setProgressAreaDraft('');
    setProgressComment('');
    setConfirmationKind(null);
    setSelectedOperationId(operation.id);
    setMobileDetailOpen(true);
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
      setTaskTab('work');
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
    if (completedAreaHa > stats.remaining + 0.000001) {
      toast({
        title: 'Площадь больше остатка',
        description: `За смену нельзя указать больше оставшейся площади: ${stats.remaining.toFixed(2)} га.`,
        variant: 'destructive',
      });
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
          stopReason: null,
          weatherNote: null,
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
    if (Math.abs(finalArea - areaStats.planned) > 0.000001 && !progressComment.trim()) {
      toast({
        title: 'Нужен комментарий',
        description: 'При завершении с отклонением объясните итог в общем комментарии.',
        variant: 'destructive',
      });
      return;
    }
    if (materialFactErrors.length > 0) {
      toast({
        title: 'Проверьте материалы',
        description: materialFactErrors[0],
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
      for (const request of selectedRequests) {
        const issuedItems = (request.items || []).filter(
          (item) => toNumber(item.issued_quantity, 0) > 0.000001
        );
        if (issuedItems.length === 0) continue;
        const requestStatus = String(
          request.warehouse_request_status || request.status || ''
        );
        if (
          ['reconciled', 'return_accepted', 'closed'].includes(requestStatus)
        ) {
          continue;
        }
        const items = issuedItems.map((item) => {
          const draft = materialFactDrafts[item.id];
          return {
            itemId: item.id,
            consumedQuantity: Number(draft.consumed),
            returnedQuantity: Number(draft.returned),
            lossQuantity: Number(draft.loss),
          };
        });
        await returnWarehouseRequestMaterials({
          requestId: request.id,
          companyId: profile.company_id,
          items,
          closeWithoutReturn: items.every(
            (item) =>
              item.returnedQuantity <= 0.000001 &&
              (item.lossQuantity || 0) <= 0.000001
          ),
        });
      }

      const factsByProduct = new Map<
        string,
        { consumed: number; returned: number; loss: number }
      >();
      selectedIssuedItems.forEach(({ item }) => {
        const draft = materialFactDrafts[item.id];
        const current = factsByProduct.get(item.product_id) || {
          consumed: 0,
          returned: 0,
          loss: 0,
        };
        factsByProduct.set(item.product_id, {
          consumed: current.consumed + Number(draft.consumed),
          returned: current.returned + Number(draft.returned),
          loss: current.loss + Number(draft.loss),
        });
      });
      const materialFacts = (operation.operation_materials || [])
        .filter((material) => material.product_id)
        .map((material) => {
          const fact = factsByProduct.get(String(material.product_id)) || {
            consumed: toNumber(material.consumed_quantity, 0),
            returned: toNumber(material.returned_quantity, 0),
            loss: toNumber(material.loss_quantity, 0),
          };
          return {
            material_id: material.id,
            product_id: material.product_id,
            consumed_quantity: Number(fact.consumed.toFixed(4)),
            returned_quantity: Number(fact.returned.toFixed(4)),
            loss_quantity: Number(fact.loss.toFixed(4)),
          };
        });
      const idempotencyKey = crypto.randomUUID();
      const headers = { ...(await buildAuthHeaders()), 'Idempotency-Key': idempotencyKey };
      const response = await fetch(`/api/operations/${encodeURIComponent(operation.id)}/complete`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          companyId: profile.company_id,
          comment: progressComment.trim() || 'Работа завершена',
          currentShiftAreaHa: currentShiftArea,
          varianceReason:
            Math.abs(areaStats.completed + currentShiftArea - areaStats.planned) >
            0.000001
              ? progressComment.trim()
              : null,
          lineFacts: [],
          materialFacts,
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
      setProgressAreaDraft('');
      setProgressComment('');
      if (!waitingReconciliation && !awaitingApproval) {
        setTaskTab('completed');
      }
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

  const renderCompactTask = (operation: Operation) => {
    const presentation = operationPresentation(operation);
    const phase = getTaskPhase(operation);
    const identity = getOperationCropIdentity(operation);
    const requests = (requestsByOperation.get(operation.id) || []).filter(
      (request) => request.status !== 'cancelled'
    );
    const selected = operation.id === selectedOperationId;

    return (
      <button
        key={operation.id}
        type="button"
        onClick={() => openOperationDetails(operation)}
        className={[
          'w-full rounded-lg border p-3 text-left transition-colors',
          selected
            ? 'border-yellow-400/80 bg-yellow-400/10'
            : 'border-slate-800 bg-slate-900/55 hover:border-slate-700 hover:bg-slate-900',
        ].join(' ')}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold uppercase text-yellow-300">
              {operation.operation_number
                ? `${operation.operation_number} · ${presentation.workTitle}`
                : presentation.workTitle}
            </div>
            <div className="mt-1 truncate text-base font-semibold text-slate-100">
              {operation.fields?.field_code
                ? `${operation.fields.field_code} · `
                : ''}
              {presentation.fieldName}
              {identity.cropName ? ` · ${identity.cropName}` : ''}
            </div>
          </div>
          {taskStatusBadge(phase)}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 text-[13px] text-slate-400">
          <span className="flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" />
            {formatDate(operation.date)}
          </span>
          <span className="font-medium text-slate-200">
            {formatQty(presentation.plannedAreaHa, 'га')}
          </span>
        </div>
        {requests.length > 0 ? (
          <div className="mt-2 space-y-0.5 truncate text-[13px] text-slate-500">
            <div>{requests.map((request) => request.request_number).join(', ')}</div>
            <div>{materialStatusText(requests)}</div>
          </div>
        ) : null}
      </button>
    );
  };

  const selectedPhase = selectedOperation ? getTaskPhase(selectedOperation) : null;
  const selectedRequests = useMemo(
    () =>
      selectedOperation
        ? (requestsByOperation.get(selectedOperation.id) || []).filter(
            (request) => request.status !== 'cancelled'
          )
        : [],
    [requestsByOperation, selectedOperation]
  );
  const selectedReadyRequest =
    selectedRequests.find((request) => request.status === 'ready') || null;
  const selectedReadyForProgress =
    selectedOperation != null &&
    operationReadyForProgress(selectedOperation, selectedRequests);
  const selectedAreaStats = selectedOperation
    ? operationAreaStats(selectedOperation)
    : null;
  const selectedCurrentShift = progressAreaDraft.trim()
    ? Number(progressAreaDraft)
    : 0;
  const selectedFinalArea =
    selectedAreaStats &&
    Number.isFinite(selectedCurrentShift)
      ? selectedAreaStats.completed + selectedCurrentShift
      : selectedAreaStats?.completed || 0;
  const selectedHasVariance =
    selectedAreaStats != null &&
    Math.abs(selectedFinalArea - selectedAreaStats.planned) > 0.000001;
  const selectedIssuedItems = useMemo(
    () =>
      selectedRequests.flatMap((request) =>
        (request.items || [])
          .filter((item) => toNumber(item.issued_quantity, 0) > 0.000001)
          .map((item) => ({ request, item }))
      ),
    [selectedRequests]
  );

  useEffect(() => {
    if (!selectedOperation) {
      setMaterialFactDrafts({});
      return;
    }
    setMaterialFactDrafts(
      Object.fromEntries(
        selectedIssuedItems.map(({ item }) => {
          const issued = toNumber(item.issued_quantity, 0);
          const planned = toNumber(
            item.planned_quantity ?? item.required_quantity,
            issued
          );
          const expectedReturn = toNumber(
            item.expected_return_quantity,
            Math.max(issued - planned, 0)
          );
          return [
            item.id,
            {
              consumed: String(Math.max(issued - expectedReturn, 0)),
              returned: String(expectedReturn),
              loss: '0',
            },
          ];
        })
      )
    );
  }, [selectedOperation?.id, selectedIssuedItems]);

  const materialFactErrors = useMemo(() => {
    const errors: string[] = [];
    selectedIssuedItems.forEach(({ item }) => {
      const draft = materialFactDrafts[item.id];
      const issued = toNumber(item.issued_quantity, 0);
      const consumed = Number(draft?.consumed);
      const returned = Number(draft?.returned);
      const loss = Number(draft?.loss);
      if (
        !draft ||
        ![consumed, returned, loss].every(
          (value) => Number.isFinite(value) && value >= 0
        )
      ) {
        errors.push(`${item.product_name || 'Материал'}: заполните факт.`);
        return;
      }
      if (Math.abs(issued - consumed - returned - loss) > 0.0001) {
        errors.push(
          `${item.product_name || 'Материал'}: выдано должно равняться расходу, возврату и потерям.`
        );
      }
    });
    return errors;
  }, [materialFactDrafts, selectedIssuedItems]);

  const updateMaterialFact = (
    itemId: string,
    key: keyof MaterialFactDraft,
    value: string
  ) => {
    setMaterialFactDrafts((previous) => ({
      ...previous,
      [itemId]: {
        consumed: previous[itemId]?.consumed || '0',
        returned: previous[itemId]?.returned || '0',
        loss: previous[itemId]?.loss || '0',
        [key]: value,
      },
    }));
  };

  const renderProgressForm = () => {
    if (
      !selectedOperation ||
      !selectedAreaStats ||
      !selectedPhase ||
      !(['accepted', 'in_progress'] as TaskPhase[]).includes(selectedPhase) ||
      !selectedReadyForProgress
    ) {
      return null;
    }

    return (
      <section className="space-y-4 pt-2" data-testid="shift-progress-form">
        <div>
          <h3 className="text-base font-semibold text-slate-100">Сдача смены</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <div className="text-[13px] text-slate-500">План</div>
            <div className="mt-1 font-semibold text-slate-100">
              {selectedAreaStats.planned.toFixed(2)} га
            </div>
          </div>
          <div>
            <div className="text-[13px] text-slate-500">Выполнено ранее</div>
            <div className="mt-1 font-semibold text-slate-100">
              {selectedAreaStats.completed.toFixed(2)} га
            </div>
          </div>
          <div>
            <div className="text-[13px] text-slate-500">
              {selectedAreaStats.deviation > 0 ? 'Перевыполнение' : 'Осталось'}
            </div>
            <div className="mt-1 font-semibold text-slate-100">
              {selectedAreaStats.deviation > 0
                ? `+${selectedAreaStats.deviation.toFixed(2)}`
                : selectedAreaStats.remaining.toFixed(2)}{' '}
              га
            </div>
          </div>
        </div>
        <div className="grid gap-4 rounded-lg border border-slate-800 bg-slate-900/45 p-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="shift-area" className="text-[13px] text-slate-400">
              Выполнено за смену, га
            </Label>
            <Input
              id="shift-area"
              type="number"
              min={0}
              max={selectedAreaStats.remaining}
              step="0.01"
              value={progressAreaDraft}
              onChange={(event) => setProgressAreaDraft(event.target.value)}
              className="mt-1 h-12"
            />
            {Number(progressAreaDraft) > 0 ? (
              <div className="mt-2 text-[13px] text-slate-400">
                Станет выполнено: {selectedFinalArea.toFixed(2)} га.{' '}
                {selectedFinalArea > selectedAreaStats.planned
                  ? `Отклонение: +${(
                      selectedFinalArea - selectedAreaStats.planned
                    ).toFixed(2)} га.`
                  : `Останется: ${Math.max(
                      selectedAreaStats.planned - selectedFinalArea,
                      0
                    ).toFixed(2)} га.`}
              </div>
            ) : null}
          </div>
          <div>
            <Label htmlFor="shift-comment" className="text-[13px] text-slate-400">
              Комментарий
            </Label>
            <Input
              id="shift-comment"
              value={progressComment}
              onChange={(event) => setProgressComment(event.target.value)}
              placeholder={
                selectedHasVariance
                  ? 'Обязателен при завершении с отклонением'
                  : 'Необязательно'
              }
              className="mt-1 h-12"
            />
          </div>
        </div>
        {selectedIssuedItems.length > 0 ? (
          <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/45 p-4">
            <div>
              <h4 className="font-semibold text-slate-100">Факт по материалам</h4>
              <p className="mt-1 text-[13px] text-slate-500">
                Расход + возврат + потери должны точно равняться выданному количеству.
              </p>
            </div>
            {selectedIssuedItems.map(({ request, item }) => {
              const draft = materialFactDrafts[item.id] || {
                consumed: '',
                returned: '',
                loss: '',
              };
              return (
                <div
                  key={item.id}
                  className="grid gap-3 border-t border-slate-800 pt-3 sm:grid-cols-[minmax(150px,1.2fr)_repeat(3,minmax(90px,0.7fr))]"
                >
                  <div>
                    <div className="font-medium text-slate-100">
                      {item.product_name || 'Материал'}
                    </div>
                    <div className="mt-1 text-[12px] text-slate-500">
                      {request.request_number} · выдано{' '}
                      {formatQty(item.issued_quantity, item.unit)}
                    </div>
                  </div>
                  {(
                    [
                      ['consumed', 'Израсходовано'],
                      ['returned', 'Вернуть'],
                      ['loss', 'Потери'],
                    ] as Array<[keyof MaterialFactDraft, string]>
                  ).map(([key, label]) => (
                    <div key={key}>
                      <Label
                        htmlFor={`material-${item.id}-${key}`}
                        className="text-[12px] text-slate-500"
                      >
                        {label}, {item.unit}
                      </Label>
                      <Input
                        id={`material-${item.id}-${key}`}
                        type="number"
                        min={0}
                        step="0.0001"
                        value={draft[key]}
                        onChange={(event) =>
                          updateMaterialFact(item.id, key, event.target.value)
                        }
                        className="mt-1 h-10"
                      />
                    </div>
                  ))}
                </div>
              );
            })}
            {materialFactErrors.length > 0 ? (
              <div className="text-[13px] text-red-300">
                {materialFactErrors[0]}
              </div>
            ) : (
              <div className="text-[13px] text-emerald-300">
                Материальный баланс сходится.
              </div>
            )}
          </div>
        ) : null}
      </section>
    );
  };

  const renderShiftHistory = () => {
    if (!selectedOperation || (selectedOperation.operation_progress || []).length === 0) {
      return null;
    }
    return (
      <section className="space-y-3 pt-2">
        <h3 className="text-base font-semibold text-slate-100">История смен</h3>
        <div className="space-y-3">
          {(selectedOperation.operation_progress || [])
            .slice()
            .sort(
              (a, b) =>
                new Date(b.reported_at).getTime() -
                new Date(a.reported_at).getTime()
            )
            .map((report) => (
              <div
                key={report.id}
                className="flex flex-wrap items-start justify-between gap-3 text-sm"
              >
                <div>
                  <div className="font-medium text-slate-100">
                    {new Date(report.reported_at).toLocaleDateString('ru-RU')} · +
                    {Number(report.completed_area_ha).toFixed(2)} га
                  </div>
                  {report.comment ? <div className="mt-1 text-[13px] text-slate-400">Комментарий: {report.comment}</div> : null}
                </div>
                <div className="text-[13px] text-slate-500">
                  {new Date(report.reported_at).toLocaleTimeString('ru-RU', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
            ))}
        </div>
      </section>
    );
  };

  const renderCompletedSummary = () => {
    if (
      !selectedPresentation ||
      !selectedPhase ||
      !(['completed', 'awaiting_approval', 'awaiting_reconciliation'] as TaskPhase[]).includes(
        selectedPhase
      )
    ) {
      return null;
    }
    const deviation = selectedPresentation.deviationAreaHa;
    return (
      <section className="grid gap-3 pt-2 sm:grid-cols-3">
        <div>
          <div className="text-[13px] text-slate-500">План</div>
          <div className="mt-1 font-semibold text-slate-100">
            {selectedPresentation.plannedAreaHa.toFixed(2)} га
          </div>
        </div>
        <div>
          <div className="text-[13px] text-slate-500">Факт</div>
          <div className="mt-1 font-semibold text-slate-100">
            {selectedPresentation.completedAreaHa.toFixed(2)} га
          </div>
        </div>
        <div>
          <div className="text-[13px] text-slate-500">Отклонение</div>
          <div className="mt-1 font-semibold text-slate-100">
            {deviation > 0 ? '+' : ''}
            {deviation.toFixed(2)} га
          </div>
        </div>
      </section>
    );
  };

  const renderDetailFooter = () => {
    if (!selectedOperation || !selectedPhase) return null;

    if (selectedPhase === 'active') {
      return (
        <div className="flex flex-col gap-3 border-t border-slate-800 bg-slate-950 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="text-[13px] text-slate-400">
            Примите задачу, чтобы начать работу.
          </div>
          <Button
            className="h-12 w-full bg-yellow-400 text-slate-950 hover:bg-yellow-300 sm:w-auto sm:min-w-52"
            onClick={() => setAcceptOperationId(selectedOperation.id)}
            disabled={busyKey === `accept:${selectedOperation.id}`}
          >
            <Clock className="mr-2 h-4 w-4" />
            Принять задачу
          </Button>
        </div>
      );
    }

    if (selectedPhase === 'accepted' && selectedReadyRequest) {
      return (
        <div className="flex flex-col gap-3 border-t border-slate-800 bg-slate-950 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="text-[13px] text-slate-400">
            Склад подготовил материалы. Подтвердите физическое получение без изменения количества.
          </div>
          <Button
            className="h-12 w-full bg-yellow-400 text-slate-950 hover:bg-yellow-300 sm:w-auto"
            onClick={() => void handleConfirmReceipt(selectedReadyRequest.id)}
            disabled={busyKey === `receipt:${selectedReadyRequest.id}`}
          >
            <PackageCheck className="mr-2 h-4 w-4" />
            Подтвердить получение
          </Button>
        </div>
      );
    }

    if (
      (selectedPhase === 'accepted' || selectedPhase === 'in_progress') &&
      selectedReadyForProgress
    ) {
      return (
        <div className="grid gap-2 border-t border-slate-800 bg-slate-950 px-4 py-4 sm:grid-cols-2 sm:px-6">
          <Button
            type="button"
            variant="outline"
            className="h-12"
            onClick={() => requestProgressConfirmation(selectedOperation)}
            disabled={busyKey === `progress:${selectedOperation.id}`}
          >
            Сдать прогресс
          </Button>
          <Button
            className="h-12 bg-yellow-400 text-slate-950 hover:bg-yellow-300"
            onClick={() => requestFinishConfirmation(selectedOperation)}
            disabled={busyKey === `complete:${selectedOperation.id}`}
          >
            <CheckCircle className="mr-2 h-4 w-4" />
            Завершить работу
          </Button>
        </div>
      );
    }

    if (selectedPhase === 'accepted' && selectedRequests.length > 0) {
      return (
        <div className="border-t border-slate-800 bg-slate-950 px-4 py-4 text-[13px] text-slate-400 sm:px-6">
          {materialStatusText(selectedRequests)}. План остаётся доступен только для чтения.
        </div>
      );
    }

    return null;
  };

  if (!isTaskRole) {
    return (
      <div className="space-y-4">
        <h1 className="text-[28px] font-bold text-slate-100">Мои задачи</h1>
        <Alert variant="destructive">
          <AlertDescription>Эта страница доступна специалистам и бригадирам.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[28px] font-bold text-slate-100 sm:text-[30px]">Мои задачи</h1>
            <p className="mt-1 text-sm text-slate-400">
              Утверждённые планы, сменный прогресс и история выполнения
            </p>
          </div>
          {isQaCompany ? (
            <div className="flex items-center gap-2 pt-2">
              <Switch
                id="tasks-test-data"
                checked={showTestData}
                onCheckedChange={setShowTestData}
              />
              <Label htmlFor="tasks-test-data" className="text-sm text-slate-300">
                Показать тестовые данные
              </Label>
            </div>
          ) : null}
        </div>
      </header>

      <div className="grid min-h-[680px] gap-4 lg:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        <aside className="min-w-0">
          <Tabs
            value={taskTab}
            onValueChange={(value) => {
              setTaskTab(value as TaskTab);
              setMobileDetailOpen(false);
            }}
          >
            <TabsList className="grid h-11 w-full grid-cols-3 bg-slate-900">
              <TabsTrigger value="new" className="gap-1.5">
                Новые <span className="text-xs">{activeOperations.length}</span>
              </TabsTrigger>
              <TabsTrigger value="work" className="gap-1.5">
                В работе <span className="text-xs">{currentOperations.length}</span>
              </TabsTrigger>
              <TabsTrigger value="completed" className="gap-1.5">
                Завершённые <span className="text-xs">{completedOperations.length}</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              value={taskSearch}
              onChange={(event) => setTaskSearch(event.target.value)}
              placeholder="Найти работу или поле"
              className="h-11 border-slate-800 bg-slate-950 pl-9"
            />
          </div>

          {taskTab === 'completed' ? (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Input
                type="date"
                value={historyFrom}
                onChange={(event) => setHistoryFrom(event.target.value)}
                className="h-10 border-slate-800 bg-slate-950"
                aria-label="История с даты"
              />
              <Input
                type="date"
                value={historyTo}
                onChange={(event) => setHistoryTo(event.target.value)}
                className="h-10 border-slate-800 bg-slate-950"
                aria-label="История по дату"
              />
            </div>
          ) : null}

          <div className="travkin-scrollbar mt-3 max-h-[calc(100dvh-250px)] space-y-2 overflow-y-auto pr-1">
            {loading ? (
              <div className="py-10 text-center text-sm text-slate-400">Загрузка задач...</div>
            ) : visibleOperations.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-400">
                В этой вкладке задач нет.
              </div>
            ) : (
              visibleOperations.map(renderCompactTask)
            )}
          </div>
        </aside>

        <section
          className={[
            'grid min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border-slate-800 bg-slate-950 text-slate-100',
            mobileDetailOpen
              ? 'fixed inset-0 z-50 h-[100dvh] border'
              : 'hidden',
            'lg:sticky lg:top-4 lg:z-auto lg:grid lg:h-[calc(100dvh-120px)] lg:rounded-lg lg:border',
          ].join(' ')}
          aria-label="Полный план работы"
        >
          {selectedOperation ? (
            <>
              <header className="border-b border-slate-800 px-4 py-4 sm:px-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold uppercase text-yellow-300">
                      {selectedOperation.operation_number
                        ? `${selectedOperation.operation_number} · `
                        : ''}
                      {selectedPresentation?.categoryTitle}
                    </div>
                    <h2 className="mt-1 text-2xl font-bold text-slate-100 sm:text-[26px]">
                      {selectedPresentation?.workTitle}
                    </h2>
                    <div className="mt-2 flex items-center gap-1.5 text-base font-semibold text-slate-200 sm:text-lg">
                        <MapPin className="h-4 w-4 text-slate-500" />
                        {selectedOperation.fields?.field_code
                          ? `${selectedOperation.fields.field_code} · `
                          : ''}
                        {selectedPresentation?.fieldName}
                        {selectedPresentation?.cropName
                          ? ` · ${selectedPresentation.cropName}`
                          : ''}
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 text-[13px] text-slate-500">
                        <CalendarDays className="h-3.5 w-3.5" />
                        {formatDate(selectedOperation.date)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {taskStatusBadge(getTaskPhase(selectedOperation))}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-12 w-12 lg:hidden"
                      onClick={() => setMobileDetailOpen(false)}
                      aria-label="Закрыть карточку"
                    >
                      <X className="h-5 w-5" />
                    </Button>
                  </div>
                </div>
              </header>

              <div className="travkin-scrollbar space-y-6 overflow-y-auto px-4 py-5 sm:px-6">
                {selectedPresentation ? (
                  <SpecialistOperationPlan
                    presentation={selectedPresentation}
                    warehouseMaterials={selectedWarehouseMaterials}
                  />
                ) : null}

                {renderProgressForm()}

                {renderShiftHistory()}
                {renderCompletedSummary()}

              </div>
              {renderDetailFooter()}
            </>
          ) : (
            <div className="hidden h-full place-items-center text-sm text-slate-500 lg:grid">
              Выберите задачу слева.
            </div>
          )}
        </section>
      </div>

      <AlertDialog
        open={Boolean(acceptOperationId)}
        onOpenChange={(open) => !open && setAcceptOperationId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Принять задачу?</AlertDialogTitle>
            <AlertDialogDescription>
              После подтверждения задача перейдёт во вкладку «В работе».
            </AlertDialogDescription>
          </AlertDialogHeader>
          {acceptPresentation ? (
            <div className="grid gap-3 rounded-lg bg-muted/40 p-4 text-sm sm:grid-cols-2">
              <div>
                <div className="text-muted-foreground">Работа</div>
                <div className="mt-1 font-semibold">{acceptPresentation.workTitle}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Поле</div>
                <div className="mt-1 font-semibold">{acceptPresentation.fieldName}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Площадь</div>
                <div className="mt-1 font-semibold">
                  {acceptPresentation.plannedAreaHa.toFixed(2)} га
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Дата</div>
                <div className="mt-1 font-semibold">
                  {formatDate(acceptPresentation.date)}
                </div>
              </div>
            </div>
          ) : null}
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
                  <AlertDialogTitle>{isProgress ? 'Сдать прогресс?' : 'Завершить работу?'}</AlertDialogTitle>
                  <AlertDialogDescription>
                    До подтверждения данные не записываются.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="grid grid-cols-2 gap-3 rounded-md bg-muted/40 p-3 text-sm">
                  <div><span className="text-muted-foreground">План:</span> {stats.planned.toFixed(2)} га</div>
                  <div><span className="text-muted-foreground">Выполнено ранее:</span> {stats.completed.toFixed(2)} га</div>
                  <div><span className="text-muted-foreground">За смену:</span> {shiftArea.toFixed(2)} га</div>
                  <div><span className="text-muted-foreground">Станет:</span> {finalArea.toFixed(2)} га</div>
                  <div>
                    <span className="text-muted-foreground">
                      {isProgress ? 'Останется:' : 'Отклонение от плана:'}
                    </span>{' '}
                    {isProgress
                      ? remaining.toFixed(2)
                      : `${deviation > 0 ? '+' : ''}${deviation.toFixed(2)}`}{' '}
                    га
                  </div>
                  <div><span className="text-muted-foreground">Процент:</span> {stats.planned > 0 ? ((finalArea / stats.planned) * 100).toFixed(1) : '0'}%</div>
                </div>
                {progressComment ? (
                  <div className="text-sm"><span className="text-muted-foreground">Комментарий:</span> {progressComment}</div>
                ) : null}
                <AlertDialogFooter>
                  <AlertDialogCancel>Назад</AlertDialogCancel>
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
                      : 'Подтвердить'}
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
