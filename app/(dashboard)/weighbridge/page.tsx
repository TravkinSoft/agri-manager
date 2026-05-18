"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, FileDown, History, Scale, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useAuth } from "@/lib/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/contexts/language-context";
import { localizedName } from "@/lib/i18n/helpers";
import { supabase } from "@/lib/supabase/client";
import { adminTicketAction, closeShift, createTicket, downloadTicketPdf, finalizeTicket, getWeighbridgeBootstrap, listTickets, openShift, patchTicket, voidTicket } from "@/lib/services/weighbridge";
import type { TicketDirection, TicketInput, TicketLineInput, WeighbridgeTicket } from "@/lib/types/weighbridge";

type Lang = "ru" | "kz" | "en";
type OperationType = "harvest_incoming" | "supplier_receipt" | "issue_to_field" | "transfer_between_warehouses" | "shipment_outbound" | "disposal_writeoff" | "drying";
type MovementGroup = "warehouse_inbound" | "field_issue" | "internal_transfer" | "shipment" | "writeoff";
type Option = { id: string; name: string };
type LocalizedRef = {
  id: string;
  name?: string | null;
  name_ru?: string | null;
  name_kz?: string | null;
  name_en?: string | null;
};
type ProductOption = Option & { type?: string };
type StockIdentityOption = {
  key: string;
  product_id: string;
  product_name: string;
  variety_id: string | null;
  variety_name: string;
  reproduction_id: string | null;
  reproduction_name: string;
  batch_id: string | null;
  batch_class: string;
  batch_class_label: string;
  product_type?: string;
  quantity: number;
  label: string;
};
type SupplierReceiptMode = "weighbridge" | "direct";
type SupplierItemMode = "generic" | "agro_identity";
type TransferMode = "weighbridge" | "direct";
type FieldIssueMode = "weighbridge" | "direct";
type FieldMaterialCategory = "seed_planting_material" | "fertilizer" | "crop_protection" | "organic" | "fuel" | "other";
type DisposalCategory = "utilization" | "spoilage" | "shortage" | "waste" | "other_removal";
type ShipmentPurpose = "sale" | "export" | "seed_release" | "return" | "processor" | "other";
type HarvestStructureOption = {
  allocationId: string;
  areaHa: number;
  cropId: string;
  cropName: string;
  varietyId: string;
  varietyName: string;
  reproductionId: string;
  reproductionName: string;
  isIncomplete: boolean;
  debug?: {
    cropId: string;
    varietyId: string;
    reproductionId: string;
    hasVarietyRef: boolean;
    hasReproductionRef: boolean;
  };
};
type WorkstationMode = "standard" | "peak_harvest" | "night_minimal";

type FormState = {
  operationType: OperationType;
  fieldId: string;
  warehouseFromId: string;
  warehouseToId: string;
  processingPointId: string;
  cropId: string;
  varietyId: string;
  reproductionId: string;
  cropStructureAllocationId: string;
  supplierId: string;
  buyerId: string;
  supplierDocumentNo: string;
  shipmentPurpose: ShipmentPurpose;
  destinationText: string;
  externalDocumentNo: string;
  supplierReceiptMode: SupplierReceiptMode;
  supplierItemMode: SupplierItemMode;
  transferMode: TransferMode;
  fieldIssueMode: FieldIssueMode;
  fieldMaterialCategory: FieldMaterialCategory;
  supplierLot: string;
  harvestYear: string;
  productId: string;
  stockIdentityKey: string;
  quantityKg: string;
  dryingOutputKg: string;
  moistureIn: string;
  moistureOut: string;
  grossKg: string;
  vehicleId: string;
  driverId: string;
  disposalCategory: DisposalCategory;
  disposalReason: string;
  notes: string;
};

const INITIAL_FORM: FormState = {
  operationType: "harvest_incoming",
  fieldId: "",
  warehouseFromId: "",
  warehouseToId: "",
  processingPointId: "",
  cropId: "",
  varietyId: "",
  reproductionId: "",
  cropStructureAllocationId: "",
  supplierId: "",
  buyerId: "",
  supplierDocumentNo: "",
  shipmentPurpose: "sale",
  destinationText: "",
  externalDocumentNo: "",
  supplierReceiptMode: "weighbridge",
  supplierItemMode: "generic",
  transferMode: "weighbridge",
  fieldIssueMode: "weighbridge",
  fieldMaterialCategory: "seed_planting_material",
  supplierLot: "",
  harvestYear: "",
  productId: "",
  stockIdentityKey: "",
  quantityKg: "",
  dryingOutputKg: "",
  moistureIn: "",
  moistureOut: "",
  grossKg: "",
  vehicleId: "",
  driverId: "",
  disposalCategory: "utilization",
  disposalReason: "",
  notes: "",
};

const PERSIST_KEYS: Array<keyof FormState> = [
  "operationType",
  "fieldId",
  "warehouseToId",
];

const LEGACY_MOVEMENT_GROUPS: Array<{ id: MovementGroup; title: string; hint: string }> = [
  { id: "warehouse_inbound", title: "Приход на склад", hint: "Урожай или поставка" },
  { id: "field_issue", title: "Выдача в поле", hint: "Материалы со склада" },
  { id: "internal_transfer", title: "Внутреннее перемещение", hint: "Склад → склад" },
  { id: "writeoff", title: "Списание / выбытие", hint: "Порча, утилизация, недостача" },
];

const LEGACY_GROUP_DEFAULT_OPERATION: Record<string, OperationType> = {
  warehouse_inbound: "harvest_incoming",
  field_issue: "issue_to_field",
  internal_transfer: "transfer_between_warehouses",
  writeoff: "disposal_writeoff",
};

const LEGACY_OPERATION_GROUP: Partial<Record<OperationType, MovementGroup>> = {
  harvest_incoming: "warehouse_inbound",
  supplier_receipt: "warehouse_inbound",
  issue_to_field: "field_issue",
  transfer_between_warehouses: "internal_transfer",
  disposal_writeoff: "writeoff",
};

const LEGACY_GROUP_SUBTYPES: Record<string, Array<{ type: OperationType; title: string; hint: string }>> = {
  warehouse_inbound: [
    { type: "harvest_incoming", title: "Урожай с поля", hint: "Поле → склад" },
    { type: "supplier_receipt", title: "Поставка от контрагента", hint: "Поставщик → склад" },
  ],
  field_issue: [{ type: "issue_to_field", title: "Склад → поле", hint: "Выдача материалов" }],
  internal_transfer: [{ type: "transfer_between_warehouses", title: "Склад → склад", hint: "Перемещение остатка" }],
  writeoff: [{ type: "disposal_writeoff", title: "Списание со склада", hint: "Утилизация, порча, недостача" }],
};

const legacyMovementGroupForOperation = (operationType: OperationType): MovementGroup =>
  OPERATION_GROUP[operationType] || "warehouse_inbound";

const legacyOpMeta = (type: OperationType) => {
  if (type === "harvest_incoming") return { title: "Урожай с поля", ticketType: "harvest", opType: "harvest_incoming", direction: "incoming" as TicketDirection, sourceKind: "field", destinationKind: "warehouse" };
  if (type === "supplier_receipt") return { title: "Поставка от контрагента", ticketType: "receipt", opType: "supplier_receipt", direction: "incoming" as TicketDirection, sourceKind: "supplier", destinationKind: "warehouse" };
  if (type === "issue_to_field") return { title: "Выдача в поле", ticketType: "issue", opType: "issue_to_field", direction: "outgoing" as TicketDirection, sourceKind: "warehouse", destinationKind: "field" };
  if (type === "transfer_between_warehouses") return { title: "Склад → склад", ticketType: "transfer", opType: "warehouse_transfer", direction: "transfer" as TicketDirection, sourceKind: "warehouse", destinationKind: "warehouse" };
  if (type === "disposal_writeoff") return { title: "Списание / выбытие", ticketType: "disposal", opType: "disposal", direction: "outgoing" as TicketDirection, sourceKind: "warehouse", destinationKind: "disposal" };
  return { title: "Сушка", ticketType: "processing", opType: "drying", direction: "processing" as TicketDirection, sourceKind: "warehouse", destinationKind: "processing_point" };
};

const legacyStatusLabel = (status: string) => {
  if (status === "draft") return "Черновик";
  if (status === "active") return "Активен";
  if (status === "ready_to_close") return "Готов к закрытию";
  if (status === "finalized") return "Закрыт";
  if (status === "voided") return "Аннулирован";
  return status;
};

const statusClass = (status: string) => (status === "finalized" ? "bg-emerald-100 text-emerald-800" : status === "voided" ? "bg-slate-200 text-slate-700" : "bg-amber-100 text-amber-800");
const legacyOperationUiLabel = (opType: string) => {
  if (opType === "harvest_incoming") return "Урожай";
  if (opType === "supplier_receipt") return "Поставка от контрагента";
  if (opType === "issue_to_field") return "Выдача в поле";
  if (opType === "warehouse_transfer") return "Склад → склад";
  if (opType === "disposal") return "Списание";
  if (opType === "drying") return "Сушка";
  return opType || "Операция";
};
const legacyFieldIssueOperationLabels: Record<string, string> = {
  seeding: "Семена",
  top_dressing: "Удобрения",
  herbicide: "СЗР",
  fungicide: "Фунгицид",
  insecticide: "Инсектицид",
  desiccation: "Десикация",
  irrigation: "Полив",
  fuel: "ГСМ",
  other: "Другое",
};
const legacyIsSeedIssueOperation = (value: string) => value === "seeding";
const legacyMaterialMatchesOperation = (item: StockIdentityOption, operationType: string) => {
  const hay = `${item.product_name} ${item.product_type || ""} ${item.batch_class_label}`.toLowerCase();
  if (operationType === "seeding") {
    return item.batch_class === "seed" || hay.includes("сем") || hay.includes("seed") || hay.includes("картофель");
  }
  if (operationType === "top_dressing") return hay.includes("fert") || hay.includes("удобр") || hay.includes("селит") || hay.includes("аммо") || hay.includes("npk");
  if (operationType === "herbicide") return hay.includes("herb") || hay.includes("герб");
  if (operationType === "fungicide") return hay.includes("fung") || hay.includes("фунг");
  if (operationType === "insecticide") return hay.includes("insect") || hay.includes("инсект");
  if (operationType === "desiccation") return hay.includes("desic") || hay.includes("десик");
  if (operationType === "fuel") return hay.includes("fuel") || hay.includes("гсм") || hay.includes("диз") || hay.includes("топлив");
  return true;
};
const legacyTicketStageLabel = (t: WeighbridgeTicket) => {
  if (t.status === "ready_to_close") return "Закрыть";
  if (t.status === "voided") return "Проверка";
  if (t.status === "finalized") return "Закрыт";
  if (t.gross_weight_kg == null) return "Ждёт брутто";
  if (t.tare_weight_kg == null) return "Ждёт тару";
  return "Брутто";
};
const MOVEMENT_GROUPS: Array<{ id: MovementGroup; title: string; hint: string }> = [
  { id: "warehouse_inbound", title: "Приход на склад", hint: "Урожай или поставка" },
  { id: "field_issue", title: "Выдача в поле", hint: "Материалы со склада" },
  { id: "internal_transfer", title: "Внутреннее перемещение", hint: "Склад → склад" },
  { id: "shipment", title: "Отгрузка", hint: "Склад → контрагент" },
  { id: "writeoff", title: "Списание / выбытие", hint: "Порча, утилизация, недостача" },
];

const GROUP_DEFAULT_OPERATION: Record<MovementGroup, OperationType> = {
  warehouse_inbound: "harvest_incoming",
  field_issue: "issue_to_field",
  internal_transfer: "transfer_between_warehouses",
  shipment: "shipment_outbound",
  writeoff: "disposal_writeoff",
};

const OPERATION_GROUP: Partial<Record<OperationType, MovementGroup>> = {
  harvest_incoming: "warehouse_inbound",
  supplier_receipt: "warehouse_inbound",
  issue_to_field: "field_issue",
  transfer_between_warehouses: "internal_transfer",
  shipment_outbound: "shipment",
  disposal_writeoff: "writeoff",
};

const GROUP_SUBTYPES: Record<MovementGroup, Array<{ type: OperationType; title: string; hint: string }>> = {
  warehouse_inbound: [
    { type: "harvest_incoming", title: "Урожай с поля", hint: "Поле → склад" },
    { type: "supplier_receipt", title: "Поставка от контрагента", hint: "Поставщик → склад" },
  ],
  field_issue: [{ type: "issue_to_field", title: "Склад → поле", hint: "Выдача материалов" }],
  internal_transfer: [{ type: "transfer_between_warehouses", title: "Склад → склад", hint: "Перемещение остатка" }],
  shipment: [{ type: "shipment_outbound", title: "Отгрузка", hint: "Покупатель, экспорт, возврат" }],
  writeoff: [{ type: "disposal_writeoff", title: "Списание со склада", hint: "Утилизация, порча, недостача" }],
};

const movementGroupForOperation = (operationType: OperationType): MovementGroup =>
  OPERATION_GROUP[operationType] || "warehouse_inbound";

const opMeta = (type: OperationType) => {
  if (type === "harvest_incoming") return { title: "Урожай с поля", ticketType: "harvest", opType: "harvest_incoming", direction: "incoming" as TicketDirection, sourceKind: "field", destinationKind: "warehouse" };
  if (type === "supplier_receipt") return { title: "Поставка от контрагента", ticketType: "receipt", opType: "supplier_receipt", direction: "incoming" as TicketDirection, sourceKind: "supplier", destinationKind: "warehouse" };
  if (type === "issue_to_field") return { title: "Выдача в поле", ticketType: "issue", opType: "issue_to_field", direction: "outgoing" as TicketDirection, sourceKind: "warehouse", destinationKind: "field" };
  if (type === "transfer_between_warehouses") return { title: "Склад → склад", ticketType: "transfer", opType: "warehouse_transfer", direction: "transfer" as TicketDirection, sourceKind: "warehouse", destinationKind: "warehouse" };
  if (type === "shipment_outbound") return { title: "Отгрузка", ticketType: "shipment", opType: "shipment_outbound", direction: "outgoing" as TicketDirection, sourceKind: "warehouse", destinationKind: "counterparty" };
  if (type === "disposal_writeoff") return { title: "Списание / выбытие", ticketType: "disposal", opType: "disposal", direction: "outgoing" as TicketDirection, sourceKind: "warehouse", destinationKind: "disposal" };
  return { title: "Сушка", ticketType: "processing", opType: "drying", direction: "processing" as TicketDirection, sourceKind: "warehouse", destinationKind: "processing_point" };
};

const statusLabel = (status: string) => {
  if (status === "draft") return "Черновик";
  if (status === "active") return "Активен";
  if (status === "ready_to_close") return "Готов к закрытию";
  if (status === "finalized") return "Закрыт";
  if (status === "voided") return "Аннулирован";
  return status;
};

const operationUiLabel = (opType: string) => {
  if (opType === "harvest_incoming") return "Урожай";
  if (opType === "supplier_receipt") return "Поставка от контрагента";
  if (opType === "issue_to_field") return "Выдача в поле";
  if (opType === "warehouse_transfer") return "Склад → склад";
  if (opType === "shipment_outbound") return "Отгрузка";
  if (opType === "disposal") return "Списание";
  if (opType === "drying") return "Сушка";
  return opType || "Операция";
};

const fieldMaterialCategoryLabels: Record<FieldMaterialCategory, string> = {
  seed_planting_material: "Семена / посадочный материал",
  fertilizer: "Удобрения",
  crop_protection: "СЗР",
  organic: "Органика",
  fuel: "ГСМ",
  other: "Прочие материалы",
};

const disposalCategoryLabels: Record<DisposalCategory, string> = {
  utilization: "Утилизация",
  spoilage: "Порча",
  shortage: "Недостача",
  waste: "Отходы",
  other_removal: "Прочий вывоз",
};

const shipmentPurposeLabels: Record<ShipmentPurpose, string> = {
  sale: "Продажа",
  export: "Экспорт",
  seed_release: "Семенной отпуск",
  return: "Возврат",
  processor: "Переработчику",
  other: "Прочее",
};

const isSeedIssueOperation = (value: string) => value === "seed_planting_material";
const materialMatchesOperation = (item: StockIdentityOption, category: FieldMaterialCategory) => {
  const hay = `${item.product_name} ${item.product_type || ""} ${item.batch_class_label}`.toLowerCase();
  if (category === "seed_planting_material") {
    return item.batch_class === "seed" || hay.includes("сем") || hay.includes("seed") || hay.includes("посад");
  }
  if (category === "fertilizer") return hay.includes("fert") || hay.includes("удобр") || hay.includes("селит") || hay.includes("аммо") || hay.includes("npk");
  if (category === "crop_protection") return hay.includes("сзр") || hay.includes("герб") || hay.includes("фунг") || hay.includes("инсект") || hay.includes("пест") || hay.includes("desic");
  if (category === "organic") return hay.includes("навоз") || hay.includes("компост") || hay.includes("орган") || hay.includes("biomass") || hay.includes("биомас");
  if (category === "fuel") return hay.includes("гсм") || hay.includes("диз") || hay.includes("топлив") || hay.includes("fuel");
  return true;
};

const ticketStageLabel = (t: WeighbridgeTicket) => {
  if (t.status === "ready_to_close") return "Закрыть";
  if (t.status === "voided") return "Проверка";
  if (t.status === "finalized") return "Закрыт";
  if (t.gross_weight_kg == null) return "Ждёт брутто";
  if (t.tare_weight_kg == null) return "Ждёт тару";
  return "Брутто";
};

const toNum = (value: string) => (value.trim() && Number.isFinite(Number(value)) ? Number(value) : null);
const net = (gross: string, tare: string) => {
  const g = toNum(gross);
  const t = toNum(tare);
  if (g == null || t == null) return null;
  return g - t;
};
const getLang = (language: string): Lang => (language === "kz" || language === "en" ? language : "ru");
const normName = (value: string) => value.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, " ").trim();
const isUuidLike = (value: string | null | undefined) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ""));
const fmt = (value: string | null | undefined, language: Lang) => {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  const locale = language === "kz" ? "kk-KZ" : language === "en" ? "en-US" : "ru-RU";
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
};

export default function WeighbridgeOperationsPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { language } = useLanguage();
  const lang = getLang(language);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [tickets, setTickets] = useState<WeighbridgeTicket[]>([]);
  const [fields, setFields] = useState<{ id: string; name: string; area: number }[]>([]);
  const [warehouses, setWarehouses] = useState<Option[]>([]);
  const [suppliers, setSuppliers] = useState<Option[]>([]);
  const [buyers, setBuyers] = useState<Option[]>([]);
  const [vehicles, setVehicles] = useState<{ id: string; name: string; plate: string; primaryPersonnelId: string | null }[]>([]);
  const [processingPoints, setProcessingPoints] = useState<Option[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [stockIdentityOptions, setStockIdentityOptions] = useState<StockIdentityOption[]>([]);
  const [stockIdentityLoading, setStockIdentityLoading] = useState(false);
  const [crops, setCrops] = useState<Option[]>([]);
  const [varieties, setVarieties] = useState<{ id: string; name: string; cropId: string; cropName: string }[]>([]);
  const [reproductions, setReproductions] = useState<Option[]>([]);
  const [drivers, setDrivers] = useState<{ id: string; name: string; machineId: string | null; assignedVehicleIds: string[] }[]>([]);
  const [harvestStructureByField, setHarvestStructureByField] = useState<Record<string, HarvestStructureOption[]>>({});
  const [harvestIncompleteFields, setHarvestIncompleteFields] = useState<Record<string, boolean>>({});
  const [activeTicket, setActiveTicket] = useState<WeighbridgeTicket | null>(null);
  const [closingTare, setClosingTare] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [historyTypeFilter, setHistoryTypeFilter] = useState("all");
  const [workstationMode, setWorkstationMode] = useState<WorkstationMode>("standard");
  const [activeShift, setActiveShift] = useState<any | null>(null);
  const [shiftCounters, setShiftCounters] = useState<{ activeTickets: number; stuckTickets: number; unsynced: number; requiresReview: number; manualCorrections: number }>({
    activeTickets: 0,
    stuckTickets: 0,
    unsynced: 0,
    requiresReview: 0,
    manualCorrections: 0,
  });
  const [processingNodes, setProcessingNodes] = useState<Option[]>([]);
  const [commentOpen, setCommentOpen] = useState(false);
  const [historyPreviewTicket, setHistoryPreviewTicket] = useState<WeighbridgeTicket | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("Подтвердите действие");
  const [confirmDescription, setConfirmDescription] = useState("");
  const [confirmActionLabel, setConfirmActionLabel] = useState("Подтвердить");
  const confirmResolverRef = useRef<null | ((value: boolean) => void)>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);

  const canOperate =
    profile?.role === "company_admin" ||
    profile?.role === "global_admin" ||
    profile?.role === "warehouse" ||
    profile?.role === "weighman";
  const canView = canOperate || profile?.role === "agronomist";
  const canVoid = profile?.role === "company_admin" || profile?.role === "global_admin";
  const persistKey = useMemo(
    () => (profile?.company_id && profile?.id ? `weighbridge:last-form:${profile.company_id}:${profile.id}` : ""),
    [profile?.company_id, profile?.id]
  );

  const loadDrivers = async (companyId: string) => {
    const queryProfiles = async (select: string, withArchivedFilter: boolean) => {
      let query = supabase
        .from("profiles")
        .select(select)
        .eq("company_id", companyId)
        .eq("status", "active")
        .eq("role", "specialist")
        .order("full_name");
      if (withArchivedFilter) query = query.eq("archived", false);
      return query;
    };

    const tryLoad = async (select: string) => {
      const first = await queryProfiles(select, true);
      if (!first.error) return first;
      if (!first.error.message?.toLowerCase().includes("archived")) return first;
      return queryProfiles(select, false);
    };

    const withMachine = await tryLoad("id,full_name,email,machine_id");
    if (!withMachine.error) {
      return (withMachine.data || []).map((r: any) => ({
        id: String(r.id),
        name: String(r.full_name || r.email || "Специалист"),
        machineId: r.machine_id ? String(r.machine_id) : null,
      }));
    }

    if (!withMachine.error.message?.toLowerCase().includes("machine_id")) {
      throw withMachine.error;
    }

    const fallback = await tryLoad("id,full_name,email");
    if (fallback.error) throw fallback.error;

    return (fallback.data || []).map((r: any) => ({
      id: String(r.id),
      name: String(r.full_name || r.email || "Специалист"),
      machineId: null as string | null,
    }));
  };

  const loadDriversV2 = async (companyId: string) => {
    const { data: specialists, error: specialistsError } = await supabase
      .from("reference_specialists")
      .select("id,full_name,personnel_type,status,archived")
      .eq("company_id", companyId)
      .eq("archived", false)
      .eq("status", "active")
      .eq("personnel_type", "driver")
      .order("full_name");
    if (specialistsError) throw specialistsError;

    const { data: assignments, error: assignmentsError } = await supabase
      .from("reference_vehicles")
      .select("id,primary_responsible_personnel_id")
      .eq("company_id", companyId)
      .eq("archived", false)
      .eq("is_active", true);
    if (assignmentsError) throw assignmentsError;

    const byDriver = new Map<string, string[]>();
    (assignments || []).forEach((row: any) => {
      const key = String(row.primary_responsible_personnel_id || "");
      if (!key) return;
      const arr = byDriver.get(key) || [];
      arr.push(String(row.id));
      byDriver.set(key, arr);
    });

    return (specialists || []).map((r: any) => ({
      id: String(r.id),
      name: String(r.full_name || "Водитель"),
      machineId: null as string | null,
      assignedVehicleIds: byDriver.get(String(r.id)) || [],
    }));
  };

  const loadSuppliers = async (companyId: string) => {
    const { data, error } = await supabase
      .from("counterparties")
      .select("id,name,counterparty_type,is_active,archived")
      .eq("company_id", companyId)
      .eq("archived", false)
      .eq("is_active", true)
      .in("counterparty_type", ["supplier", "both"])
      .order("name");
    if (error) {
      const msg = String(error.message || "").toLowerCase();
      if (msg.includes("counterparties") || msg.includes("schema cache")) return [] as Option[];
      throw error;
    }
    return (data || []).map((r: any) => ({ id: String(r.id), name: String(r.name || "Поставщик") }));
  };

  const loadBuyers = async (companyId: string) => {
    const { data, error } = await supabase
      .from("counterparties")
      .select("id,name,counterparty_type,is_active,archived")
      .eq("company_id", companyId)
      .eq("archived", false)
      .eq("is_active", true)
      .in("counterparty_type", ["buyer", "both", "other"])
      .order("name");
    if (error) {
      const msg = String(error.message || "").toLowerCase();
      if (msg.includes("counterparties") || msg.includes("schema cache")) return [] as Option[];
      throw error;
    }
    return (data || []).map((r: any) => ({ id: String(r.id), name: String(r.name || "Контрагент") }));
  };

  const loadMasterIdentityRefs = async (companyId: string, userId: string) => {
    const resp = await fetch(
      `/api/weighbridge/master-identity?companyId=${encodeURIComponent(companyId)}&userId=${encodeURIComponent(userId)}`,
      { cache: "no-store" }
    );
    const json = await resp.json();
    if (!resp.ok) throw new Error(String(json?.error || "Не удалось загрузить культуры, сорта и репродукции"));
    return {
      crops: (json?.crops || []) as any[],
      varieties: (json?.varieties || []) as any[],
      reproductions: (json?.reproductions || []) as any[],
    };
  };

  const load = async () => {
    if (!profile?.company_id || !profile?.id || !canView) return;
    setLoading(true);
    try {
      const [fieldsRes, warehousesRes, vehiclesRes, processingRes, productsRes, identityRefs, supplierRows, buyerRows, driverRows, ticketRows] = await Promise.all([
        supabase.from("fields").select("id,name,area").eq("company_id", profile.company_id).eq("archived", false).order("name"),
        supabase.from("warehouses").select("id,name,name_ru,name_kz,name_en").eq("company_id", profile.company_id).eq("archived", false).order("name"),
        supabase.from("reference_vehicles").select("id,name,custom_name,plate_number,primary_responsible_personnel_id,is_active,archived").eq("company_id", profile.company_id).eq("is_active", true).eq("archived", false).order("name"),
        supabase.from("processing_points").select("id,name").eq("company_id", profile.company_id).eq("archived", false).order("name"),
        supabase
          .from("products")
          .select("id,name,name_ru,name_kz,name_en,company_id,type,product_type")
          .or(`company_id.eq.${profile.company_id},company_id.is.null`)
          .eq("archived", false)
          .order("name"),
        loadMasterIdentityRefs(profile.company_id, profile.id),
        loadSuppliers(profile.company_id),
        loadBuyers(profile.company_id),
        loadDriversV2(profile.company_id),
        listTickets(profile.company_id, profile.id),
      ]);
      if (fieldsRes.error || warehousesRes.error || vehiclesRes.error || processingRes.error || productsRes.error) {
        throw new Error(fieldsRes.error?.message || warehousesRes.error?.message || vehiclesRes.error?.message || processingRes.error?.message || productsRes.error?.message || "Не удалось загрузить данные");
      }
      setFields((fieldsRes.data || []).map((r: any) => ({ id: String(r.id), name: String(r.name || "Поле"), area: Number(r.area || 0) })));
      setWarehouses((warehousesRes.data || []).map((r: any) => ({ id: String(r.id), name: localizedName(r, lang, ["name"]) || String(r.name || "Склад") })));
      setSuppliers(supplierRows);
      setBuyers(buyerRows);
      setVehicles((vehiclesRes.data || []).map((r: any) => ({ id: String(r.id), name: String(r.custom_name || r.name || "Машина"), plate: String(r.plate_number || ""), primaryPersonnelId: r.primary_responsible_personnel_id ? String(r.primary_responsible_personnel_id) : null })));
      setProcessingPoints((processingRes.data || []).map((r: any) => ({ id: String(r.id), name: String(r.name || "Точка") })));
      const dedupeByName = (rows: any[]) => {
        const map = new Map<string, any>();
        rows.forEach((row) => {
          const key = String(row.name || row.name_ru || row.id || "").trim().toLowerCase();
          if (!key) return;
          const existing = map.get(key);
          if (!existing || (existing.company_id == null && row.company_id != null)) {
            map.set(key, row);
          }
        });
        return Array.from(map.values());
      };

      const productRows = dedupeByName(productsRes.data || []);
      const cropRows = dedupeByName(identityRefs.crops || []);
      const varietyRowsRaw = (identityRefs.varieties || []) as any[];
      const reproductionRowsRaw = (identityRefs.reproductions || []) as any[];
      const varietyRows = dedupeByName(varietyRowsRaw);
      const reproductionRows = dedupeByName(reproductionRowsRaw);
      const cropNameById = new Map<string, string>(
        cropRows.map((c: any) => [String(c.id), localizedName(c, lang, ["name"]) || String(c.name || "").trim()])
      );
      const varietyNameById = new Map<string, string>(
        varietyRowsRaw.map((v: any) => [String(v.id), localizedName(v, lang, ["name"]) || String(v.name || "").trim()])
      );
      const reproductionNameById = new Map<string, string>(
        reproductionRowsRaw.map((r: any) => [String(r.id), localizedName(r, lang, ["name"]) || String(r.name || "").trim()])
      );

      setProducts(
        productRows.map((r: any) => ({
          id: String(r.id),
          name: localizedName(r, lang, ["name"]) || String(r.name || "Номенклатура"),
          type: String(r.product_type || r.type || "").toLowerCase(),
        }))
      );
      setCrops(cropRows.map((r: any) => ({ id: String(r.id), name: localizedName(r, lang, ["name"]) || String(r.name || "Культура") })));
      setVarieties(
        varietyRows.map((r: any) => ({
          id: String(r.id),
          name: localizedName(r, lang, ["name"]) || String(r.name || "Сорт"),
          cropId: String(r.crop_id || ""),
          cropName: localizedName(r.crops, lang, ["name"]) || cropNameById.get(String(r.crop_id || "")) || "",
        }))
      );
      setReproductions(
        reproductionRows.map((r: any) => ({
          id: String(r.id),
          name: localizedName(r, lang, ["name"]) || String(r.name || "Репродукция"),
        }))
      );
      setDrivers(driverRows);
      setTickets(ticketRows || []);
      try {
        const bootstrap = await getWeighbridgeBootstrap(profile.company_id, profile.id);
        setActiveShift(bootstrap?.shift || null);
        setShiftCounters(bootstrap?.counters || {
          activeTickets: 0,
          stuckTickets: 0,
          unsynced: 0,
          requiresReview: 0,
          manualCorrections: 0,
        });
        setProcessingNodes(
          (bootstrap?.processingNodes || []).map((x: any) => ({
            id: String(x.id),
            name: String(x.name || "Узел"),
          }))
        );
      } catch {
        setActiveShift(null);
      }

      const { data: seasonsRows, error: seasonError } = await supabase
        .from("seasons")
        .select("id,year,archived")
        .eq("company_id", profile.company_id)
        .eq("archived", false)
        .order("year", { ascending: false });
      if (seasonError) throw seasonError;

      const nowYear = new Date().getFullYear();
      const activeSeason =
        (seasonsRows || []).find((s: any) => Number(s.year) === nowYear) ||
        (seasonsRows || [])[0];

      const byField: Record<string, HarvestStructureOption[]> = {};
      const incompleteByField: Record<string, boolean> = {};
      {
        const resp = await fetch(
          `/api/weighbridge/harvest-allocations?companyId=${encodeURIComponent(profile.company_id)}&userId=${encodeURIComponent(profile.id)}`,
          { cache: "no-store" }
        );
        const json = await resp.json();
        if (!resp.ok) throw new Error(String(json?.error || "Failed to load harvest allocations"));
        Object.assign(byField, (json?.byField || {}) as Record<string, HarvestStructureOption[]>);
        Object.assign(incompleteByField, (json?.incompleteByField || {}) as Record<string, boolean>);
      }
      setHarvestStructureByField(byField);
      setHarvestIncompleteFields(incompleteByField);
    } catch (e: any) {
      toast({ title: "Ошибка", description: e?.message || "Не удалось загрузить весовую", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const refreshTickets = async () => {
    if (!profile?.company_id || !profile?.id) return;
    const rows = await listTickets(profile.company_id, profile.id);
    setTickets(rows || []);
  };

  const siteConfirm = async (opts: { title: string; description: string; actionLabel: string }) => {
    setConfirmTitle(opts.title);
    setConfirmDescription(opts.description);
    setConfirmActionLabel(opts.actionLabel);
    setConfirmOpen(true);
    return new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve;
    });
  };

  const resolveConfirm = (value: boolean) => {
    if (confirmBusy) return;
    const resolver = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmOpen(false);
    resolver?.(value);
  };

  useEffect(() => {
    void load();
  }, [profile?.company_id, profile?.id, profile?.role, language]);

  useEffect(() => {
    if (!persistKey) return;
    try {
      const raw = localStorage.getItem(persistKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<FormState>;
      const safe: Partial<FormState> = {};
      for (const key of PERSIST_KEYS) {
        const val = parsed[key];
        if (typeof val === "string" && val.trim().length > 0) safe[key] = val as any;
      }
      setForm((prev) => ({ ...prev, ...safe }));
    } catch {
      // ignore broken local snapshot
    }
  }, [persistKey]);

  useEffect(() => {
    if (!persistKey) return;
    const modeRaw = localStorage.getItem(`${persistKey}:mode`);
    if (modeRaw === "standard" || modeRaw === "peak_harvest" || modeRaw === "night_minimal") {
      setWorkstationMode(modeRaw);
    }
  }, [persistKey]);

  useEffect(() => {
    if (!persistKey) return;
    const payload = {
      operationType: form.operationType,
      fieldId: form.fieldId,
      warehouseToId: form.warehouseToId,
      cropId: form.cropId,
      varietyId: form.varietyId,
      reproductionId: form.reproductionId,
    } satisfies Partial<FormState>;
    localStorage.setItem(persistKey, JSON.stringify(payload));
  }, [persistKey, form.operationType, form.fieldId, form.warehouseToId, form.cropId, form.varietyId, form.reproductionId]);

  useEffect(() => {
    if (!persistKey) return;
    localStorage.setItem(`${persistKey}:mode`, workstationMode);
  }, [persistKey, workstationMode]);

  useEffect(() => {
    const needsStockIdentity =
      form.operationType === "transfer_between_warehouses" ||
      form.operationType === "issue_to_field" ||
      form.operationType === "shipment_outbound" ||
      form.operationType === "disposal_writeoff";
    if (!profile?.company_id || !profile?.id || !needsStockIdentity || !form.warehouseFromId) {
      setStockIdentityOptions([]);
      if (needsStockIdentity && form.stockIdentityKey) {
        setForm((prev) => ({ ...prev, stockIdentityKey: "", productId: "", varietyId: "", reproductionId: "" }));
      }
      return;
    }

    let cancelled = false;
    setStockIdentityLoading(true);
    fetch(`/api/weighbridge/stock-identities?companyId=${encodeURIComponent(profile.company_id)}&userId=${encodeURIComponent(profile.id)}&warehouseId=${encodeURIComponent(form.warehouseFromId)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || "Не удалось загрузить остатки склада");
        return (payload.items || []) as StockIdentityOption[];
      })
      .then((items) => {
        if (cancelled) return;
        setStockIdentityOptions(items);
        setForm((prev) => {
          if (!prev.stockIdentityKey || items.some((item) => item.key === prev.stockIdentityKey)) return prev;
          return { ...prev, stockIdentityKey: "", productId: "", varietyId: "", reproductionId: "" };
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setStockIdentityOptions([]);
        toast({ title: "Ошибка остатков", description: error?.message || "Не удалось загрузить остатки склада", variant: "destructive" });
      })
      .finally(() => {
        if (!cancelled) setStockIdentityLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [form.operationType, form.warehouseFromId, form.stockIdentityKey, profile?.company_id, profile?.id, toast]);

  useEffect(() => {
    if (!activeTicket) return;
    setClosingTare(activeTicket.tare_weight_kg != null ? String(activeTicket.tare_weight_kg) : "");
    setVoidReason("");
  }, [activeTicket?.id]);

  useEffect(() => {
    if (!form.driverId) return;
    const driver = drivers.find((d) => d.id === form.driverId);
    if (!driver) return;
    const assigned = driver.assignedVehicleIds.filter((id) => vehicles.some((v) => v.id === id));
    if (!assigned.length) return;
    // Driver is primary in this interaction:
    // if driver's assigned list does not include current vehicle, switch to driver's default vehicle.
    if (!form.vehicleId || !assigned.includes(form.vehicleId)) {
      setForm((prev) => ({ ...prev, vehicleId: assigned[0] || prev.vehicleId }));
    }
  }, [form.driverId, form.vehicleId, drivers, vehicles]);

  useEffect(() => {
    if (!form.vehicleId) return;
    const linkedDrivers = drivers.filter((d) => d.assignedVehicleIds.includes(form.vehicleId));
    if (!linkedDrivers.length) return;
    // Soft autofill only: set default driver only when none is selected.
    if (!form.driverId) {
      setForm((prev) => ({ ...prev, driverId: linkedDrivers[0].id }));
    }
  }, [form.vehicleId, form.driverId, drivers]);

  const fieldHarvestOptions = useMemo(
    () =>
      (form.fieldId ? harvestStructureByField[form.fieldId] || [] : []).slice().sort((a, b) => {
        if (a.isIncomplete === b.isIncomplete) return 0;
        return a.isIncomplete ? 1 : -1;
      }),
    [harvestStructureByField, form.fieldId]
  );
  const selectedHarvestAllocation = useMemo(
    () => fieldHarvestOptions.find((x) => x.allocationId === form.cropStructureAllocationId) || null,
    [fieldHarvestOptions, form.cropStructureAllocationId]
  );
  const selectedCropName = useMemo(
    () => crops.find((c) => c.id === form.cropId)?.name || "",
    [crops, form.cropId]
  );
  const supplierVarietyOptions = useMemo(() => {
    if (!form.cropId) return [];
    const selectedNorm = normName(selectedCropName);
    return varieties.filter((v) => {
      if (v.cropId === form.cropId) return true;
      if (!selectedNorm) return false;
      return normName(v.cropName) === selectedNorm;
    });
  }, [varieties, form.cropId, selectedCropName]);

  useEffect(() => {
    if (form.operationType !== "supplier_receipt" || form.supplierItemMode !== "agro_identity") return;
    if (!form.varietyId) return;
    if (!supplierVarietyOptions.some((v) => v.id === form.varietyId)) {
      setForm((prev) => ({ ...prev, varietyId: "" }));
    }
  }, [form.operationType, form.supplierItemMode, form.varietyId, supplierVarietyOptions]);

  useEffect(() => {
    if (form.operationType !== "harvest_incoming" && form.operationType !== "issue_to_field") return;
    if (!form.fieldId) {
      setForm((prev) => ({ ...prev, cropStructureAllocationId: "", cropId: "", varietyId: "", reproductionId: "" }));
      return;
    }
    if (!fieldHarvestOptions.length) {
      setForm((prev) => ({ ...prev, cropStructureAllocationId: "", cropId: "", varietyId: "", reproductionId: "" }));
      return;
    }
    const exists = fieldHarvestOptions.some((x) => x.allocationId === form.cropStructureAllocationId);
    if (!exists && form.operationType === "issue_to_field" && fieldHarvestOptions.length > 1) {
      setForm((prev) => ({ ...prev, cropStructureAllocationId: "", cropId: "", varietyId: "", reproductionId: "" }));
      return;
    }
    if (!exists) {
      const first = fieldHarvestOptions.find((x) => !x.isIncomplete) || fieldHarvestOptions[0];
      setForm((prev) => ({
        ...prev,
        cropStructureAllocationId: first.allocationId,
        cropId: first.cropId,
        varietyId: first.varietyId,
        reproductionId: first.reproductionId,
      }));
    }
  }, [form.operationType, form.fieldId, fieldHarvestOptions, form.cropStructureAllocationId]);

  useEffect(() => {
    if (form.operationType !== "harvest_incoming" && form.operationType !== "issue_to_field") return;
    if (!selectedHarvestAllocation) return;
    if (
      form.cropId !== selectedHarvestAllocation.cropId ||
      form.varietyId !== selectedHarvestAllocation.varietyId ||
      form.reproductionId !== selectedHarvestAllocation.reproductionId
    ) {
      setForm((prev) => ({
        ...prev,
        cropId: selectedHarvestAllocation.cropId,
        varietyId: selectedHarvestAllocation.varietyId,
        reproductionId: selectedHarvestAllocation.reproductionId,
      }));
    }
  }, [form.operationType, selectedHarvestAllocation, form.cropId, form.varietyId, form.reproductionId]);

  const activeTickets = useMemo(() => tickets.filter((t) => ["draft", "active", "ready_to_close"].includes(t.status)), [tickets]);
  const historyTypes = useMemo(() => Array.from(new Set(tickets.map((t) => t.op_type).filter(Boolean))), [tickets]);
  const historyTickets = useMemo(() => tickets.filter((t) => ["finalized", "voided"].includes(t.status) && (historyTypeFilter === "all" || t.op_type === historyTypeFilter)), [tickets, historyTypeFilter]);
  const selectedTransferStock = useMemo(
    () => stockIdentityOptions.find((item) => item.key === form.stockIdentityKey) || null,
    [stockIdentityOptions, form.stockIdentityKey]
  );
  const fieldIssueStockOptions = useMemo(() => {
    const filtered = stockIdentityOptions.filter((item) => materialMatchesOperation(item, form.fieldMaterialCategory));
    if (!isSeedIssueOperation(form.fieldMaterialCategory) || !selectedHarvestAllocation) return filtered;
    return [...filtered].sort((a, b) => {
      const aMatch =
        a.product_name.toLowerCase().includes(selectedHarvestAllocation.cropName.toLowerCase()) &&
        a.variety_id === selectedHarvestAllocation.varietyId &&
        a.reproduction_id === selectedHarvestAllocation.reproductionId;
      const bMatch =
        b.product_name.toLowerCase().includes(selectedHarvestAllocation.cropName.toLowerCase()) &&
        b.variety_id === selectedHarvestAllocation.varietyId &&
        b.reproduction_id === selectedHarvestAllocation.reproductionId;
      return Number(bMatch) - Number(aMatch);
    });
  }, [stockIdentityOptions, form.fieldMaterialCategory, selectedHarvestAllocation]);
  const selectableDrivers = useMemo(() => {
    if (!form.vehicleId) return drivers;
    const linked = drivers.filter((d) => d.assignedVehicleIds.includes(form.vehicleId));
    const rest = drivers.filter((d) => !d.assignedVehicleIds.includes(form.vehicleId));
    return linked.length ? [...linked, ...rest] : drivers;
  }, [drivers, form.vehicleId]);
  const gross = activeTicket?.gross_weight_kg != null ? String(activeTicket.gross_weight_kg) : "";
  const pure = net(gross, closingTare);
  const liveWeightKg = useMemo(() => {
    if (form.grossKg && Number.isFinite(Number(form.grossKg))) return Number(form.grossKg);
    if (gross && Number.isFinite(Number(gross))) return Number(gross);
    return 0;
  }, [form.grossKg, gross]);
  const nextActionLabel = activeTicket
    ? ticketStageLabel(activeTicket)
    : form.grossKg
      ? "Ждёт тару"
      : "Ждёт брутто";
  const selectedMovementGroup = movementGroupForOperation(form.operationType);
  const selectedSubtypes = GROUP_SUBTYPES[selectedMovementGroup];
  const isFieldIssue = form.operationType === "issue_to_field";
  const isTransfer = form.operationType === "transfer_between_warehouses";
  const isShipment = form.operationType === "shipment_outbound";
  const isDisposal = form.operationType === "disposal_writeoff";
  const isSupplierDirect = form.operationType === "supplier_receipt" && form.supplierReceiptMode === "direct";
  const isTransferDirect = isTransfer && form.transferMode === "direct";
  const isFieldIssueDirect = isFieldIssue && form.fieldIssueMode === "direct";
  const isWeighbridgeForm =
    form.operationType === "harvest_incoming" ||
    (form.operationType === "supplier_receipt" && form.supplierReceiptMode === "weighbridge") ||
    (isTransfer && form.transferMode === "weighbridge") ||
    (isFieldIssue && form.fieldIssueMode === "weighbridge") ||
    isShipment ||
    isDisposal;

  const selectOperation = (operationType: OperationType) => {
    setForm((prev) => ({
      ...INITIAL_FORM,
      operationType,
      warehouseToId:
        operationType === "harvest_incoming" || operationType === "supplier_receipt" || operationType === "transfer_between_warehouses"
          ? prev.warehouseToId
          : "",
      warehouseFromId:
        operationType === "issue_to_field" || operationType === "transfer_between_warehouses" || operationType === "shipment_outbound" || operationType === "disposal_writeoff"
          ? prev.warehouseFromId
          : "",
      fieldId: operationType === "harvest_incoming" || operationType === "issue_to_field" ? prev.fieldId : "",
    }));
  };

  const validate = () => {
    if (!profile?.company_id || !profile?.id) return "Нет профиля пользователя";
    if (form.operationType === "harvest_incoming") {
      if (!form.driverId) return "Выберите водителя";
      if (!form.vehicleId) return "Выберите машину";
      if (form.fieldId && harvestIncompleteFields[form.fieldId]) return "В структуре поля отсутствует сорт или репродукция";
      if (!form.fieldId || !form.warehouseToId || !form.cropStructureAllocationId || !form.cropId || !form.varietyId || !form.reproductionId) {
        return "Заполните поле, склад, культуру, сорт и репродукцию";
      }
      if (!fieldHarvestOptions.some((x) => x.allocationId === form.cropStructureAllocationId)) {
        return "Выбранная посевная строка не связана с этим полем";
      }
      if (!toNum(form.grossKg) || Number(form.grossKg) <= 0) return "Укажите брутто";
    } else if (form.operationType === "supplier_receipt") {
      if (!form.supplierId) return "Выберите контрагента";
      if (!form.warehouseToId) return "Выберите склад назначения";
      if (form.supplierReceiptMode === "weighbridge") {
        if (!form.driverId) return "Выберите водителя";
        if (!form.vehicleId) return "Выберите машину";
        if (!toNum(form.grossKg) || Number(form.grossKg) <= 0) return "Укажите брутто";
      } else if (!toNum(form.quantityKg) || Number(form.quantityKg) <= 0) {
        return "Укажите количество по накладной";
      }
      if (form.supplierItemMode === "generic" && !form.productId) return "Выберите номенклатуру";
      if (form.supplierItemMode === "agro_identity") {
        if (!form.cropId || !form.varietyId || !form.reproductionId) return "Для семян/агро укажите культуру, сорт и репродукцию";
        if (!form.supplierLot.trim()) return "Укажите партию поставщика";
      }
    } else if (form.operationType === "issue_to_field") {
      if (form.fieldId && fieldHarvestOptions.length > 1 && !form.cropStructureAllocationId) return "Выберите посевную строку поля";
      if (form.fieldId && !selectedHarvestAllocation) return "Для выдачи в поле нужна посевная строка активного сезона";
      if (!form.warehouseFromId) return "Выберите склад-источник";
      if (!form.fieldId) return "Выберите поле";
      if (!form.fieldMaterialCategory) return "Выберите категорию материала";
      if (!form.stockIdentityKey || !selectedTransferStock) return "Выберите материал из остатков склада";
      if (form.fieldIssueMode === "weighbridge") {
        if (!form.driverId) return "Выберите водителя";
        if (!form.vehicleId) return "Выберите машину";
        if (!toNum(form.grossKg) || Number(form.grossKg) <= 0) return "Укажите брутто";
      } else {
        const qty = toNum(form.quantityKg);
        if (!qty || qty <= 0) return "Укажите количество выдачи";
        if (qty > Number(selectedTransferStock.quantity || 0)) return "Количество больше доступного остатка";
      }
      if (isSeedIssueOperation(form.fieldMaterialCategory)) {
        if (!selectedHarvestAllocation) return "Для семян нужна структура посевов выбранного поля";
        if (!selectedTransferStock.variety_id || !selectedTransferStock.reproduction_id) {
          return "Для семян выберите партию с сортом и репродукцией";
        }
        const cropMatches = selectedTransferStock.product_name
          .toLowerCase()
          .includes(selectedHarvestAllocation.cropName.toLowerCase());
        if (
          !cropMatches ||
          selectedTransferStock.variety_id !== selectedHarvestAllocation.varietyId ||
          selectedTransferStock.reproduction_id !== selectedHarvestAllocation.reproductionId
        ) {
          return "Семенная партия не соответствует культуре, сорту или репродукции поля";
        }
      }
    } else if (form.operationType === "transfer_between_warehouses") {
      if (!form.warehouseFromId || !form.warehouseToId) return "Выберите склад-источник и склад назначения";
      if (form.warehouseFromId === form.warehouseToId) return "Склады не должны совпадать";
      if (!form.stockIdentityKey || !selectedTransferStock) return "Выберите остаток из склада-источника";
      if (form.transferMode === "weighbridge") {
        if (!form.driverId) return "Выберите водителя";
        if (!form.vehicleId) return "Выберите машину";
        if (!toNum(form.grossKg) || Number(form.grossKg) <= 0) return "Укажите брутто";
      } else {
        const qty = toNum(form.quantityKg);
        if (!qty || qty <= 0) return "Укажите количество перемещения";
        if (qty > Number(selectedTransferStock.quantity || 0)) return "Количество больше доступного остатка";
      }
    } else if (form.operationType === "shipment_outbound") {
      if (!form.warehouseFromId) return "Выберите склад-источник";
      if (!form.stockIdentityKey || !selectedTransferStock) return "Выберите остаток для отгрузки";
      if (!form.buyerId) return "Выберите контрагента";
      if (!form.driverId) return "Выберите водителя";
      if (!form.vehicleId) return "Выберите машину";
      if (!toNum(form.grossKg) || Number(form.grossKg) <= 0) return "Укажите брутто";
    } else if (form.operationType === "disposal_writeoff") {
      if (!form.warehouseFromId) return "Выберите склад-источник";
      if (!form.stockIdentityKey || !selectedTransferStock) return "Выберите остаток для списания";
      if (!form.disposalReason.trim()) return "Укажите причину списания";
      if (!form.driverId) return "Выберите водителя";
      if (!form.vehicleId) return "Выберите машину";
      if (!toNum(form.grossKg) || Number(form.grossKg) <= 0) return "Укажите вес";
    } else if (form.operationType === "drying") {
      if (!form.warehouseFromId || !form.warehouseToId || !form.processingPointId || !toNum(form.dryingOutputKg)) return "Для сушки заполните все обязательные поля";
    }
    return null;
  };

  const legacyValidate = () => {
    if (!profile?.company_id || !profile?.id) return "Нет профиля пользователя";
    if (form.operationType === "harvest_incoming") {
      if (!form.driverId) return "Выберите водителя";
      if (!form.vehicleId) return "Выберите машину";
      if (form.fieldId && harvestIncompleteFields[form.fieldId]) return "В структуре поля отсутствует сорт/репродукция";
      if (!form.fieldId || !form.warehouseToId || !form.cropStructureAllocationId || !form.cropId || !form.varietyId || !form.reproductionId) {
        return "Заполните поле, склад, культуру, сорт и репродукцию";
      }
      const hasLinkedCombo = fieldHarvestOptions.some((x) => x.allocationId === form.cropStructureAllocationId);
      if (!hasLinkedCombo) return "Выбранные культура/сорт/репродукция не связаны с полем в структуре посева";
      if (!toNum(form.grossKg) || Number(form.grossKg) <= 0) return "Укажите брутто";
    } else if (form.operationType === "supplier_receipt") {
      if (!form.supplierId) return "Выберите поставщика";
      if (!form.warehouseToId) return "Выберите склад назначения";
      if (form.supplierReceiptMode === "weighbridge") {
        if (!form.driverId) return "Выберите водителя";
        if (!form.vehicleId) return "Выберите машину";
        if (!toNum(form.grossKg) || Number(form.grossKg) <= 0) return "Укажите брутто";
      } else if (!toNum(form.quantityKg) || Number(form.quantityKg) <= 0) {
        return "Укажите количество по накладной";
      }
      if (form.supplierItemMode === "generic" && !form.productId) return "Выберите номенклатуру";
      if (form.supplierItemMode === "agro_identity") {
        if (!form.cropId || !form.varietyId || !form.reproductionId) return "Для агро-продукции укажите культуру, сорт и репродукцию";
        if (!form.supplierLot.trim()) return "Укажите партию поставщика";
      }
    } else if (form.operationType === "issue_to_field") {
      if (form.fieldId && fieldHarvestOptions.length > 1 && !form.cropStructureAllocationId) return "Выберите посевную строку поля";
      if (form.fieldId && !selectedHarvestAllocation) return "Для отпуска в поле нужна посевная строка активного сезона";
      if (!form.warehouseFromId) return "Выберите склад-источник";
      if (!form.fieldId) return "Выберите поле";
      if (!form.fieldMaterialCategory) return "Выберите категорию материала";
      if (!form.stockIdentityKey || !selectedTransferStock) return "Выберите материал из остатков склада";
      if (form.fieldIssueMode === "weighbridge") {
        if (!form.driverId) return "Выберите водителя";
        if (!form.vehicleId) return "Выберите машину";
        if (!toNum(form.grossKg) || Number(form.grossKg) <= 0) return "Укажите брутто";
      } else {
        const qty = toNum(form.quantityKg);
        if (!qty || qty <= 0) return "Укажите количество отпуска в поле";
        if (qty > Number(selectedTransferStock.quantity || 0)) return "Количество больше доступного остатка";
      }
      if (isSeedIssueOperation(form.fieldMaterialCategory)) {
        if (!selectedHarvestAllocation) return "Для посева нужна структура посевов выбранного поля";
        if (!selectedTransferStock.variety_id || !selectedTransferStock.reproduction_id) {
          return "Для посева выберите семенную партию с сортом и репродукцией";
        }
        const cropMatches = selectedTransferStock.product_name
          .toLowerCase()
          .includes(selectedHarvestAllocation.cropName.toLowerCase());
        if (
          !cropMatches ||
          selectedTransferStock.variety_id !== selectedHarvestAllocation.varietyId ||
          selectedTransferStock.reproduction_id !== selectedHarvestAllocation.reproductionId
        ) {
          return "Семенная партия не соответствует культуре, сорту или репродукции поля";
        }
      }
      return null;
    } else if (form.operationType === "transfer_between_warehouses") {
      if (!form.warehouseFromId || !form.warehouseToId) return "Выберите склад-источник и склад назначения";
      if (form.warehouseFromId === form.warehouseToId) return "Склад-источник и склад назначения не должны совпадать";
      if (!form.stockIdentityKey || !selectedTransferStock) return "Выберите остаток из склада-источника";
      if (form.transferMode === "weighbridge") {
        if (!form.driverId) return "Выберите водителя";
        if (!form.vehicleId) return "Выберите машину";
        if (!toNum(form.grossKg) || Number(form.grossKg) <= 0) return "Укажите брутто";
      } else {
        const qty = toNum(form.quantityKg);
        if (!qty || qty <= 0) return "Укажите количество перемещения";
        if (qty > Number(selectedTransferStock.quantity || 0)) return "Количество больше доступного остатка";
      }
    } else {
      if (!form.driverId) return "Выберите водителя";
      if (!form.vehicleId) return "Выберите машину";
      if (!form.productId || !toNum(form.quantityKg) || Number(form.quantityKg) <= 0) return "Заполните номенклатуру и количество";
    }
    if (form.operationType === "disposal_writeoff" && (!form.warehouseFromId || !form.disposalReason.trim())) return "Для списания укажите склад и причину";
    if (form.operationType === "drying" && (!form.warehouseFromId || !form.warehouseToId || !form.processingPointId || !toNum(form.dryingOutputKg))) return "Для сушки заполните все обязательные поля";
    return null;
  };

  const create = async () => {
    if (!canOperate || submitting) return;
    if (loading) {
      toast({
        title: "Данные ещё загружаются",
        description: "Подождите пару секунд и повторите создание талона.",
        variant: "destructive",
      });
      return;
    }
    if (!activeShift) {
      toast({
        title: "Смена не открыта",
        description: "Перед созданием талона откройте смену в верхней панели.",
        variant: "destructive",
      });
      return;
    }
    const validationError = validate();
    if (validationError) {
      toast({ title: "Проверьте форму", description: validationError, variant: "destructive" });
      return;
    }
    if (!(await siteConfirm({ title: "Создать талон", description: "Проверьте данные и подтвердите создание талона.", actionLabel: "Создать" }))) return;
    if (!profile?.company_id || !profile?.id) return;

    const meta = opMeta(form.operationType);
    const cropName = crops.find((c) => c.id === form.cropId)?.name || "";
    const cropNorm = normName(cropName);
    const harvestProduct =
      products.find(
        (p) =>
          ["produce", "crop", "harvest"].includes(String(p.type || "").toLowerCase()) &&
          (normName(p.name) === cropNorm ||
            normName(p.name).includes(cropNorm) ||
            cropNorm.includes(normName(p.name)))
      ) ||
      products.find((p) => normName(p.name) === cropNorm) ||
      products.find((p) => normName(p.name).includes(cropNorm) || cropNorm.includes(normName(p.name))) ||
      products.find((p) => ["produce", "crop", "harvest"].includes(String(p.type || "").toLowerCase()));
    const isFieldIssue = form.operationType === "issue_to_field";
    const isShipment = form.operationType === "shipment_outbound";
    const isDisposal = form.operationType === "disposal_writeoff";
    const productId =
      form.operationType === "harvest_incoming" || (form.operationType === "supplier_receipt" && form.supplierItemMode === "agro_identity")
        ? harvestProduct?.id
        : form.operationType === "transfer_between_warehouses" || isFieldIssue || isShipment || isDisposal
          ? selectedTransferStock?.product_id
        : form.productId;
    if (!productId) {
      toast({
        title: "Ошибка",
        description: form.operationType === "transfer_between_warehouses" || isDisposal ? "Выберите остаток из склада-источника." : "Для этой культуры не найдена складская номенклатура. Проверьте справочник номенклатуры.",
        variant: "destructive",
      });
      return;
    }
    const isSupplierDirect = form.operationType === "supplier_receipt" && form.supplierReceiptMode === "direct";
    const isTransfer = form.operationType === "transfer_between_warehouses";
    const isTransferDirect = isTransfer && form.transferMode === "direct";
    const isFieldIssueDirect = isFieldIssue && form.fieldIssueMode === "direct";
    const isFieldIssueWeighbridge = isFieldIssue && form.fieldIssueMode === "weighbridge";
    const isDirectQuantity = isSupplierDirect || isTransferDirect || isFieldIssueDirect;
    const movementQuantity =
      form.operationType === "harvest_incoming" || (form.operationType === "supplier_receipt" && form.supplierReceiptMode === "weighbridge") || (isTransfer && form.transferMode === "weighbridge") || isFieldIssueWeighbridge || isShipment
        || isDisposal
        ? Number(form.grossKg)
        : Number(form.quantityKg);
    const supplierNotes = [
      form.operationType === "supplier_receipt" && form.supplierDocumentNo.trim() ? `Документ поставщика: ${form.supplierDocumentNo.trim()}` : "",
      form.operationType === "supplier_receipt" && form.supplierLot.trim() ? `Партия поставщика: ${form.supplierLot.trim()}` : "",
      form.operationType === "supplier_receipt" && form.harvestYear.trim() ? `Год урожая: ${form.harvestYear.trim()}` : "",
    ].filter(Boolean);

    const ticket: TicketInput = {
      company_id: profile.company_id,
      created_by: profile.id,
      ticket_type: meta.ticketType,
      op_type: meta.opType,
      direction: meta.direction,
      source_kind: meta.sourceKind,
      destination_kind: meta.destinationKind,
      source_id: form.operationType === "harvest_incoming" ? form.fieldId : form.operationType === "supplier_receipt" ? form.supplierId : form.warehouseFromId || null,
      destination_id: form.operationType === "harvest_incoming" ? form.warehouseToId : form.operationType === "issue_to_field" ? form.fieldId : form.operationType === "shipment_outbound" ? form.buyerId : form.operationType === "drying" ? form.processingPointId : form.warehouseToId || null,
      crop_structure_allocation_id: form.operationType === "harvest_incoming" || isFieldIssue ? form.cropStructureAllocationId || null : null,
      supplier_id: form.operationType === "supplier_receipt" ? form.supplierId || null : null,
      buyer_id: form.operationType === "shipment_outbound" ? form.buyerId || null : null,
      shipment_purpose: form.operationType === "shipment_outbound" ? form.shipmentPurpose : null,
      destination_text: form.operationType === "shipment_outbound" ? form.destinationText.trim() || null : null,
      external_document_no: form.operationType === "shipment_outbound" ? form.externalDocumentNo.trim() || null : null,
      supplier_document_no: form.operationType === "supplier_receipt" ? form.supplierDocumentNo.trim() || null : null,
      receipt_mode: form.operationType === "supplier_receipt" ? form.supplierReceiptMode : null,
      supplier_receipt_kind: form.operationType === "supplier_receipt" ? form.supplierItemMode : null,
      field_operation_type: isFieldIssue ? "issued_to_field" : null,
      field_material_category: isFieldIssue ? form.fieldMaterialCategory : null,
      disposal_category: form.operationType === "disposal_writeoff" ? form.disposalCategory : null,
      field_id: form.operationType === "supplier_receipt" ? null : form.fieldId || null,
      warehouse_from_id: form.operationType === "supplier_receipt" ? null : form.warehouseFromId || null,
      warehouse_to_id: form.warehouseToId || null,
      processing_point_from_id: form.operationType === "drying" ? form.processingPointId || null : null,
      vehicle_id: form.vehicleId || null,
      driver_id: form.driverId || null,
      gross_weight_kg: isDirectQuantity ? movementQuantity : toNum(form.grossKg),
      tare_weight_kg: isDirectQuantity ? 0 : null,
      weigh_method: isDirectQuantity ? "manual_override_with_reason" : "preset_tare",
      notes: [
        form.operationType === "shipment_outbound" && form.externalDocumentNo.trim() ? `Документ отгрузки: ${form.externalDocumentNo.trim()}` : "",
        form.operationType === "shipment_outbound" ? `Цель отгрузки: ${shipmentPurposeLabels[form.shipmentPurpose]}` : "",
        form.operationType === "disposal_writeoff" && form.disposalReason.trim() ? `Причина списания: ${form.disposalReason.trim()}` : "",
        ...supplierNotes,
        form.notes.trim(),
      ].filter(Boolean).join("\n") || null,
    };

    const line: TicketLineInput = {
      product_id: productId,
      crop_id: form.operationType === "harvest_incoming" || (form.operationType === "supplier_receipt" && form.supplierItemMode === "agro_identity") || (isFieldIssue && isSeedIssueOperation(form.fieldMaterialCategory)) ? form.cropId : null,
      quantity: movementQuantity,
      uom: "kg",
      notes: form.operationType === "harvest_incoming" ? "Приемка урожая" : form.operationType === "supplier_receipt" ? "Приемка от поставщика" : form.operationType === "transfer_between_warehouses" ? "Межскладское перемещение" : undefined,
      lot_id: form.operationType === "supplier_receipt" ? form.supplierLot.trim() || null : (form.operationType === "transfer_between_warehouses" || isFieldIssue || isShipment || isDisposal) ? selectedTransferStock?.batch_id || null : null,
      supplier_lot: form.operationType === "supplier_receipt" ? form.supplierLot.trim() || null : null,
      batch_id: (form.operationType === "transfer_between_warehouses" || isFieldIssue || isShipment || isDisposal) && isUuidLike(selectedTransferStock?.batch_id) ? selectedTransferStock?.batch_id || null : null,
      batch_class: form.operationType === "transfer_between_warehouses" || isFieldIssue || isShipment || isDisposal ? selectedTransferStock?.batch_class || "commodity" : null,
      variety_id: form.operationType === "transfer_between_warehouses" || isFieldIssue || isShipment || isDisposal ? selectedTransferStock?.variety_id || null : form.operationType === "harvest_incoming" || (form.operationType === "supplier_receipt" && form.supplierItemMode === "agro_identity") ? form.varietyId || null : null,
      reproduction_id: form.operationType === "transfer_between_warehouses" || isFieldIssue || isShipment || isDisposal ? selectedTransferStock?.reproduction_id || null : form.operationType === "harvest_incoming" || (form.operationType === "supplier_receipt" && form.supplierItemMode === "agro_identity") ? form.reproductionId || null : null,
      moisture_percent: form.operationType === "drying" ? toNum(form.moistureIn) : null,
      net_line_weight_kg: form.operationType === "drying" ? toNum(form.dryingOutputKg) : null,
    };

    setSubmitting(true);
    try {
      await createTicket(ticket, [line], []);
      toast({ title: "Талон создан", description: "Талон добавлен в активные" });
      setForm((prev) => ({
        ...INITIAL_FORM,
        operationType: prev.operationType,
        fieldId: prev.fieldId,
        warehouseFromId: prev.warehouseFromId,
        warehouseToId: prev.warehouseToId,
        cropId: prev.cropId,
        varietyId: prev.varietyId,
        reproductionId: prev.reproductionId,
        supplierId: prev.supplierId,
        buyerId: prev.buyerId,
        supplierDocumentNo: prev.supplierDocumentNo,
        shipmentPurpose: prev.shipmentPurpose,
        supplierReceiptMode: prev.supplierReceiptMode,
        supplierItemMode: prev.supplierItemMode,
        transferMode: prev.transferMode,
        fieldIssueMode: prev.fieldIssueMode,
        fieldMaterialCategory: prev.fieldMaterialCategory,
      }));
      await refreshTickets();
    } catch (e: any) {
      toast({ title: "Ошибка создания", description: e?.message || "Не удалось создать талон", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const closeTicket = async () => {
    if (!activeTicket || !profile?.id || !canOperate || finalizing) return;
    const isDirectSupplierTicket = activeTicket.op_type === "supplier_receipt" && String((activeTicket as any).receipt_mode || "") === "direct";
    const isDirectTransferTicket = activeTicket.op_type === "warehouse_transfer" && activeTicket.weigh_method === "manual_override_with_reason";
    const isDirectFieldIssueTicket = activeTicket.op_type === "issue_to_field" && activeTicket.weigh_method === "manual_override_with_reason";
    const isDirectQuantityTicket = isDirectSupplierTicket || isDirectTransferTicket || isDirectFieldIssueTicket;
    const g = Number(activeTicket.gross_weight_kg || 0);
    const t = isDirectQuantityTicket ? 0 : Number(closingTare || 0);
    if (!Number.isFinite(g) || g <= 0) return toast({ title: "Ошибка", description: "Брутто не заполнено", variant: "destructive" });
    if (!isDirectQuantityTicket && (!Number.isFinite(t) || t <= 0)) return toast({ title: "Ошибка", description: "Укажите тару", variant: "destructive" });
    if (t > g) return toast({ title: "Ошибка", description: "Тара больше брутто", variant: "destructive" });
    if (!(await siteConfirm({ title: "Закрыть талон", description: "После закрытия будет создано движение по складу.", actionLabel: "Закрыть" }))) return;

    setFinalizing(true);
    try {
      await patchTicket(activeTicket.id, profile.id, { tare_weight_kg: isDirectQuantityTicket ? 0 : toNum(closingTare) ?? undefined, status: "ready_to_close" });
      await finalizeTicket(activeTicket.id, profile.id);
      toast({ title: "Талон закрыт", description: "Движение зафиксировано" });
      setActiveTicket(null);
      await refreshTickets();
    } catch (e: any) {
      const message = String(e?.message || "");
      if (message.toLowerCase().includes("read-only") || message.toLowerCase().includes("already finalized")) {
        try {
          await finalizeTicket(activeTicket.id, profile.id);
        } catch {
          // If the ticket is already finalized, refresh is still the safest UI state.
        }
        toast({ title: "Талон уже закрыт", description: "Обновляю список талонов и остатки.", variant: "default" });
        setActiveTicket(null);
        await refreshTickets();
        return;
      }
      toast({ title: "Ошибка закрытия", description: e?.message || "Не удалось закрыть талон", variant: "destructive" });
    } finally {
      setFinalizing(false);
    }
  };

  const handleVoid = async () => {
    if (!activeTicket || !profile?.id || !canVoid || voiding) return;
    if (!voidReason.trim()) return toast({ title: "Ошибка", description: "Укажите причину аннулирования", variant: "destructive" });
    if (!window.confirm("Аннулировать талон через storno?")) return;
    setVoiding(true);
    try {
      await voidTicket(activeTicket.id, profile.id, voidReason.trim());
      toast({ title: "Талон аннулирован", description: "Отмена выполнена через storno" });
      setActiveTicket(null);
      await refreshTickets();
    } catch (e: any) {
      toast({ title: "Ошибка", description: e?.message || "Не удалось аннулировать талон", variant: "destructive" });
    } finally {
      setVoiding(false);
    }
  };

  const handleAdminCleanup = async (action: "void" | "archive" | "force_close") => {
    if (!activeTicket || !profile?.id || !canVoid) return;
    const titleMap: Record<string, string> = {
      void: "Отменить зависший талон",
      archive: "Архивировать зависший талон",
      force_close: "Принудительно закрыть талон",
    };
    const reason = window.prompt(
      `${titleMap[action]}\nУкажите причину (обязательно):`,
      "admin cleanup"
    );
    if (!reason || !reason.trim()) return;
    if (!window.confirm(`${titleMap[action]}?`)) return;
    try {
      await adminTicketAction(activeTicket.id, profile.id, action, reason.trim());
      toast({ title: "Выполнено", description: "Админ-действие применено успешно" });
      setActiveTicket(null);
      await load();
    } catch (e: any) {
      toast({
        title: "Ошибка admin cleanup",
        description: e?.message || "Не удалось применить админ-действие",
        variant: "destructive",
      });
    }
  };

  if (!canView) return <PageHeader title="Весовая и движения" description="Доступ ограничен по роли" />;

  const openShiftAction = async () => {
    if (!profile?.company_id || !profile?.id) return;
    try {
      await openShift(profile.company_id, profile.id);
      toast({ title: "Смена открыта", description: "Весовая разблокирована для операций." });
      await load();
    } catch (e: any) {
      toast({
        title: "Ошибка открытия смены",
        description: e?.message || "Не удалось открыть смену",
        variant: "destructive",
      });
    }
  };

  const closeShiftAction = async () => {
    if (!profile?.company_id || !profile?.id || !activeShift) return;
    const handoverNote = window.prompt("Комментарий к закрытию смены (если есть незакрытые талоны):", "") || "";
    try {
      await closeShift(profile.company_id, profile.id, {
        closingNote: "manual close from weighbridge page",
        handoverNote: handoverNote.trim() || undefined,
      });
      toast({ title: "Смена закрыта", description: "Смена успешно закрыта." });
      await load();
    } catch (e: any) {
      toast({
        title: "Не удалось закрыть смену",
        description: e?.message || "Проверьте незакрытые талоны и handover note",
        variant: "destructive",
      });
    }
  };

  const activeDriver = activeTicket ? drivers.find((d) => d.id === activeTicket.driver_id) : null;
  const activeVehicle = activeTicket ? vehicles.find((v) => v.id === activeTicket.vehicle_id) : null;
  const activeLine = activeTicket?.lines?.[0] ?? null;
  const allocationLabelById = new Map<string, string>();
  Object.values(harvestStructureByField).flat().forEach((item) => {
    allocationLabelById.set(
      item.allocationId,
      `${item.cropName} / ${item.varietyName} / ${item.reproductionName} • ${item.areaHa.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} га`
    );
  });
  const ticketAllocationLabel = (ticket: any) => {
    const id = String(ticket?.crop_structure_allocation_id || "");
    return ticket?.crop_structure_allocation_label || allocationLabelById.get(id) || (id ? `Участок ${id.slice(0, 8)}` : "-");
  };
  const from = activeTicket ? (activeTicket.direction === "incoming" ? fields.find((f) => f.id === activeTicket.field_id)?.name : warehouses.find((w) => w.id === activeTicket.warehouse_from_id)?.name) || "-" : "-";
  const to = activeTicket ? (activeTicket.direction === "incoming" ? warehouses.find((w) => w.id === activeTicket.warehouse_to_id)?.name : activeTicket.direction === "outgoing" ? fields.find((f) => f.id === activeTicket.field_id)?.name : warehouses.find((w) => w.id === activeTicket.warehouse_to_id)?.name) || "-" : "-";

  return (
    <div className="mx-auto max-w-[1360px] space-y-2 px-2 pb-2">
      <PageHeader title="Весовая и движения" description="Операционный терминал весовой">
        <Button variant="outline" onClick={() => historyRef.current?.scrollIntoView({ behavior: "smooth" })}><History className="mr-2 h-4 w-4" />История</Button>
      </PageHeader>

      <Card className="border-slate-200">
        <CardContent className="flex flex-col gap-1.5 p-2 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge className={activeShift ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}>
              {activeShift ? "Смена открыта" : "Смена закрыта"}
            </Badge>
            <span className="text-slate-600">Активные: {shiftCounters.activeTickets}</span>
            <span className="text-slate-600">Зависшие: {shiftCounters.stuckTickets}</span>
            <span className="text-slate-600">Несинхр.: {shiftCounters.unsynced}</span>
            <span className="text-slate-600">Ручные правки: {shiftCounters.manualCorrections}</span>
            {activeShift?.opened_at ? <span className="text-slate-500">Открыта: {fmt(activeShift.opened_at, lang)}</span> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={workstationMode} onValueChange={(v) => setWorkstationMode(v as WorkstationMode)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Обычный режим</SelectItem>
                <SelectItem value="peak_harvest">Пик уборки</SelectItem>
                <SelectItem value="night_minimal">Ночной минимум</SelectItem>
              </SelectContent>
            </Select>
            {activeShift ? (
              <Button variant="outline" onClick={closeShiftAction}>Закрыть смену</Button>
            ) : (
              <Button onClick={openShiftAction}>Открыть смену</Button>
            )}
          </div>
        </CardContent>
      </Card>

      {!activeShift && canOperate ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            Действия весовой заблокированы: сначала откройте смену.
          </div>
        </div>
      ) : null}

      <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="xl:col-start-1">
          <CardHeader className="py-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Scale className="h-4 w-4 text-blue-600" /> Операторский терминал
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            <div className="rounded-md border bg-slate-950 px-3 py-2 text-white">
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-300">LIVE</div>
              <div className="mt-1 text-2xl font-black leading-none">{liveWeightKg.toLocaleString("ru-RU")} кг</div>
            </div>

            {!canOperate ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Режим просмотра: создание и закрытие талонов недоступны.
              </div>
            ) : null}

            <div className="space-y-1">
              <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">1. Вид движения</Label>
              <div className="grid gap-1.5 md:grid-cols-4">
                {MOVEMENT_GROUPS.map((group) => {
                  const active = selectedMovementGroup === group.id;
                  return (
                    <Button
                      key={group.id}
                      type="button"
                      variant={active ? "default" : "outline"}
                      className={active ? "h-auto justify-start px-3 py-2 text-left" : "h-auto justify-start px-3 py-2 text-left"}
                      onClick={() => selectOperation(GROUP_DEFAULT_OPERATION[group.id])}
                    >
                      <span>
                        <span className="block text-sm font-semibold">{group.title}</span>
                        <span className={active ? "block text-[11px] text-white/75" : "block text-[11px] text-slate-500"}>{group.hint}</span>
                      </span>
                    </Button>
                  );
                })}
              </div>
            </div>

            {selectedSubtypes.length > 1 ? (
              <div className="space-y-1">
                <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">2. Уточнение</Label>
                <div className="grid gap-1.5 md:grid-cols-2">
                  {selectedSubtypes.map((subtype) => (
                    <Button
                      key={subtype.type}
                      type="button"
                      size="sm"
                      variant={form.operationType === subtype.type ? "default" : "outline"}
                      className="h-8 justify-start"
                      onClick={() => selectOperation(subtype.type)}
                    >
                      {subtype.title}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="grid gap-2 md:grid-cols-2">
              {(form.operationType === "harvest_incoming" || isFieldIssue) ? (
                <div className="space-y-1">
                  <Label>Поле *</Label>
                  <Select value={form.fieldId} onValueChange={(v) => setForm((p) => ({ ...p, fieldId: v, cropStructureAllocationId: "", cropId: "", varietyId: "", reproductionId: "", stockIdentityKey: "" }))}>
                    <SelectTrigger className="h-8"><SelectValue placeholder="Выберите поле" /></SelectTrigger>
                    <SelectContent>{fields.map((f) => <SelectItem key={f.id} value={f.id}>{f.name} • {f.area.toFixed(2)} га</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ) : null}

              {(isTransfer || isFieldIssue || isDisposal || isShipment) ? (
                <div className="space-y-1">
                  <Label>Склад-источник *</Label>
                  <Select value={form.warehouseFromId} onValueChange={(v) => setForm((p) => ({ ...p, warehouseFromId: v, stockIdentityKey: "", productId: "", varietyId: "", reproductionId: "", quantityKg: "" }))}>
                    <SelectTrigger className="h-8"><SelectValue placeholder="Выберите склад" /></SelectTrigger>
                    <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ) : null}

              {(form.operationType === "harvest_incoming" || form.operationType === "supplier_receipt" || isTransfer) ? (
                <div className="space-y-1">
                  <Label>Склад назначения *</Label>
                  <Select value={form.warehouseToId} onValueChange={(v) => setForm((p) => ({ ...p, warehouseToId: v }))}>
                    <SelectTrigger className="h-8"><SelectValue placeholder="Выберите склад" /></SelectTrigger>
                    <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ) : null}

              {form.operationType === "supplier_receipt" ? (
                <>
                  <div className="space-y-1">
                    <Label>Контрагент *</Label>
                    <Select value={form.supplierId} onValueChange={(v) => setForm((p) => ({ ...p, supplierId: v }))}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="Выберите контрагента" /></SelectTrigger>
                      <SelectContent>
                        {suppliers.length === 0 ? <SelectItem value="__empty" disabled>Контрагенты не добавлены</SelectItem> : null}
                        {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Документ</Label>
                    <Input className="h-8" value={form.supplierDocumentNo} onChange={(e) => setForm((p) => ({ ...p, supplierDocumentNo: e.target.value }))} placeholder="Накладная / ТТН" />
                  </div>
                </>
              ) : null}
            </div>

            {form.operationType === "harvest_incoming" ? (
              <div className="space-y-1.5 rounded-md border bg-slate-50 p-2">
                {fieldHarvestOptions.length > 1 ? (
                  <div className="space-y-1">
                    <Label>Посевная строка *</Label>
                    <Select value={form.cropStructureAllocationId} onValueChange={(v) => setForm((p) => ({ ...p, cropStructureAllocationId: v }))}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="Выберите строку" /></SelectTrigger>
                      <SelectContent>
                        {fieldHarvestOptions.map((x) => (
                          <SelectItem key={x.allocationId} value={x.allocationId}>{x.cropName} / {x.varietyName} / {x.reproductionName} • {x.areaHa.toFixed(2)} га</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <div className="grid gap-2 md:grid-cols-3">
                  <Input className="h-8" value={selectedHarvestAllocation?.cropName || crops.find((c) => c.id === form.cropId)?.name || ""} readOnly placeholder="Культура из структуры" />
                  <Input className="h-8" value={selectedHarvestAllocation?.varietyName || ""} readOnly placeholder="Сорт из структуры" />
                  <Input className="h-8" value={selectedHarvestAllocation?.reproductionName || ""} readOnly placeholder="Репродукция из структуры" />
                </div>
                <div className="text-xs text-slate-600">
                  Партия: {selectedHarvestAllocation?.cropName || "—"} / {selectedHarvestAllocation?.varietyName || "—"} / {selectedHarvestAllocation?.reproductionName || "—"}
                </div>
              </div>
            ) : null}

            {form.operationType === "supplier_receipt" ? (
              <div className="space-y-2 rounded-md border bg-slate-50 p-2">
                <div className="grid gap-1.5 md:grid-cols-2">
                  <Button type="button" size="sm" variant={form.supplierReceiptMode === "weighbridge" ? "default" : "outline"} className="h-8" onClick={() => setForm((p) => ({ ...p, supplierReceiptMode: "weighbridge" }))}>Через весовую</Button>
                  <Button type="button" size="sm" variant={form.supplierReceiptMode === "direct" ? "default" : "outline"} className="h-8" onClick={() => setForm((p) => ({ ...p, supplierReceiptMode: "direct", grossKg: "", driverId: "", vehicleId: "" }))}>По накладной</Button>
                </div>
                <div className="grid gap-1.5 md:grid-cols-2">
                  <Button type="button" size="sm" variant={form.supplierItemMode === "generic" ? "default" : "outline"} className="h-8" onClick={() => setForm((p) => ({ ...p, supplierItemMode: "generic", cropId: "", varietyId: "", reproductionId: "", supplierLot: "", harvestYear: "" }))}>Обычная поставка</Button>
                  <Button type="button" size="sm" variant={form.supplierItemMode === "agro_identity" ? "default" : "outline"} className="h-8" onClick={() => setForm((p) => ({ ...p, supplierItemMode: "agro_identity", productId: "" }))}>Семена / Агро</Button>
                </div>
                {form.supplierItemMode === "generic" ? (
                  <div className="grid gap-2 md:grid-cols-2">
                    <Select value={form.productId} onValueChange={(v) => setForm((p) => ({ ...p, productId: v }))}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="Номенклатура" /></SelectTrigger>
                      <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                    </Select>
                    {form.supplierReceiptMode === "direct" ? <Input className="h-8" value={form.quantityKg} onChange={(e) => setForm((p) => ({ ...p, quantityKg: e.target.value }))} placeholder="Количество, кг" /> : null}
                  </div>
                ) : (
                  <div className="grid gap-2 md:grid-cols-3">
                    <Select value={form.cropId} onValueChange={(v) => setForm((p) => ({ ...p, cropId: v, varietyId: "" }))}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="Культура" /></SelectTrigger>
                      <SelectContent>{crops.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={form.varietyId} onValueChange={(v) => setForm((p) => ({ ...p, varietyId: v }))} disabled={!form.cropId}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="Сорт" /></SelectTrigger>
                      <SelectContent>{supplierVarietyOptions.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={form.reproductionId} onValueChange={(v) => setForm((p) => ({ ...p, reproductionId: v }))}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="Репродукция" /></SelectTrigger>
                      <SelectContent>{reproductions.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input className="h-8" value={form.supplierLot} onChange={(e) => setForm((p) => ({ ...p, supplierLot: e.target.value }))} placeholder="Партия поставщика" />
                    <Input className="h-8" value={form.harvestYear} onChange={(e) => setForm((p) => ({ ...p, harvestYear: e.target.value }))} placeholder="Год урожая" />
                    {form.supplierReceiptMode === "direct" ? <Input className="h-8" value={form.quantityKg} onChange={(e) => setForm((p) => ({ ...p, quantityKg: e.target.value }))} placeholder="Количество, кг" /> : null}
                  </div>
                )}
              </div>
            ) : null}

            {isFieldIssue ? (
              <div className="space-y-2 rounded-md border bg-slate-50 p-2">
                <div className="grid gap-1.5 md:grid-cols-2">
                  <Button type="button" size="sm" variant={form.fieldIssueMode === "weighbridge" ? "default" : "outline"} className="h-8" onClick={() => setForm((p) => ({ ...p, fieldIssueMode: "weighbridge", quantityKg: "" }))}>Через весовую</Button>
                  <Button type="button" size="sm" variant={form.fieldIssueMode === "direct" ? "default" : "outline"} className="h-8" onClick={() => setForm((p) => ({ ...p, fieldIssueMode: "direct", grossKg: "", driverId: "", vehicleId: "" }))}>Ручная выдача</Button>
                </div>
                <div className="grid gap-1.5 md:grid-cols-5">
                  {(Object.keys(fieldMaterialCategoryLabels) as FieldMaterialCategory[]).map((type) => (
                    <Button key={type} type="button" size="sm" variant={form.fieldMaterialCategory === type ? "default" : "outline"} className="h-8" onClick={() => setForm((p) => ({ ...p, fieldMaterialCategory: type, stockIdentityKey: "", productId: "", varietyId: "", reproductionId: "", quantityKg: "" }))}>
                      {fieldMaterialCategoryLabels[type]}
                    </Button>
                  ))}
                </div>
                {fieldHarvestOptions.length > 1 ? (
                  <Select value={form.cropStructureAllocationId} onValueChange={(v) => setForm((p) => ({ ...p, cropStructureAllocationId: v, stockIdentityKey: "", productId: "", varietyId: "", reproductionId: "", quantityKg: "" }))}>
                    <SelectTrigger className="h-8"><SelectValue placeholder="Посевная строка / участок поля" /></SelectTrigger>
                    <SelectContent>{fieldHarvestOptions.map((x) => <SelectItem key={x.allocationId} value={x.allocationId}>{x.cropName} / {x.varietyName} / {x.reproductionName} • {x.areaHa.toFixed(2)} га</SelectItem>)}</SelectContent>
                  </Select>
                ) : null}
                {selectedHarvestAllocation ? <div className="text-xs text-emerald-800">Участок: {selectedHarvestAllocation.cropName} / {selectedHarvestAllocation.varietyName} / {selectedHarvestAllocation.reproductionName} • {selectedHarvestAllocation.areaHa.toFixed(2)} га</div> : null}
                <div className="grid gap-2 md:grid-cols-2">
                  <Select value={form.stockIdentityKey} onValueChange={(v) => {
                    const selected = fieldIssueStockOptions.find((item) => item.key === v);
                    setForm((p) => ({ ...p, stockIdentityKey: v, productId: selected?.product_id || "", varietyId: selected?.variety_id || "", reproductionId: selected?.reproduction_id || "" }));
                  }} disabled={!form.warehouseFromId || !selectedHarvestAllocation || stockIdentityLoading}>
                    <SelectTrigger className="h-8"><SelectValue placeholder="Материал из наличия склада" /></SelectTrigger>
                    <SelectContent>{fieldIssueStockOptions.map((item) => <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>)}</SelectContent>
                  </Select>
                  {form.fieldIssueMode === "direct" ? <Input className="h-8" value={form.quantityKg} onChange={(e) => setForm((p) => ({ ...p, quantityKg: e.target.value }))} placeholder="Количество, кг" /> : <div className="rounded-md border bg-white px-2 py-1.5 text-xs text-slate-600">Количество рассчитается при закрытии: нетто = брутто - тара.</div>}
                </div>
              </div>
            ) : null}

            {isTransfer || isDisposal || isShipment ? (
              <div className="space-y-2 rounded-md border bg-slate-50 p-2">
                {isTransfer ? (
                  <div className="grid gap-1.5 md:grid-cols-2">
                    <Button type="button" size="sm" variant={form.transferMode === "weighbridge" ? "default" : "outline"} className="h-8" onClick={() => setForm((p) => ({ ...p, transferMode: "weighbridge", quantityKg: "" }))}>Через весовую</Button>
                    <Button type="button" size="sm" variant={form.transferMode === "direct" ? "default" : "outline"} className="h-8" onClick={() => setForm((p) => ({ ...p, transferMode: "direct", grossKg: "", driverId: "", vehicleId: "" }))}>Ручное перемещение</Button>
                  </div>
                ) : null}
                {isShipment ? (
                  <div className="grid gap-2 md:grid-cols-2">
                    <div className="space-y-1">
                      <Label>Контрагент *</Label>
                      <Select value={form.buyerId} onValueChange={(v) => setForm((p) => ({ ...p, buyerId: v }))}>
                        <SelectTrigger className="h-8"><SelectValue placeholder="Выберите покупателя/получателя" /></SelectTrigger>
                        <SelectContent>
                          {buyers.length === 0 ? <SelectItem value="__empty" disabled>Контрагенты не добавлены</SelectItem> : null}
                          {buyers.map((buyer) => <SelectItem key={buyer.id} value={buyer.id}>{buyer.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Цель отгрузки *</Label>
                      <Select value={form.shipmentPurpose} onValueChange={(v) => setForm((p) => ({ ...p, shipmentPurpose: v as ShipmentPurpose }))}>
                        <SelectTrigger className="h-8"><SelectValue placeholder="Выберите цель" /></SelectTrigger>
                        <SelectContent>
                          {(Object.keys(shipmentPurposeLabels) as ShipmentPurpose[]).map((purpose) => (
                            <SelectItem key={purpose} value={purpose}>{shipmentPurposeLabels[purpose]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Документ</Label>
                      <Input className="h-8" value={form.externalDocumentNo} onChange={(e) => setForm((p) => ({ ...p, externalDocumentNo: e.target.value }))} placeholder="Накладная / ТТН" />
                    </div>
                    <div className="space-y-1">
                      <Label>Пункт назначения</Label>
                      <Input className="h-8" value={form.destinationText} onChange={(e) => setForm((p) => ({ ...p, destinationText: e.target.value }))} placeholder="Адрес, элеватор, база..." />
                    </div>
                  </div>
                ) : null}
                <div className="grid gap-2 md:grid-cols-2">
                  <Select value={form.stockIdentityKey} onValueChange={(v) => {
                    const selected = stockIdentityOptions.find((item) => item.key === v);
                    setForm((p) => ({ ...p, stockIdentityKey: v, productId: selected?.product_id || "", varietyId: selected?.variety_id || "", reproductionId: selected?.reproduction_id || "" }));
                  }} disabled={!form.warehouseFromId || stockIdentityLoading}>
                    <SelectTrigger className="h-8"><SelectValue placeholder={isShipment ? "Остаток к отгрузке" : "Остаток склада"} /></SelectTrigger>
                    <SelectContent>{stockIdentityOptions.map((item) => <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>)}</SelectContent>
                  </Select>
                  {isTransfer && form.transferMode === "direct" ? <Input className="h-8" value={form.quantityKg} onChange={(e) => setForm((p) => ({ ...p, quantityKg: e.target.value }))} placeholder="Количество, кг" /> : null}
                  {isDisposal ? (
                    <Select value={form.disposalCategory} onValueChange={(v) => setForm((p) => ({ ...p, disposalCategory: v as DisposalCategory }))}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="Категория выбытия" /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(disposalCategoryLabels) as DisposalCategory[]).map((category) => (
                          <SelectItem key={category} value={category}>{disposalCategoryLabels[category]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                  {isDisposal ? <Input className="h-8" value={form.disposalReason} onChange={(e) => setForm((p) => ({ ...p, disposalReason: e.target.value }))} placeholder="Причина списания" /> : null}
                </div>
              </div>
            ) : null}

            {form.operationType === "supplier_receipt" && form.supplierReceiptMode === "direct" ? null : (
              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>Водитель{isTransferDirect || isFieldIssueDirect ? "" : " *"}</Label>
                  <Select value={form.driverId} onValueChange={(v) => setForm((p) => ({ ...p, driverId: v }))}>
                    <SelectTrigger className="h-8"><SelectValue placeholder="Выберите водителя" /></SelectTrigger>
                    <SelectContent>{selectableDrivers.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Машина{isTransferDirect || isFieldIssueDirect ? "" : " *"}</Label>
                  <Select value={form.vehicleId} onValueChange={(v) => setForm((p) => ({ ...p, vehicleId: v }))}>
                    <SelectTrigger className="h-8"><SelectValue placeholder="Выберите машину" /></SelectTrigger>
                    <SelectContent>{vehicles.map((v) => <SelectItem key={v.id} value={v.id}>{v.name} ({v.plate})</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {isWeighbridgeForm ? (
              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>Брутто / вес (кг) *</Label>
                  <Input className="h-8" value={form.grossKg} onChange={(e) => setForm((p) => ({ ...p, grossKg: e.target.value }))} />
                </div>
                <div className="rounded-md border bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
                  Тара указывается при закрытии талона. Нетто = брутто - тара.
                </div>
              </div>
            ) : null}

            <div className="space-y-1">
              <Button type="button" variant="ghost" size="sm" className="h-7 px-0 text-xs" onClick={() => setCommentOpen((v) => !v)}>
                {commentOpen ? "− Комментарий" : "+ Комментарий"}
              </Button>
              {commentOpen ? <Textarea value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} rows={2} /> : null}
            </div>

            {canOperate ? (
              <div className="sticky bottom-0 z-10 border-t bg-white/95 pt-2 backdrop-blur">
                <Button className="h-9 w-full" onClick={create} disabled={submitting}>
                  {submitting ? "Создание..." : "Создать талон"}
                </Button>
                {loading ? <div className="mt-1 text-xs text-amber-700">Данные ещё загружаются. Повторите через пару секунд.</div> : null}
                {!loading && !activeShift ? <div className="mt-1 text-xs text-amber-700">Смена закрыта: откройте смену сверху.</div> : null}
              </div>
            ) : null}
          </CardContent>
          <CardContent className="hidden">
            <div className="grid gap-1.5 md:grid-cols-1">
              <div className="rounded-md border bg-slate-900 px-2 py-1.5 text-white">
                <div className="text-xs uppercase tracking-wide text-slate-300">LIVE</div>
                <div className="mt-1 text-xl font-semibold leading-none">{liveWeightKg.toLocaleString("ru-RU")} кг</div>
              </div>
              <div className="hidden rounded-md border bg-slate-50 p-3 text-sm">
                <div className="text-xs text-slate-500">Текущий талон</div>
                <div className="mt-1 font-medium">{activeTicket?.ticket_no || "—"}</div>
              </div>
              <div className="hidden rounded-md border bg-slate-50 p-3 text-sm">
                <div className="text-xs text-slate-500">Следующее действие</div>
                <div className="mt-1 font-medium">{nextActionLabel}</div>
              </div>
            </div>
            {!canOperate ? <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Режим наблюдения: доступен только просмотр.</div> : null}
            <div className="space-y-1">
              <Label>Тип операции</Label>
              <div className="grid gap-1 md:grid-cols-2">{(["harvest_incoming", "supplier_receipt", "issue_to_field", "transfer_between_warehouses", "disposal_writeoff", "drying"] as OperationType[]).map((type) => <Button key={type} size="sm" type="button" variant={form.operationType === type ? "default" : "outline"} className={form.operationType === type ? "h-8 border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700" : "h-8"} onClick={() => setForm((p) => ({ ...INITIAL_FORM, operationType: type }))}>{opMeta(type).title}</Button>)}</div>
            </div>

            {form.operationType === "harvest_incoming" ? (
              <div className="space-y-1">
                <Label>Номенклатура урожая *</Label>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
                  Номенклатура урожая определяется автоматически по структуре посевов и не редактируется вручную.
                </div>
                {/* manual harvest nomenclature selector removed intentionally */}
                {/* <Select value={form.harvestProductId} onValueChange={(v) => setForm((p) => ({ ...p, harvestProductId: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Автоподбор или выберите вручную" />
                  </SelectTrigger>
                  <SelectContent>
                    {harvestProducts.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select> */}
              </div>
            ) : null}

            {form.operationType === "supplier_receipt" ? (
              <div className="space-y-2 rounded-md border border-blue-100 bg-blue-50/50 p-2">
                <div className="grid gap-2 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Поставщик *</Label>
                    <Select value={form.supplierId} onValueChange={(v) => setForm((p) => ({ ...p, supplierId: v }))}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="Выберите поставщика" /></SelectTrigger>
                      <SelectContent>
                        {suppliers.length === 0 ? <SelectItem value="__empty" disabled>Поставщики не добавлены</SelectItem> : null}
                        {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Документ поставщика</Label>
                    <Input className="h-8" value={form.supplierDocumentNo} onChange={(e) => setForm((p) => ({ ...p, supplierDocumentNo: e.target.value }))} placeholder="Накладная / ТТН" />
                  </div>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Тип приёмки *</Label>
                    <div className="grid grid-cols-2 gap-1">
                      <Button type="button" size="sm" variant={form.supplierReceiptMode === "weighbridge" ? "default" : "outline"} className="h-8" onClick={() => setForm((p) => ({ ...p, supplierReceiptMode: "weighbridge" }))}>Через весовую</Button>
                      <Button type="button" size="sm" variant={form.supplierReceiptMode === "direct" ? "default" : "outline"} className="h-8" onClick={() => setForm((p) => ({ ...p, supplierReceiptMode: "direct", grossKg: "", driverId: "", vehicleId: "" }))}>По накладной</Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Тип продукции *</Label>
                    <div className="grid grid-cols-2 gap-1">
                      <Button type="button" size="sm" variant={form.supplierItemMode === "generic" ? "default" : "outline"} className="h-8" onClick={() => setForm((p) => ({ ...p, supplierItemMode: "generic", cropId: "", varietyId: "", reproductionId: "", supplierLot: "", harvestYear: "" }))}>Обычная поставка</Button>
                      <Button type="button" size="sm" variant={form.supplierItemMode === "agro_identity" ? "default" : "outline"} className="h-8" onClick={() => setForm((p) => ({ ...p, supplierItemMode: "agro_identity", productId: "" }))}>Семена / Агро</Button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-2">
              {(form.operationType === "harvest_incoming" || form.operationType === "issue_to_field") && <div className="space-y-2"><Label>Поле *</Label><Select value={form.fieldId} onValueChange={(v) => setForm((p) => ({ ...p, fieldId: v, cropStructureAllocationId: "", cropId: "", varietyId: "", reproductionId: "" }))}><SelectTrigger><SelectValue placeholder="Выберите поле" /></SelectTrigger><SelectContent>{fields.map((f) => <SelectItem key={f.id} value={f.id}>{f.name} • {f.area.toFixed(2)} га</SelectItem>)}</SelectContent></Select></div>}
              {form.operationType !== "harvest_incoming" && form.operationType !== "supplier_receipt" && <div className="space-y-2"><Label>Склад-источник *</Label><Select value={form.warehouseFromId} onValueChange={(v) => setForm((p) => ({ ...p, warehouseFromId: v, stockIdentityKey: "", productId: "", varietyId: "", reproductionId: "", quantityKg: "" }))}><SelectTrigger><SelectValue placeholder="Выберите склад" /></SelectTrigger><SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select></div>}
              {(form.operationType === "harvest_incoming" || form.operationType === "supplier_receipt" || form.operationType === "transfer_between_warehouses" || form.operationType === "drying") && <div className="space-y-2"><Label>{form.operationType === "drying" ? "Склад после сушки *" : "Склад назначения *"}</Label><Select value={form.warehouseToId} onValueChange={(v) => setForm((p) => ({ ...p, warehouseToId: v }))}><SelectTrigger><SelectValue placeholder="Выберите склад" /></SelectTrigger><SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select></div>}
              {form.operationType === "drying" && <div className="space-y-2"><Label>Точка сушки *</Label><Select value={form.processingPointId} onValueChange={(v) => setForm((p) => ({ ...p, processingPointId: v }))}><SelectTrigger><SelectValue placeholder="Выберите точку" /></SelectTrigger><SelectContent>{processingPoints.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent></Select></div>}
            </div>

            {form.operationType === "harvest_incoming" ? <div className="space-y-1.5">{fieldHarvestOptions.length > 1 ? <div className="space-y-1"><Label>Посевная строка *</Label><Select value={form.cropStructureAllocationId} onValueChange={(v) => setForm((p) => ({ ...p, cropStructureAllocationId: v }))}><SelectTrigger className="h-8"><SelectValue placeholder="Выберите строку структуры посевов" /></SelectTrigger><SelectContent>{fieldHarvestOptions.map((x) => <SelectItem key={x.allocationId} value={x.allocationId}>{x.cropName} / {x.varietyName} / {x.reproductionName} • {x.areaHa.toFixed(2)} га</SelectItem>)}</SelectContent></Select></div> : null}<div className="grid gap-2 md:grid-cols-3"><div className="space-y-1"><Label>Культура *</Label><Input className="h-8" value={selectedHarvestAllocation?.cropName || crops.find((c) => c.id === form.cropId)?.name || ""} readOnly placeholder="Авто из структуры посевов" /></div><div className="space-y-1"><Label>Сорт *</Label><Input className="h-8" value={selectedHarvestAllocation?.varietyName || ""} readOnly placeholder="Авто из структуры посевов" /></div><div className="space-y-1"><Label>Репродукция *</Label><Input className="h-8" value={selectedHarvestAllocation?.reproductionName || ""} readOnly placeholder="Авто из структуры посевов" /></div></div><div className="rounded-md border bg-slate-50 px-2 py-1.5 text-xs"><div className="text-slate-700">Партия: {(selectedHarvestAllocation?.cropName || crops.find((c) => c.id === form.cropId)?.name || "—")} / {(selectedHarvestAllocation?.varietyName || "—")} / {(selectedHarvestAllocation?.reproductionName || "—")}</div><div className="text-slate-600">Поле: {fields.find((f) => f.id === form.fieldId)?.name || "—"} • Склад: {warehouses.find((w) => w.id === form.warehouseToId)?.name || "—"}</div></div>{form.fieldId && harvestIncompleteFields[form.fieldId] ? <div className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">В структуре посевов для этого поля не указан сорт/репродукция.</div> : null}{form.fieldId && fieldHarvestOptions.length === 0 && !harvestIncompleteFields[form.fieldId] ? <div className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">Для этого поля нет структуры посевов в активном сезоне.</div> : null}</div> : form.operationType === "supplier_receipt" ? (
              <div className="space-y-2">
                {form.supplierItemMode === "generic" ? (
                  <div className="grid gap-2 md:grid-cols-2">
                    <div className="space-y-1"><Label>Номенклатура *</Label><Select value={form.productId} onValueChange={(v) => setForm((p) => ({ ...p, productId: v }))}><SelectTrigger className="h-8"><SelectValue placeholder="Удобрения, СЗР, ГСМ..." /></SelectTrigger><SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></div>
                    {form.supplierReceiptMode === "direct" ? <div className="space-y-1"><Label>Количество по накладной (кг) *</Label><Input className="h-8" value={form.quantityKg} onChange={(e) => setForm((p) => ({ ...p, quantityKg: e.target.value }))} /></div> : null}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="grid gap-2 md:grid-cols-3">
                      <div className="space-y-1"><Label>Культура *</Label><Select value={form.cropId} onValueChange={(v) => setForm((p) => ({ ...p, cropId: v, varietyId: "" }))}><SelectTrigger className="h-8"><SelectValue placeholder="Культура" /></SelectTrigger><SelectContent>{crops.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
                      <div className="space-y-1"><Label>Сорт *</Label><Select value={form.varietyId} onValueChange={(v) => setForm((p) => ({ ...p, varietyId: v }))} disabled={!form.cropId}><SelectTrigger className="h-8"><SelectValue placeholder={form.cropId ? "Выберите сорт" : "Сначала культура"} /></SelectTrigger><SelectContent>{supplierVarietyOptions.length === 0 ? <SelectItem value="__empty" disabled>Для культуры сорта не найдены</SelectItem> : null}{supplierVarietyOptions.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent></Select></div>
                      <div className="space-y-1"><Label>Репродукция *</Label><Select value={form.reproductionId} onValueChange={(v) => setForm((p) => ({ ...p, reproductionId: v }))}><SelectTrigger className="h-8"><SelectValue placeholder="Выберите репродукцию" /></SelectTrigger><SelectContent>{reproductions.length === 0 ? <SelectItem value="__empty" disabled>Репродукции не найдены</SelectItem> : null}{reproductions.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent></Select></div>
                    </div>
                    <div className="grid gap-2 md:grid-cols-3">
                      <div className="space-y-1"><Label>Партия поставщика *</Label><Input className="h-8" value={form.supplierLot} onChange={(e) => setForm((p) => ({ ...p, supplierLot: e.target.value }))} /></div>
                      <div className="space-y-1"><Label>Год урожая</Label><Input className="h-8" value={form.harvestYear} onChange={(e) => setForm((p) => ({ ...p, harvestYear: e.target.value }))} /></div>
                      {form.supplierReceiptMode === "direct" ? <div className="space-y-1"><Label>Количество (кг) *</Label><Input className="h-8" value={form.quantityKg} onChange={(e) => setForm((p) => ({ ...p, quantityKg: e.target.value }))} /></div> : null}
                    </div>
                  </div>
                )}
              </div>
            ) : form.operationType === "issue_to_field" ? (
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label>Режим выдачи *</Label>
                  <div className="grid grid-cols-2 gap-1">
                    <Button type="button" size="sm" variant={form.fieldIssueMode === "weighbridge" ? "default" : "outline"} className="h-8" onClick={() => setForm((p) => ({ ...p, fieldIssueMode: "weighbridge", quantityKg: "" }))}>Через весовую</Button>
                    <Button type="button" size="sm" variant={form.fieldIssueMode === "direct" ? "default" : "outline"} className="h-8" onClick={() => setForm((p) => ({ ...p, fieldIssueMode: "direct", grossKg: "", driverId: "", vehicleId: "" }))}>Ручная выдача</Button>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Операция по полю *</Label>
                  <div className="grid grid-cols-3 gap-1">
                    {(Object.keys(fieldMaterialCategoryLabels) as FieldMaterialCategory[]).map((type) => (
                      <Button
                        key={type}
                        type="button"
                        size="sm"
                        variant={form.fieldMaterialCategory === type ? "default" : "outline"}
                        className="h-8"
                        onClick={() => setForm((p) => ({ ...p, fieldMaterialCategory: type, stockIdentityKey: "", productId: "", varietyId: "", reproductionId: "", quantityKg: "" }))}
                      >
                        {fieldMaterialCategoryLabels[type]}
                      </Button>
                    ))}
                  </div>
                </div>

                {fieldHarvestOptions.length > 1 ? (
                  <div className="space-y-1">
                    <Label>Посевная строка / участок поля *</Label>
                    <Select
                      value={form.cropStructureAllocationId}
                      onValueChange={(v) => setForm((p) => ({ ...p, cropStructureAllocationId: v, stockIdentityKey: "", productId: "", varietyId: "", reproductionId: "", quantityKg: "" }))}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue placeholder="Выберите культуру/сорт/репродукцию/площадь" />
                      </SelectTrigger>
                      <SelectContent>
                        {fieldHarvestOptions.map((x) => (
                          <SelectItem key={x.allocationId} value={x.allocationId}>
                            {x.cropName} / {x.varietyName} / {x.reproductionName} — {x.areaHa.toFixed(2)} га
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                {selectedHarvestAllocation ? (
                  <div className="rounded-md border bg-emerald-50 px-2 py-1.5 text-xs text-emerald-900">
                    Посевная строка: {selectedHarvestAllocation.cropName} / {selectedHarvestAllocation.varietyName} / {selectedHarvestAllocation.reproductionName} • {selectedHarvestAllocation.areaHa.toFixed(2)} га
                  </div>
                ) : form.fieldId ? (
                  <div className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                    Для поля не найдена полная структура посевов активного сезона.
                  </div>
                ) : null}

                <div className="grid gap-2 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Материал из склада *</Label>
                    <Select
                      value={form.stockIdentityKey}
                      onValueChange={(v) => {
                        const selected = fieldIssueStockOptions.find((item) => item.key === v);
                        setForm((p) => ({
                          ...p,
                          stockIdentityKey: v,
                          productId: selected?.product_id || "",
                          varietyId: selected?.variety_id || "",
                          reproductionId: selected?.reproduction_id || "",
                        }));
                      }}
                      disabled={!form.warehouseFromId || !selectedHarvestAllocation || stockIdentityLoading}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue placeholder={!form.warehouseFromId ? "Сначала выберите склад" : !selectedHarvestAllocation ? "Сначала выберите посевную строку" : stockIdentityLoading ? "Загрузка остатков..." : "Выберите материал"} />
                      </SelectTrigger>
                      <SelectContent>
                        {fieldIssueStockOptions.length === 0 ? <SelectItem value="__empty" disabled>{stockIdentityLoading ? "Загрузка..." : "Подходящих остатков нет"}</SelectItem> : null}
                        {fieldIssueStockOptions.map((item) => <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {form.fieldIssueMode === "direct" ? (
                    <div className="space-y-1">
                      <Label>Количество (кг) *</Label>
                      <Input className="h-8" value={form.quantityKg} onChange={(e) => setForm((p) => ({ ...p, quantityKg: e.target.value }))} />
                    </div>
                  ) : (
                    <div className="rounded-md border bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
                      Количество будет рассчитано при закрытии: нетто = брутто - тара.
                    </div>
                  )}
                </div>

                {isSeedIssueOperation(form.fieldMaterialCategory) && selectedTransferStock && selectedHarvestAllocation && (
                  selectedTransferStock.variety_id !== selectedHarvestAllocation.varietyId ||
                  selectedTransferStock.reproduction_id !== selectedHarvestAllocation.reproductionId ||
                  !selectedTransferStock.product_name.toLowerCase().includes(selectedHarvestAllocation.cropName.toLowerCase())
                ) ? (
                  <div className="rounded-md border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-900">
                    Семенная партия не совпадает со структурой поля. Такой отпуск будет заблокирован.
                  </div>
                ) : null}
              </div>
            ) : form.operationType === "transfer_between_warehouses" ? (
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label>Режим перемещения *</Label>
                  <div className="grid grid-cols-2 gap-1">
                    <Button type="button" size="sm" variant={form.transferMode === "weighbridge" ? "default" : "outline"} className="h-8" onClick={() => setForm((p) => ({ ...p, transferMode: "weighbridge", quantityKg: "" }))}>Через весовую</Button>
                    <Button type="button" size="sm" variant={form.transferMode === "direct" ? "default" : "outline"} className="h-8" onClick={() => setForm((p) => ({ ...p, transferMode: "direct", grossKg: "", driverId: "", vehicleId: "" }))}>Ручное перемещение</Button>
                  </div>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Остаток склада *</Label>
                    <Select
                      value={form.stockIdentityKey}
                      onValueChange={(v) => {
                        const selected = stockIdentityOptions.find((item) => item.key === v);
                        setForm((p) => ({
                          ...p,
                          stockIdentityKey: v,
                          productId: selected?.product_id || "",
                          varietyId: selected?.variety_id || "",
                          reproductionId: selected?.reproduction_id || "",
                        }));
                      }}
                      disabled={!form.warehouseFromId || stockIdentityLoading}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue placeholder={!form.warehouseFromId ? "Сначала выберите склад-источник" : stockIdentityLoading ? "Загрузка остатков..." : "Выберите остаток"} />
                      </SelectTrigger>
                      <SelectContent>
                        {stockIdentityOptions.length === 0 ? <SelectItem value="__empty" disabled>{stockIdentityLoading ? "Загрузка..." : "В этом складе нет доступных остатков"}</SelectItem> : null}
                        {stockIdentityOptions.map((item) => <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {selectedTransferStock ? <div className="text-xs text-slate-500">Доступно: {selectedTransferStock.label.split("—").pop()?.trim()}</div> : null}
                  </div>
                  {form.transferMode === "direct" ? (
                    <div className="space-y-1">
                      <Label>Количество (кг) *</Label>
                      <Input className="h-8" value={form.quantityKg} onChange={(e) => setForm((p) => ({ ...p, quantityKg: e.target.value }))} />
                    </div>
                  ) : (
                    <div className="rounded-md border bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
                      Количество будет рассчитано при закрытии: нетто = брутто - тара.
                    </div>
                  )}
                </div>
              </div>
            ) : <div className="grid gap-2 md:grid-cols-2"><div className="space-y-1"><Label>Номенклатура *</Label><Select value={form.productId} onValueChange={(v) => setForm((p) => ({ ...p, productId: v }))}><SelectTrigger className="h-8"><SelectValue placeholder="Выберите номенклатуру" /></SelectTrigger><SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1"><Label>Количество (кг) *</Label><Input className="h-8" value={form.quantityKg} onChange={(e) => setForm((p) => ({ ...p, quantityKg: e.target.value }))} /></div></div>}

            {form.operationType === "supplier_receipt" && form.supplierReceiptMode === "direct" ? null : <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2"><Label>Водитель (специалист){(form.operationType === "transfer_between_warehouses" && form.transferMode === "direct") || (form.operationType === "issue_to_field" && form.fieldIssueMode === "direct") ? "" : " *"}</Label><Select value={form.driverId} onValueChange={(v) => setForm((p) => ({ ...p, driverId: v }))}><SelectTrigger><SelectValue placeholder="Выберите водителя" /></SelectTrigger><SelectContent>{selectableDrivers.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Машина{(form.operationType === "transfer_between_warehouses" && form.transferMode === "direct") || (form.operationType === "issue_to_field" && form.fieldIssueMode === "direct") ? "" : " *"}</Label><Select value={form.vehicleId} onValueChange={(v) => setForm((p) => ({ ...p, vehicleId: v }))}><SelectTrigger><SelectValue placeholder="Выберите машину" /></SelectTrigger><SelectContent>{vehicles.map((v) => <SelectItem key={v.id} value={v.id}>{v.name} ({v.plate})</SelectItem>)}</SelectContent></Select></div>
            </div>}

            {form.operationType === "harvest_incoming" || (form.operationType === "supplier_receipt" && form.supplierReceiptMode === "weighbridge") || (form.operationType === "transfer_between_warehouses" && form.transferMode === "weighbridge") || (form.operationType === "issue_to_field" && form.fieldIssueMode === "weighbridge") ? <div className="grid gap-2 md:grid-cols-2"><div className="space-y-1"><Label>Брутто (кг) *</Label><Input className="h-8" value={form.grossKg} onChange={(e) => setForm((p) => ({ ...p, grossKg: e.target.value }))} /></div><div className="rounded-md border bg-slate-50 px-2 py-1.5 text-xs"><div className="font-medium text-slate-700">Тара указывается только при закрытии талона</div><div className="mt-1 text-slate-500">Формула: нетто = брутто - тара</div></div></div> : null}
            {form.operationType === "drying" ? <div className="grid gap-3 md:grid-cols-3"><div className="space-y-2"><Label>Масса после сушки (кг) *</Label><Input value={form.dryingOutputKg} onChange={(e) => setForm((p) => ({ ...p, dryingOutputKg: e.target.value }))} /></div><div className="space-y-2"><Label>Влажность до (%)</Label><Input value={form.moistureIn} onChange={(e) => setForm((p) => ({ ...p, moistureIn: e.target.value }))} /></div><div className="space-y-2"><Label>Влажность после (%)</Label><Input value={form.moistureOut} onChange={(e) => setForm((p) => ({ ...p, moistureOut: e.target.value }))} /></div></div> : null}
            {form.operationType === "disposal_writeoff" ? <div className="space-y-2"><Label>Причина списания *</Label><Input value={form.disposalReason} onChange={(e) => setForm((p) => ({ ...p, disposalReason: e.target.value }))} /></div> : null}
            <div className="space-y-1">
              <Button type="button" variant="ghost" size="sm" className="h-7 px-0 text-xs" onClick={() => setCommentOpen((v) => !v)}>
                {commentOpen ? "− Комментарий" : "+ Комментарий"}
              </Button>
              {commentOpen ? <Textarea value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} rows={2} /> : null}
            </div>
            {canOperate ? (
              <div className="space-y-1 pt-0.5">
                <Button className="h-8 w-full" onClick={create} disabled={submitting}>
                  {submitting ? "Создание..." : "Создать талон"}
                </Button>
                {loading ? <div className="text-xs text-amber-700">Данные ещё загружаются. Если нажать сейчас, сайт попросит повторить через пару секунд.</div> : null}
                {!loading && !activeShift ? <div className="text-xs text-amber-700">Смена закрыта: откройте смену сверху, затем создайте талон.</div> : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="xl:col-start-2 xl:row-start-1">
          <CardHeader className="py-3"><CardTitle className="flex items-center gap-2 text-base"><Clock3 className="h-4 w-4 text-slate-700" />Открытые талоны</CardTitle></CardHeader>
          <CardContent className="hidden">
            {loading ? <div className="text-sm text-slate-500">Загрузка...</div> : activeTickets.length === 0 ? <div className="rounded-md border border-dashed p-5 text-center text-sm text-slate-500">Активных талонов нет</div> : activeTickets.map((t) => <button key={t.id} type="button" onClick={() => setActiveTicket(t)} className="w-full rounded-lg border border-slate-200 p-3 text-left transition hover:border-blue-300 hover:bg-slate-50"><div className="flex items-center justify-between gap-2"><div className="truncate text-sm font-semibold">{t.ticket_no}</div><Badge className={statusClass(t.status)}>{statusLabel(t.status)}</Badge></div><div className="mt-1 text-xs text-slate-600">{t.op_type}</div><div className="mt-1 text-xs text-slate-600">Этап: <span className="font-medium">{t.tare_weight_kg == null ? "ожидает тару" : "создан"}</span></div><div className="mt-1 text-xs text-slate-500">Брутто: {t.gross_weight_kg ?? "-"} • Машина: {vehicles.find((v) => v.id === t.vehicle_id)?.name || "-"}</div><div className="mt-1 text-xs text-slate-500">{fmt(t.created_at, lang)}</div></button>)}
          </CardContent>
          <CardContent className="space-y-2 pt-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Открытый поток машин</div>
            {loading ? <div className="text-sm text-slate-500">Загрузка...</div> : activeTickets.length === 0 ? <div className="rounded-md border border-dashed p-5 text-center text-sm text-slate-500">Открытых талонов нет</div> : [...activeTickets].sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()).map((t) => {
              const vehicleName = vehicles.find((v) => v.id === t.vehicle_id)?.name || "Транспорт";
              const driverName = drivers.find((d) => d.id === t.driver_id)?.name || "Без водителя";
              return (
                <button key={`open-${t.id}`} type="button" onClick={() => setActiveTicket(t)} className="w-full rounded-md border border-slate-200 p-2 text-left transition hover:border-blue-300 hover:bg-slate-50">
                  <div className="truncate text-sm font-semibold">{vehicleName}</div>
                  <div className="truncate text-xs text-slate-700">{driverName}</div>
                  <div className="mt-0.5 truncate text-xs text-slate-600">{operationUiLabel(t.op_type)}</div>
                  <div className="mt-1 flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700">{t.gross_weight_kg ?? "-"} кг</span>
                    <Badge className="h-5 rounded px-2 text-[10px]">{ticketStageLabel(t)}</Badge>
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">{fmt(t.created_at, lang)} • {t.ticket_no}</div>
                </button>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <div ref={historyRef}>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0"><CardTitle>История талонов</CardTitle><div className="w-[260px]"><Select value={historyTypeFilter} onValueChange={setHistoryTypeFilter}><SelectTrigger><SelectValue placeholder="Фильтр по типу" /></SelectTrigger><SelectContent><SelectItem value="all">Все типы</SelectItem>{historyTypes.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select></div></CardHeader>
          <CardContent className="space-y-2">
            {loading ? <div className="text-sm text-slate-500">Загрузка...</div> : null}
            {!loading && historyTickets.length === 0 ? <div className="text-sm text-slate-500">Закрытых талонов пока нет</div> : null}
            {!loading && historyTickets.slice(0, 80).map((t) => {
              const vehicleName = vehicles.find((v) => v.id === t.vehicle_id)?.name || "Транспорт";
              const driverName = drivers.find((d) => d.id === t.driver_id)?.name || "Без водителя";
              const operationLabel = operationUiLabel(t.op_type);
              const routeFrom =
                t.direction === "incoming"
                  ? fields.find((f) => f.id === t.field_id)?.name || "Поле"
                  : warehouses.find((w) => w.id === t.warehouse_from_id)?.name || "Источник";
              const routeTo =
                t.direction === "incoming"
                  ? warehouses.find((w) => w.id === t.warehouse_to_id)?.name || "Склад"
                  : t.direction === "outgoing"
                    ? fields.find((f) => f.id === t.field_id)?.name || "Поле"
                    : warehouses.find((w) => w.id === t.warehouse_to_id)?.name || "Назначение";
              const routeLabel = `${routeFrom} в†’ ${routeTo}`;
              const grossValue = t.gross_weight_kg != null ? `${Number(t.gross_weight_kg).toLocaleString("ru-RU")} кг` : "—";
              const tareValue = t.tare_weight_kg != null ? `${Number(t.tare_weight_kg).toLocaleString("ru-RU")} кг` : "—";
              const netValue = t.net_weight_kg != null ? `${Number(t.net_weight_kg).toLocaleString("ru-RU")} кг` : "—";
              const dt = fmt(t.finalized_at || t.updated_at || t.created_at, lang);
              return (
                <div key={t.id} className="rounded-md border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-base font-semibold leading-tight">{vehicleName}</div>
                      <div className="mt-0.5 text-sm text-slate-700">{driverName}</div>
                      <div className="mt-1 text-xs text-slate-600">{operationLabel} • {routeLabel}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={statusClass(t.status)}>{statusLabel(t.status)}</Badge>
                      <Button variant="outline" size="sm" onClick={() => setHistoryPreviewTicket(t)}>Открыть</Button>
                      <Button variant="outline" size="sm" onClick={async () => { if (!profile?.id) return; try { await downloadTicketPdf(t.id, profile.id); } catch (error: any) { toast({ title: "Ошибка PDF", description: error?.message || "Не удалось скачать PDF", variant: "destructive" }); } }}><FileDown className="mr-1 h-4 w-4" />PDF</Button>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-2 text-sm">
                    <div><div className="text-xs text-slate-500">Брутто</div><div className="font-semibold">{grossValue}</div></div>
                    <div><div className="text-xs text-slate-500">Тара</div><div className="font-semibold">{tareValue}</div></div>
                    <div><div className="text-xs text-slate-500">Нетто</div><div className="font-semibold">{netValue}</div></div>
                    <div><div className="text-xs text-slate-500">Время</div><div className="font-semibold">{dt}</div></div>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">{t.ticket_no}</div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {canVoid && activeTicket ? (
        <Card>
          <CardHeader>
            <CardTitle>Admin cleanup зависшего талона</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 md:grid-cols-2">
            <Button variant="outline" onClick={() => handleAdminCleanup("force_close")}>
              Force close (admin-safe)
            </Button>
            <Button variant="outline" onClick={() => handleAdminCleanup("archive")}>
              Archive stuck ticket
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Sheet open={Boolean(activeTicket)} onOpenChange={(open) => !open && setActiveTicket(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          {activeTicket ? (
            <div className="space-y-4">
              <SheetHeader>
                <SheetTitle>Талон {activeTicket.ticket_no}</SheetTitle>
                <SheetDescription>{operationUiLabel(activeTicket.op_type)}</SheetDescription>
              </SheetHeader>

              <div className="mx-auto w-full max-w-[540px] min-h-[960px] rounded-md border bg-[#f7f1e3] p-4 text-[#1f1b16]" style={{ boxShadow: "inset 0 0 40px rgba(80,56,30,0.08)" }}>
                <div className="mb-3 border-b border-[#b8a788] pb-2 text-center">
                  <div className="text-sm font-semibold tracking-wide">ТОО “АСТЫК-STEM”</div>
                  <div className="mt-1 text-3xl font-black">ВЕСОВОЙ ТАЛОН</div>
                  <div className="mt-1 text-lg font-bold">в„– {activeTicket.ticket_no}</div>
                </div>

                <div className="mb-3 grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-[#5d4f3d]">Тип операции:</span> <span className="font-bold">{operationUiLabel(activeTicket.op_type)}</span></div>
                  <div><span className="text-[#5d4f3d]">Поле:</span> <span className="font-semibold">{fields.find((f) => f.id === activeTicket.field_id)?.name || "-"}</span></div>
                  <div><span className="text-[#5d4f3d]">Культура:</span> <span className="font-semibold">{activeLine?.product_name || "-"}</span></div>
                  <div><span className="text-[#5d4f3d]">Склад:</span> <span className="font-semibold">{warehouses.find((w) => w.id === activeTicket.warehouse_to_id)?.name || warehouses.find((w) => w.id === activeTicket.warehouse_from_id)?.name || "-"}</span></div>
                  <div><span className="text-[#5d4f3d]">Сорт:</span> <span className="font-semibold">{activeLine?.variety_name || varieties.find((v) => v.id === activeLine?.variety_id)?.name || "-"}</span></div>
                  <div><span className="text-[#5d4f3d]">Посевная строка:</span> <span className="font-semibold">{ticketAllocationLabel(activeTicket)}</span></div>
                  <div><span className="text-[#5d4f3d]">Репродукция:</span> <span className="font-semibold">{activeLine?.reproduction_name || reproductions.find((r) => r.id === activeLine?.reproduction_id)?.name || "-"}</span></div>
                  <div />
                </div>

                <div className="mb-3 rounded border border-[#b8a788] p-3 text-sm">
                  <div className="mb-2 text-center text-lg font-bold">ТРАНСПОРТ И ВОДИТЕЛЬ</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><span className="text-[#5d4f3d]">Машина:</span> <span className="font-bold">{activeVehicle?.name || "-"}</span></div>
                    <div><span className="text-[#5d4f3d]">Водитель:</span> <span className="font-bold">{activeDriver?.name || "-"}</span></div>
                    <div><span className="text-[#5d4f3d]">Госномер:</span> <span className="font-semibold">{activeVehicle?.plate || "-"}</span></div>
                    <div />
                  </div>
                </div>

                <div className="mb-3 rounded border border-[#b8a788] p-3 text-sm">
                  <div className="mb-2 text-center text-lg font-bold">ВЕСОВЫЕ ДАННЫЕ</div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div><div className="text-xs text-[#5d4f3d]">Брутто</div><div className="text-xl font-bold">{activeTicket.gross_weight_kg ?? "-"} кг</div></div>
                    <div><div className="text-xs text-[#5d4f3d]">Тара</div><div className="text-xl font-bold">{activeTicket.tare_weight_kg ?? "-"} кг</div></div>
                    <div><div className="text-xs text-[#5d4f3d]">Нетто</div><div className="text-xl font-bold">{activeTicket.net_weight_kg ?? "-"} кг</div></div>
                  </div>
                </div>

                <div className="text-sm">
                  <div><span className="text-[#5d4f3d]">Статус:</span> <span className="font-semibold">{statusLabel(activeTicket.status)}</span></div>
                  <div><span className="text-[#5d4f3d]">Время взвешивания:</span> <span className="font-semibold">{fmt(activeTicket.finalized_at || activeTicket.updated_at || activeTicket.created_at, lang)}</span></div>
                  <div><span className="text-[#5d4f3d]">Создан:</span> <span className="font-semibold">{fmt(activeTicket.created_at, lang)}</span></div>
                  <div><span className="text-[#5d4f3d]">Весовщик:</span> <span className="font-semibold">{profile?.full_name?.trim() || profile?.email || "-"}</span></div>
                  <div><span className="text-[#5d4f3d]">Примечание:</span> <span className="font-semibold">{activeTicket.notes || "-"}</span></div>
                  <div><span className="text-[#5d4f3d]">ID:</span> <span className="font-semibold">{activeTicket.id}</span></div>
                </div>
              </div>

              <div className="rounded-md border p-3">
                <div className="space-y-2">
                  <Label>Брутто (кг)</Label>
                  <Input value={gross} readOnly className="bg-slate-50" />
                </div>
                <div className="mt-3 space-y-2">
                  <Label>Тара (кг)</Label>
                  <Input value={closingTare} onChange={(e) => setClosingTare(e.target.value)} />
                </div>
                <div className="mt-3 rounded-md border bg-slate-50 p-3 text-sm">
                  <div className="flex items-center justify-between"><span>Брутто</span><span>{gross || "-"}</span></div>
                  <div className="flex items-center justify-between"><span>Тара</span><span>{closingTare || "-"}</span></div>
                  <div className="my-2 border-t" />
                  <div className="flex items-center justify-between font-semibold"><span>Чистый вес (нетто)</span><span>{pure == null ? "-" : pure.toFixed(3)}</span></div>
                  <div className="mt-2 text-xs text-slate-500">Формула: net = gross - tare</div>
                  {pure != null && pure <= 0 ? <div className="mt-2 text-xs text-red-600">Ошибка: тара не может быть больше или равна брутто</div> : null}
                </div>
              </div>

              {canOperate ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" onClick={async () => { if (!profile?.id) return; try { await downloadTicketPdf(activeTicket.id, profile.id); } catch (error: any) { toast({ title: "Ошибка PDF", description: error?.message || "Не удалось скачать PDF", variant: "destructive" }); } }}>
                      <FileDown className="mr-2 h-4 w-4" />Скачать PDF
                    </Button>
                    <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={closeTicket} disabled={finalizing || (pure != null && pure <= 0)}>
                      <CheckCircle2 className="mr-2 h-4 w-4" />{finalizing ? "Закрытие..." : "Закрыть талон"}
                    </Button>
                  </div>
                  {canVoid ? (
                    <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3">
                      <Label>Причина аннулирования</Label>
                      <Textarea value={voidReason} onChange={(e) => setVoidReason(e.target.value)} rows={2} />
                      <Button variant="destructive" className="w-full" onClick={handleVoid} disabled={voiding}>
                        <Trash2 className="mr-2 h-4 w-4" />{voiding ? "Аннулирование..." : "Аннулировать талон"}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
      <Sheet open={Boolean(historyPreviewTicket)} onOpenChange={(open) => !open && setHistoryPreviewTicket(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          {historyPreviewTicket ? (
            <div className="space-y-4">
              <SheetHeader>
                <SheetTitle>Талон {historyPreviewTicket.ticket_no}</SheetTitle>
                <SheetDescription>{operationUiLabel(historyPreviewTicket.op_type)}</SheetDescription>
              </SheetHeader>
              <div className="mx-auto w-full max-w-[540px] min-h-[960px] rounded-md border bg-[#f7f1e3] p-4 text-[#1f1b16]" style={{ boxShadow: "inset 0 0 40px rgba(80,56,30,0.08)" }}>
                <div className="mb-3 border-b border-[#b8a788] pb-2 text-center">
                  <div className="text-sm font-semibold tracking-wide">ТОО “АСТЫК-STEM”</div>
                  <div className="mt-1 text-3xl font-black">ВЕСОВОЙ ТАЛОН</div>
                  <div className="mt-1 text-lg font-bold">в„– {historyPreviewTicket.ticket_no}</div>
                </div>
                <div className="mb-3 grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-[#5d4f3d]">Статус:</span> <span className="font-bold">{statusLabel(historyPreviewTicket.status).toUpperCase()}</span></div>
                  <div><span className="text-[#5d4f3d]">Тип операции:</span> <span className="font-bold">{operationUiLabel(historyPreviewTicket.op_type)}</span></div>
                  <div><span className="text-[#5d4f3d]">Поле:</span> <span className="font-semibold">{fields.find((f) => f.id === historyPreviewTicket.field_id)?.name || "-"}</span></div>
                  <div><span className="text-[#5d4f3d]">Склад:</span> <span className="font-semibold">{warehouses.find((w) => w.id === historyPreviewTicket.warehouse_to_id)?.name || warehouses.find((w) => w.id === historyPreviewTicket.warehouse_from_id)?.name || "-"}</span></div>
                  <div><span className="text-[#5d4f3d]">Культура:</span> <span className="font-semibold">{historyPreviewTicket.lines?.[0]?.product_name || "-"}</span></div>
                  <div><span className="text-[#5d4f3d]">Посевная строка:</span> <span className="font-semibold">{ticketAllocationLabel(historyPreviewTicket)}</span></div>
                  <div><span className="text-[#5d4f3d]">Сорт:</span> <span className="font-semibold">{historyPreviewTicket.lines?.[0]?.variety_name || varieties.find((v) => v.id === historyPreviewTicket.lines?.[0]?.variety_id)?.name || "-"}</span></div>
                  <div><span className="text-[#5d4f3d]">Репродукция:</span> <span className="font-semibold">{historyPreviewTicket.lines?.[0]?.reproduction_name || reproductions.find((r) => r.id === historyPreviewTicket.lines?.[0]?.reproduction_id)?.name || "-"}</span></div>
                </div>
                <div className="mb-3 rounded border border-[#b8a788] p-3 text-sm">
                  <div className="mb-2 text-center text-lg font-bold">ТРАНСПОРТ И ВОДИТЕЛЬ</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><span className="text-[#5d4f3d]">Машина:</span> <span className="font-bold">{vehicles.find((v) => v.id === historyPreviewTicket.vehicle_id)?.name || "-"}</span></div>
                    <div><span className="text-[#5d4f3d]">Водитель:</span> <span className="font-bold">{drivers.find((d) => d.id === historyPreviewTicket.driver_id)?.name || "-"}</span></div>
                    <div><span className="text-[#5d4f3d]">Госномер:</span> <span className="font-semibold">{vehicles.find((v) => v.id === historyPreviewTicket.vehicle_id)?.plate || "-"}</span></div>
                    <div />
                  </div>
                </div>
                <div className="mb-3 rounded border border-[#b8a788] p-2 text-sm">
                  <div className="mb-2 text-center text-lg font-bold">ВЕСОВЫЕ ДАННЫЕ</div>
                  <div className="grid grid-cols-3 gap-2">
                    <div><div className="text-xs text-[#5d4f3d]">Брутто</div><div className="text-xl font-bold">{historyPreviewTicket.gross_weight_kg ?? "-"} кг</div></div>
                    <div><div className="text-xs text-[#5d4f3d]">Тара</div><div className="text-xl font-bold">{historyPreviewTicket.tare_weight_kg ?? "-"} кг</div></div>
                    <div><div className="text-xs text-[#5d4f3d]">Нетто</div><div className="text-xl font-bold">{historyPreviewTicket.net_weight_kg ?? "-"} кг</div></div>
                  </div>
                </div>
                <div className="text-sm">
                  <div><span className="text-[#5d4f3d]">Время взвешивания:</span> <span className="font-semibold">{fmt(historyPreviewTicket.finalized_at || historyPreviewTicket.updated_at || historyPreviewTicket.created_at, lang)}</span></div>
                  <div><span className="text-[#5d4f3d]">Создан:</span> <span className="font-semibold">{fmt(historyPreviewTicket.created_at, lang)}</span></div>
                  <div><span className="text-[#5d4f3d]">Весовщик:</span> <span className="font-semibold">{profile?.full_name?.trim() || profile?.email || "-"}</span></div>
                  <div><span className="text-[#5d4f3d]">Примечание:</span> <span className="font-semibold">{historyPreviewTicket.notes || "-"}</span></div>
                  <div><span className="text-[#5d4f3d]">ID:</span> <span className="font-semibold">{historyPreviewTicket.id}</span></div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button variant="outline" onClick={async () => { if (!profile?.id || !historyPreviewTicket) return; try { await downloadTicketPdf(historyPreviewTicket.id, profile.id); } catch (error: any) { toast({ title: "Ошибка PDF", description: error?.message || "Не удалось скачать PDF", variant: "destructive" }); } }}><FileDown className="mr-1 h-4 w-4" />Скачать PDF</Button>
                <Button onClick={() => setHistoryPreviewTicket(null)}>Закрыть</Button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
      <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!open) resolveConfirm(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmBusy} onClick={() => resolveConfirm(false)}>Отмена</AlertDialogCancel>
            <AlertDialogAction disabled={confirmBusy} onClick={() => resolveConfirm(true)}>
              {confirmBusy ? "Подтверждение..." : confirmActionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

