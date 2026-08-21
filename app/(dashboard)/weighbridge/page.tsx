"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ClipboardList, Clock3, FileDown, Info, Loader2, LockKeyhole, MoreHorizontal, Pencil, Scale, Trash2, UserRound } from "lucide-react";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { LIVE_REFRESH_TABLES, useLiveRefresh } from "@/hooks/use-live-refresh";
import { useLanguage } from "@/lib/contexts/language-context";
import { brandName, localizedName } from "@/lib/i18n/helpers";
import { supabase } from "@/lib/supabase/client";
import { buildClientAuthHeaders } from "@/lib/supabase/client-auth";
import { adminTicketAction, changeActiveHarvestRouteContext, closeShift, createActiveHarvestRoute, createTicket, downloadTicketPdf, finalizeTicket, getTicketDetails, getWeighbridgeBootstrap, getWeighbridgeOperatorState, getWeighbridgeResources, getWeighbridgeTransportPickerData, handoverWeighbridgeOperator, listActiveHarvestRoutes, listHarvestBatchSummaries, listTickets, lockWeighbridgeOperator, patchTicket, startTicketCorrection, unlockWeighbridgeOperator, updateActiveHarvestRoute, voidTicket, type ActiveHarvestRouteList } from "@/lib/services/weighbridge";
import type { ActiveHarvestRoute, HarvestBatchSummary, TicketDirection, TicketInput, TicketLineInput, WeighbridgeOperatorState, WeighbridgeTicket } from "@/lib/types/weighbridge";
import { hasQaDataMarker } from "@/lib/utils/qa-data";
import {
  isHarvestDestinationPlace,
  storagePlaceTypeGroupLabel,
  storagePlaceTypeLabel,
  storagePlaceTypeSortOrder,
} from "@/lib/warehouse/warehouse-scope";
import { createWarehouseTransfer } from "@/lib/services/warehouses";
import { isWeighedFieldMaterial, isWeighedSupplierProduct } from "@/lib/weighbridge/product-rules";
import { dedupeProductsForSelect } from "@/lib/catalog/catalog-identity";
import { automaticHarvestAllocation, validateHarvestWeights } from "@/lib/weighbridge/harvest-contract";
import type { WeighbridgePersonnelRole } from "@/lib/weighbridge/personnel";
import { SearchableCombobox, type SearchableComboboxOption } from "@/components/weighbridge/searchable-combobox";
import { WeighbridgeTicketPaper, type WeighbridgeTicketPaperLabels } from "@/components/weighbridge/weighbridge-ticket-paper";
import { weighbridgeHarvestDraftsStorageKey } from "@/lib/weighbridge/fast-repeat";
import { formatWeightKg, formatWeightNumber } from "@/lib/weighbridge/weight-format";
import { parseStrictWeightKg } from "@/lib/weighbridge/weight-input";
import { HarvestAllocationPicker } from "@/components/weighbridge/active-harvest-tabs";
import { UniversalWorkspaceTabs, type UniversalWorkspaceTab } from "@/components/weighbridge/universal-workspace-tabs";
import { TransportDriverSelects } from "@/components/weighbridge/transport-driver-picker";
import type { WeighbridgeTransportPickerData } from "@/lib/weighbridge/transport-pairing";
import {
  UNIVERSAL_WORKSPACE_MAX_TABS,
  UNIVERSAL_WORKSPACE_SCHEMA_VERSION,
  createUniversalWorkspace,
  getWeighbridgeWorkstationId,
  isUniversalWorkspaceDirty,
  migrateLegacyHarvestWorkspaces,
  parseUniversalWorkspaceState,
  serializeUniversalWorkspaceState,
  universalWorkspaceStorageKey,
  type UniversalWeighbridgeWorkspace,
  type UniversalWorkspaceOperationType,
} from "@/lib/weighbridge/universal-workspaces";

type Lang = "ru" | "kz" | "en";
type OperationType = "harvest_incoming" | "supplier_receipt" | "issue_to_field" | "transfer_between_warehouses" | "shipment_outbound" | "disposal_writeoff" | "impurity_removal" | "drying";
type MovementGroup = "warehouse_inbound" | "field_issue" | "internal_transfer" | "shipment" | "writeoff" | "impurities";
type Option = { id: string; name: string };
type WarehouseOption = Option & { warehouseType: string; placeType: string };
type VehicleOption = Option & {
  model: string;
  plate: string;
  type: string;
  fleetType: string;
  transportCategory: string;
  source: "reference_vehicles" | "reference_machines";
  primaryPersonnelId: string | null;
  searchTerms: string[];
};
type DriverOption = Option & {
  machineId: string | null;
  roleType: WeighbridgePersonnelRole;
  position: string;
  department: string;
  assignedVehicleIds: string[];
};
type SupplierOption = Option & { source?: "counterparty" | "global_supplier"; globalSupplierId?: string };
type SupplierReceiptLineDraft = {
  localId: string;
  productId: string;
  quantityKg: string;
  uom: string;
  warehouseToId: string;
  supplierLot: string;
  unitPrice: string;
  notes: string;
};
type LinkedOperationOption = {
  id: string;
  field_id: string | null;
  category_slug: string | null;
  type_slug: string | null;
  status: string | null;
  label: string;
};
type LinkedOperationLineOption = {
  id: string;
  operation_id: string;
  variety_id: string | null;
  reproduction_id: string | null;
  label: string;
};
type LocalizedRef = {
  id: string;
  name?: string | null;
  name_ru?: string | null;
  name_kz?: string | null;
  name_en?: string | null;
};
type ProductOption = Option & {
  type?: string;
  productType?: string;
  unit?: string;
  defaultUnit?: string;
  baseUom?: string;
  packUom?: string;
  packageUnit?: string;
  productForm?: string;
  formulation?: string;
  category?: string;
  subcategory?: string;
  stockUnit?: string;
  physicalState?: string;
  isSeedMaterial?: boolean;
  cropId?: string | null;
  varietyId?: string | null;
  reproductionId?: string | null;
};
type StockIdentityOption = {
  key: string;
  source_kind?: "aggregate_harvest_lot" | "exact_stock_identity";
  harvest_lot_id?: string | null;
  crop_id?: string | null;
  composition_snapshot?: Array<Record<string, unknown>>;
  composition_hash?: string | null;
  is_mixed_harvest?: boolean;
  source_physical_state?: string | null;
  trip_count?: number | null;
  product_id: string;
  product_name: string;
  variety_id: string | null;
  variety_name: string;
  reproduction_id: string | null;
  reproduction_name: string;
  batch_id: string | null;
  batch_class: string;
  batch_class_label: string;
  uom: string;
  is_legacy_invalid?: boolean;
  product_type?: string;
  stock_unit?: string;
  physical_state?: string;
  is_seed_material?: boolean;
  quantity: number;
  label: string;
};
type SupplierReceiptMode = "weighbridge" | "direct";
type SupplierItemMode = "generic" | "agro_identity";
type TransferMode = "weighbridge" | "direct";
type FieldIssueMode = "weighbridge" | "direct";
type FieldMaterialCategory = "seed_planting_material" | "fertilizer" | "organic" | "other";
type DisposalCategory = "utilization" | "spoilage" | "shortage" | "waste" | "other_removal";
type ImpurityType = "soil_and_trash" | "nonconforming_crop" | "plant_residues" | "other";
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
type HarvestContextState = {
  status: "idle" | "loading" | "ready" | "missing" | "ambiguous" | "invalid" | "error";
  message: string;
  harvestedMassKg: number;
  harvestedAreaHa: number;
  yieldTPerHa: number | null;
  yieldStatus: "not_available" | "preliminary" | "final";
};
type HarvestAggregate = {
  netKg: number;
  trips: number;
  averageTripKg: number;
  averageMoisture: number | null;
};
type HarvestSummaryState = {
  seasonId: string | null;
  today: HarvestAggregate;
  byField: Record<string, { today: HarvestAggregate; cumulative: HarvestAggregate }>;
};

const EMPTY_HARVEST_AGGREGATE: HarvestAggregate = {
  netKg: 0,
  trips: 0,
  averageTripKg: 0,
  averageMoisture: null,
};

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
  sourceBatchId: string;
  impurityType: ImpurityType;
  linkedOperationId: string;
  linkedOperationLineId: string;
  quantityKg: string;
  quantityUom: string;
  unitPrice: string;
  dryingOutputKg: string;
  moistureIn: string;
  moistureOut: string;
  grossKg: string;
  harvestMoisture: string;
  vehicleId: string;
  driverId: string;
  disposalCategory: DisposalCategory;
  disposalReason: string;
  notes: string;
};

type WeighbridgeWorkspace = UniversalWeighbridgeWorkspace<FormState, SupplierReceiptLineDraft>;

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
  sourceBatchId: "",
  impurityType: "soil_and_trash",
  linkedOperationId: "",
  linkedOperationLineId: "",
  quantityKg: "",
  quantityUom: "",
  unitPrice: "",
  dryingOutputKg: "",
  moistureIn: "",
  moistureOut: "",
  grossKg: "",
  harvestMoisture: "",
  vehicleId: "",
  driverId: "",
  disposalCategory: "utilization",
  disposalReason: "",
  notes: "",
};

const createEmptyWorkspace = (
  operationType: UniversalWorkspaceOperationType = "harvest_incoming",
  id?: string
) => createUniversalWorkspace<FormState, SupplierReceiptLineDraft>(
  INITIAL_FORM,
  operationType,
  id
);

const createSupplierReceiptLineDraft = (warehouseToId = ""): SupplierReceiptLineDraft => ({
  localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  productId: "",
  quantityKg: "",
  uom: "",
  warehouseToId,
  supplierLot: "",
  unitPrice: "",
  notes: "",
});

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
const lotLabel = (lotId?: string | null) => {
  const value = String(lotId || "").trim();
  if (!value) return "";
  return /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value) ? `#${value.slice(0, 8)}` : value;
};
const harvestIdentityLabel = (...parts: Array<string | null | undefined>) =>
  parts.map((part) => String(part || "").trim()).filter(Boolean).join(" / ");
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
const OPERATION_GROUP: Partial<Record<OperationType, MovementGroup>> = {
  harvest_incoming: "warehouse_inbound",
  supplier_receipt: "warehouse_inbound",
  issue_to_field: "field_issue",
  transfer_between_warehouses: "internal_transfer",
  shipment_outbound: "shipment",
  disposal_writeoff: "writeoff",
  impurity_removal: "impurities",
};

const WEIGHBRIDGE_MODES: Array<{ type: OperationType; label: string }> = [
  { type: "harvest_incoming", label: "Урожай с поля" },
  { type: "supplier_receipt", label: "От контрагента" },
  { type: "issue_to_field", label: "Выдача в поле" },
  { type: "transfer_between_warehouses", label: "Перемещение" },
  { type: "shipment_outbound", label: "Отгрузка" },
  { type: "disposal_writeoff", label: "Списание" },
  { type: "impurity_removal", label: "Примеси" },
];

const movementGroupForOperation = (operationType: OperationType): MovementGroup =>
  OPERATION_GROUP[operationType] || "warehouse_inbound";

const opMeta = (type: OperationType) => {
  if (type === "harvest_incoming") return { title: "Урожай с поля", ticketType: "harvest", opType: "harvest_incoming", direction: "incoming" as TicketDirection, sourceKind: "field", destinationKind: "warehouse" };
  if (type === "supplier_receipt") return { title: "Поставка от контрагента", ticketType: "receipt", opType: "supplier_receipt", direction: "incoming" as TicketDirection, sourceKind: "supplier", destinationKind: "warehouse" };
  if (type === "issue_to_field") return { title: "Выдача в поле", ticketType: "issue", opType: "issue_to_field", direction: "outgoing" as TicketDirection, sourceKind: "warehouse", destinationKind: "field" };
  if (type === "transfer_between_warehouses") return { title: "Склад → склад", ticketType: "transfer", opType: "warehouse_transfer", direction: "transfer" as TicketDirection, sourceKind: "warehouse", destinationKind: "warehouse" };
  if (type === "shipment_outbound") return { title: "Отгрузка", ticketType: "shipment", opType: "shipment_outbound", direction: "outgoing" as TicketDirection, sourceKind: "warehouse", destinationKind: "counterparty" };
  if (type === "disposal_writeoff") return { title: "Списание / выбытие", ticketType: "disposal", opType: "disposal", direction: "outgoing" as TicketDirection, sourceKind: "warehouse", destinationKind: "disposal" };
  if (type === "impurity_removal") return { title: "Вывоз примесей", ticketType: "impurity_removal", opType: "weighbridge_impurities", direction: "outgoing" as TicketDirection, sourceKind: "warehouse", destinationKind: "impurity_removal" };
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

const ticketCompanyLabel = (ticket: WeighbridgeTicket | null | undefined) =>
  String(ticket?.company_name || "").trim() || "Компания";

const operationUiLabel = (opType: string) => {
  if (opType === "harvest_incoming") return "Урожай";
  if (opType === "supplier_receipt") return "Поставка от контрагента";
  if (opType === "issue_to_field") return "Выдача в поле";
  if (opType === "warehouse_transfer") return "Склад → склад";
  if (opType === "shipment_outbound") return "Отгрузка";
  if (opType === "disposal") return "Списание";
  if (opType === "weighbridge_impurities") return "Вывоз примесей";
  if (opType === "drying") return "Сушка";
  return opType || "Операция";
};

const fieldMaterialCategoryLabels: Record<FieldMaterialCategory, string> = {
  seed_planting_material: "Семена / посадочный материал",
  fertilizer: "Удобрения",
  organic: "Органика",
  other: "Прочие сыпучие материалы",
};

const disposalCategoryLabels: Record<DisposalCategory, string> = {
  utilization: "Утилизация",
  spoilage: "Порча",
  shortage: "Недостача",
  waste: "Отходы",
  other_removal: "Прочий вывоз",
};

const impurityTypeLabels: Record<ImpurityType, string> = {
  soil_and_trash: "Земля и мусор",
  nonconforming_crop: "Некондиционный урожай",
  plant_residues: "Растительные остатки",
  other: "Прочее",
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
  if (category === "organic") return hay.includes("навоз") || hay.includes("компост") || hay.includes("орган") || hay.includes("biomass") || hay.includes("биомас");
  return isWeighedFieldMaterial({
    productType: item.product_type,
    stockUnit: item.stock_unit || item.uom,
    physicalState: item.physical_state,
    isSeedMaterial: item.is_seed_material,
  });
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
const normalizeUnit = (value: string | null | undefined) => {
  const unit = String(value || "").trim().toLowerCase().replace(/\.$/, "");
  if (!unit) return "";
  if (["kg", "кг", "kilogram", "kilograms", "килограмм", "килограмма", "килограммы", "килограммов"].includes(unit)) return "kg";
  if (["g", "гр", "г", "gram", "grams", "грамм", "грамма", "граммы", "граммов"].includes(unit)) return "g";
  if (["l", "л", "liter", "litre", "liters", "litres", "литр", "литра", "литры", "литров"].includes(unit)) return "l";
  if (["m", "м", "meter", "metre", "meters", "metres", "метр", "метра", "метры", "метров"].includes(unit)) return "m";
  if (["roll", "rolls", "бухта", "бухты"].includes(unit)) return "roll";
  if (["pcs", "pc", "шт", "штука", "штук"].includes(unit)) return "pcs";
  if (["pack", "package", "уп", "упак", "упаковка"].includes(unit)) return "pack";
  return unit;
};
const unitLabel = (unit: string | null | undefined) => {
  const normalized = normalizeUnit(unit);
  if (normalized === "kg") return "кг";
  if (normalized === "g") return "г";
  if (normalized === "l") return "л";
  if (normalized === "m") return "м";
  if (normalized === "roll") return "бухта";
  if (normalized === "pcs") return "шт";
  if (normalized === "pack") return "уп.";
  return normalized || "ед.";
};
const inferProductUnit = (product: ProductOption | null | undefined) => {
  if (!product) return "";
  const explicit = normalizeUnit(product.unit || product.defaultUnit || product.baseUom || product.packUom || product.packageUnit);
  if (explicit) return explicit;
  const hay = [
    product.name,
    product.type,
    product.productType,
    product.productForm,
    product.formulation,
    product.category,
    product.subcategory,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!hay.trim()) return "";
  if (hay.includes("капель") || hay.includes("drip tape") || hay.includes("лента")) return "m";
  if (hay.includes("liquid") || hay.includes("жид") || hay.includes("концентрат") || /\b(ec|кэ|вр|sc|sl|se|кс)\b/i.test(hay)) return "l";
  if (hay.includes("granule") || hay.includes("гранул") || hay.includes("порош") || hay.includes("fertilizer") || hay.includes("удобр") || /\b(wg|вдг|вг)\b/i.test(hay)) return "kg";
  if (hay.includes("seed") || hay.includes("семен") || hay.includes("семенной картофель")) return "kg";
  return "";
};
const formatQuantityWithUnit = (quantity: unknown, unit?: string | null) => {
  const formatted = formatWeightNumber(quantity, "-");
  return formatted === "-" ? formatted : `${formatted} ${unitLabel(unit)}`;
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
const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
};

const weighbridgePageCache = new Map<string, Record<string, unknown>>();
const activeHarvestRouteCache = new Map<string, ActiveHarvestRouteList>();
const transportPickerDataCache = new Map<string, WeighbridgeTransportPickerData>();
const transportPickerRequestCache = new Map<string, Promise<WeighbridgeTransportPickerData>>();
const harvestContextCache = new Map<string, HarvestContextState>();
const harvestContextRequestCache = new Map<string, Promise<HarvestContextState>>();
const WEIGHBRIDGE_WORKSPACE_CACHE_VERSION = 2;
const WEIGHBRIDGE_WORKSPACE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

const workspaceCacheKey = (companyId: string, profileId: string, language: string) =>
  `travkin.weighbridge.workspace.v${WEIGHBRIDGE_WORKSPACE_CACHE_VERSION}.${companyId}.${profileId}.${language}`;

const legacySessionCacheKey = (companyId: string, language: string) =>
  `travkin.weighbridge.workspace.v1.${companyId}.${language}`;

function readWeighbridgeWorkspaceCache(companyId: string, profileId: string, language: string) {
  if (typeof window === "undefined") return null;
  try {
    const key = workspaceCacheKey(companyId, profileId, language);
    const localRaw = window.localStorage.getItem(key);
    const legacyKey = legacySessionCacheKey(companyId, language);
    const raw = localRaw || window.sessionStorage.getItem(legacyKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: number; payload?: Record<string, unknown> };
    if (!parsed.savedAt || Date.now() - parsed.savedAt > WEIGHBRIDGE_WORKSPACE_CACHE_TTL_MS || !parsed.payload) {
      window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(legacyKey);
      return null;
    }
    if (!localRaw) {
      window.localStorage.setItem(key, raw);
      window.sessionStorage.removeItem(legacyKey);
    }
    return parsed.payload;
  } catch {
    return null;
  }
}

function writeWeighbridgeWorkspaceCache(
  companyId: string,
  profileId: string,
  language: string,
  payload: Record<string, unknown>
) {
  if (typeof window === "undefined") return;
  const write = () => {
    try {
      window.localStorage.setItem(
        workspaceCacheKey(companyId, profileId, language),
        JSON.stringify({ savedAt: Date.now(), payload })
      );
    } catch {
      // Browser storage is an acceleration layer only; canonical data is reconciled in the background.
    }
  };
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(write, { timeout: 1000 });
  } else {
    setTimeout(write, 0);
  }
}

const harvestContextCacheKey = (
  companyId: string,
  fieldId: string,
  allocationId: string,
  revision: string
) => `${companyId}:${fieldId}:${allocationId}:${revision}`;

const loadHarvestContextCached = async (params: {
  companyId: string;
  fieldId: string;
  allocationId: string;
  revision: string;
}): Promise<HarvestContextState> => {
  const key = harvestContextCacheKey(
    params.companyId,
    params.fieldId,
    params.allocationId,
    params.revision
  );
  const cached = harvestContextCache.get(key);
  if (cached) return cached;
  const pending = harvestContextRequestCache.get(key);
  if (pending) return pending;

  const request = (async () => {
    const headers = await buildClientAuthHeaders("none");
    const query = new URLSearchParams({
      fieldId: params.fieldId,
      allocationId: params.allocationId,
    });
    const response = await fetch(`/api/weighbridge/harvest-context?${query.toString()}`, {
      headers,
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(payload?.error || "Не удалось определить уборку"));
    const context: HarvestContextState = {
      status: payload.status,
      message: String(payload.message || ""),
      harvestedMassKg: Number(payload.harvestedMassKg || 0),
      harvestedAreaHa: Number(payload.harvestedAreaHa || 0),
      yieldTPerHa: payload.yieldTPerHa == null ? null : Number(payload.yieldTPerHa),
      yieldStatus: payload.yieldStatus || "not_available",
    };
    harvestContextCache.set(key, context);
    return context;
  })().finally(() => {
    harvestContextRequestCache.delete(key);
  });
  harvestContextRequestCache.set(key, request);
  return request;
};

const emptyTransportPickerData = (): WeighbridgeTransportPickerData => ({
  seasonId: null,
  operationalDayStartHour: 7,
  recentPairs: [],
  latestDriverByVehicle: {},
  latestVehicleByDriver: {},
  openAssignments: [],
  fetchedAt: "",
});

const loadTransportPickerDataCached = async (
  companyId: string,
  force = false,
  signal?: AbortSignal
): Promise<WeighbridgeTransportPickerData> => {
  const pending = transportPickerRequestCache.get(companyId);
  // A request tied to an aborted page lifecycle must not block a fresh mount.
  if (pending && !signal) return pending;
  if (!force) {
    const cached = transportPickerDataCache.get(companyId);
    if (cached) return cached;
  }
  const request = getWeighbridgeTransportPickerData(companyId, { signal })
    .then((payload) => {
      transportPickerDataCache.set(companyId, payload);
      return payload;
    })
    .finally(() => {
      if (transportPickerRequestCache.get(companyId) === request) {
        transportPickerRequestCache.delete(companyId);
      }
    });
  transportPickerRequestCache.set(companyId, request);
  return request;
};

export default function WeighbridgeOperationsPage() {
  const { profile, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const { language } = useLanguage();
  const lang = getLang(language);

  const [loading, setLoading] = useState(true);
  const [coreDataReady, setCoreDataReady] = useState(false);
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const createTicketIdempotencyRef = useRef<string | null>(null);
  const finalizeTicketIdempotencyRef = useRef<{ ticketId: string; key: string } | null>(null);
  const finalizingRef = useRef(false);
  const [finalizing, setFinalizing] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [supplierReceiptLines, setSupplierReceiptLines] = useState<SupplierReceiptLineDraft[]>([]);
  const [showSupplierExtraFields, setShowSupplierExtraFields] = useState(false);
  const [tickets, setTickets] = useState<WeighbridgeTicket[]>([]);
  const [harvestBatches, setHarvestBatches] = useState<HarvestBatchSummary[]>([]);
  const [fields, setFields] = useState<{ id: string; name: string; area: number }[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [buyers, setBuyers] = useState<Option[]>([]);
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [trailers, setTrailers] = useState<VehicleOption[]>([]);
  const [processingPoints, setProcessingPoints] = useState<Option[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [stockIdentityOptions, setStockIdentityOptions] = useState<StockIdentityOption[]>([]);
  const [linkedOperations, setLinkedOperations] = useState<LinkedOperationOption[]>([]);
  const [linkedOperationLines, setLinkedOperationLines] = useState<LinkedOperationLineOption[]>([]);
  const [linkedOperationLinesLoading, setLinkedOperationLinesLoading] = useState(false);
  const [stockIdentityLoading, setStockIdentityLoading] = useState(false);
  const [crops, setCrops] = useState<Option[]>([]);
  const [varieties, setVarieties] = useState<{ id: string; name: string; cropId: string; cropName: string }[]>([]);
  const [reproductions, setReproductions] = useState<Option[]>([]);
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [driverNames, setDriverNames] = useState<Record<string, string>>({});
  const [coreResourceErrors, setCoreResourceErrors] = useState<Array<{ code: string; message: string }>>([]);
  const [transportPickerData, setTransportPickerData] = useState<WeighbridgeTransportPickerData>(emptyTransportPickerData);
  const [harvestStructureByField, setHarvestStructureByField] = useState<Record<string, HarvestStructureOption[]>>({});
  const [harvestIncompleteFields, setHarvestIncompleteFields] = useState<Record<string, boolean>>({});
  const [activeHarvests, setActiveHarvests] = useState<ActiveHarvestRoute[]>([]);
  const [completedHarvests, setCompletedHarvests] = useState<ActiveHarvestRoute[]>([]);
  const [activeHarvestSeasonId, setActiveHarvestSeasonId] = useState<string | null>(null);
  const [activeHarvestSeasonYear, setActiveHarvestSeasonYear] = useState<number | null>(null);
  const [selectedActiveHarvestId, setSelectedActiveHarvestId] = useState("");
  const [activeHarvestBusy, setActiveHarvestBusy] = useState(false);
  const [workspaces, setWorkspaces] = useState<WeighbridgeWorkspace[]>([
    createEmptyWorkspace("harvest_incoming", "workspace-default"),
  ]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("workspace-default");
  const [workspaceHydratedKey, setWorkspaceHydratedKey] = useState("");
  const [workstationId, setWorkstationId] = useState("");
  const [pendingOpenTicket, setPendingOpenTicket] = useState<WeighbridgeTicket | null>(null);
  const [activeTicket, setActiveTicket] = useState<WeighbridgeTicket | null>(null);
  const [closingTare, setClosingTare] = useState("");
  const [closingMoisture, setClosingMoisture] = useState("");
  const [moistureSaving, setMoistureSaving] = useState(false);
  const [moistureSavedValue, setMoistureSavedValue] = useState("");
  const [suggestedFieldId, setSuggestedFieldId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidReasonOpen, setVoidReasonOpen] = useState(false);
  const [shiftHandoverNote, setShiftHandoverNote] = useState("");
  const [historyTypeFilter, setHistoryTypeFilter] = useState("all");
  const [activeShift, setActiveShift] = useState<any | null>(null);
  const [shiftCounters, setShiftCounters] = useState<{ activeTickets: number; stuckTickets: number; unsynced: number; requiresReview: number; manualCorrections: number }>({
    activeTickets: 0,
    stuckTickets: 0,
    unsynced: 0,
    requiresReview: 0,
    manualCorrections: 0,
  });
  const [shiftGuard, setShiftGuard] = useState<{ stale: boolean; ageHours: number }>({ stale: false, ageHours: 0 });
  const [shiftSummary, setShiftSummary] = useState<{ trips: number; netKg: number; open: number; voided: number; manualCorrections: number }>({
    trips: 0,
    netKg: 0,
    open: 0,
    voided: 0,
    manualCorrections: 0,
  });
  const [harvestSummary, setHarvestSummary] = useState<HarvestSummaryState>({
    seasonId: null,
    today: EMPTY_HARVEST_AGGREGATE,
    byField: {},
  });
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
  const [operatorState, setOperatorState] = useState<WeighbridgeOperatorState>({ shift: null, unlocked: false, operators: [] });
  const [operatorSessionStatus, setOperatorSessionStatus] = useState<"unknown" | "checking" | "ready" | "error">("checking");
  const [operatorDialogOpen, setOperatorDialogOpen] = useState(false);
  const [operatorDialogRequested, setOperatorDialogRequested] = useState(false);
  const [operatorPersonId, setOperatorPersonId] = useState("");
  const [operatorPin, setOperatorPin] = useState("");
  const [operatorError, setOperatorError] = useState("");
  const [operatorBusy, setOperatorBusy] = useState(false);
  const [harvestContext, setHarvestContext] = useState<HarvestContextState>({
    status: "idle",
    message: "Выберите поле.",
    harvestedMassKg: 0,
    harvestedAreaHa: 0,
    yieldTPerHa: null,
    yieldStatus: "not_available",
  });
  const [commentOpen, setCommentOpen] = useState(false);
  const [historyPreviewTicket, setHistoryPreviewTicket] = useState<WeighbridgeTicket | null>(null);
  const [openTicketEditOpen, setOpenTicketEditOpen] = useState(false);
  const [editGrossKg, setEditGrossKg] = useState("");
  const [editTareKg, setEditTareKg] = useState("");
  const [editReason, setEditReason] = useState("");
  const [ticketCorrectionOpen, setTicketCorrectionOpen] = useState(false);
  const [ticketCorrectionReason, setTicketCorrectionReason] = useState("");
  const [ticketCorrectionBusy, setTicketCorrectionBusy] = useState(false);
  const notificationDeepLinkHandledRef = useRef(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("Подтвердите действие");
  const [confirmDescription, setConfirmDescription] = useState("");
  const [confirmActionLabel, setConfirmActionLabel] = useState("Подтвердить");
  const confirmResolverRef = useRef<null | ((value: boolean) => void)>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const grossInputRef = useRef<HTMLInputElement | null>(null);
  const tareInputRef = useRef<HTMLInputElement | null>(null);
  const coreLoadRequestRef = useRef<Promise<void> | null>(null);
  const ticketsRequestRef = useRef<Promise<void> | null>(null);
  const bootstrapRequestRef = useRef<Promise<void> | null>(null);
  const bootstrapSummaryRequestRef = useRef<Promise<void> | null>(null);
  const operatorRequestRef = useRef<Promise<WeighbridgeOperatorState | undefined> | null>(null);
  const operatorRequestGenerationRef = useRef(0);
  const operatorRequestAbortRef = useRef<AbortController | null>(null);
  const operatorMutationGenerationRef = useRef(0);
  const operatorMutationInFlightRef = useRef(false);
  const operatorCanonicalStateRef = useRef<WeighbridgeOperatorState>({ shift: null, unlocked: false, operators: [] });
  const operatorUnlockConfirmedAtRef = useRef(0);
  const operatorContextKeyRef = useRef("");
  const secondaryCatalogRequestRef = useRef<Promise<void> | null>(null);
  const [statisticsOpen, setStatisticsOpen] = useState(false);
  const [secondaryCatalogsLoaded, setSecondaryCatalogsLoaded] = useState(false);

  const canOperate =
    profile?.role === "company_admin" ||
    profile?.role === "global_admin" ||
    profile?.role === "director" ||
    profile?.role === "warehouse" ||
    profile?.role === "warehouse_operator" ||
    profile?.role === "weighman";
  const canView = canOperate || profile?.role === "agronomist" || profile?.role === "specialist";
  const canVoid = profile?.role === "company_admin" || profile?.role === "global_admin" || profile?.role === "director";
  const canCorrectTicket = profile?.role === "company_admin" || profile?.role === "global_admin" || profile?.role === "director" || profile?.role === "weighman";
  const canUseInventory = ["company_admin", "global_admin", "warehouse", "warehouse_operator", "weighman"].includes(String(profile?.role || ""));
  const canUseOperatorSession = ["company_admin", "global_admin", "director", "weighman"].includes(String(profile?.role || ""));
  const eligibleOperators = useMemo(
    () => operatorState.operators.filter((operator) => operator.has_pin !== false && operator.pin_active !== false),
    [operatorState.operators]
  );
  const unconfiguredOperatorCount = Number(operatorState.unconfigured_operator_count || 0);
  const operatorGateBlocked = canUseOperatorSession && !operatorState.unlocked;
  const operatorGateChecking = operatorGateBlocked && (operatorSessionStatus === "unknown" || operatorSessionStatus === "checking");
  const canManageActiveHarvests =
    profile?.role === "global_admin" ||
    profile?.role === "company_admin" ||
    (profile?.role === "weighman" && Boolean(activeShift?.id) && operatorState.unlocked);
  const idempotencyPersistKey = useMemo(
    () => (profile?.company_id && selectedWorkspaceId
      ? `travkin.weighbridge.workspaceIdempotency.v1.${profile.company_id}.${selectedWorkspaceId}`
      : ""),
    [profile?.company_id, selectedWorkspaceId]
  );
  const legacyHarvestDraftPersistKey = useMemo(
    () => weighbridgeHarvestDraftsStorageKey(profile?.company_id, activeShift?.id),
    [profile?.company_id, activeShift?.id]
  );
  const universalWorkspacePersistKey = useMemo(
    () => universalWorkspaceStorageKey(
      profile?.company_id,
      activeHarvestSeasonId || activeHarvestSeasonYear,
      workstationId
    ),
    [profile?.company_id, activeHarvestSeasonId, activeHarvestSeasonYear, workstationId]
  );

  const loadSuppliers = async (companyId: string, signal?: AbortSignal) => {
    const headers = await getSessionAuthHeaders();
    const resp = await fetch(`/api/weighbridge/suppliers?companyId=${encodeURIComponent(companyId)}`, {
      cache: "no-store",
      headers,
      signal,
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(String(json?.error || "Не удалось загрузить поставщиков"));
    return (json?.suppliers || []) as SupplierOption[];

  };

  const loadBuyers = async (companyId: string, signal?: AbortSignal) => {
    const headers = await getSessionAuthHeaders();
    const response = await fetch(`/api/counterparties?companyId=${encodeURIComponent(companyId)}&type=buyer`, {
      cache: "no-store",
      headers,
      signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(payload?.error || "Не удалось загрузить покупателей"));
    return ((payload?.counterparties || []) as any[]).map((row) => ({ id: String(row.id), name: String(row.legal_name || row.name || "Покупатель") }));
  };

  const getSessionAuthHeaders = async () => {
    return buildClientAuthHeaders("none");
  };

  const resolveSupplierCounterparty = async (supplierId: string) => {
    if (!supplierId || !profile?.company_id) return supplierId;
    if (!supplierId.startsWith("global_supplier:")) return supplierId;

    const headers = await buildClientAuthHeaders("json");
    const resp = await fetch("/api/weighbridge/suppliers", {
      method: "POST",
      headers,
      body: JSON.stringify({ companyId: profile.company_id, supplierId }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(String(json?.error || "Не удалось подготовить поставщика"));

    const localSupplier = json?.supplier as SupplierOption | undefined;
    if (localSupplier?.id) {
      setSuppliers((prev) => {
        const next = prev.filter((item) => item.id !== supplierId && item.id !== localSupplier.id);
        next.push(localSupplier);
        return next.sort((a, b) => a.name.localeCompare(b.name, "ru"));
      });
    }

    return String(json?.supplierId || supplierId);
  };

  const loadMasterIdentityRefs = async (companyId: string, signal?: AbortSignal) => {
    const headers = await getSessionAuthHeaders();
    const resp = await fetch(
      `/api/weighbridge/master-identity?companyId=${encodeURIComponent(companyId)}`,
      { cache: "no-store", headers, signal }
    );
    const json = await resp.json();
    if (!resp.ok) throw new Error(String(json?.error || "Не удалось загрузить культуры, сорта и репродукции"));
    return {
      crops: (json?.crops || []) as any[],
      varieties: (json?.varieties || []) as any[],
      reproductions: (json?.reproductions || []) as any[],
    };
  };

  const loadHarvestAllocations = async (companyId: string, signal?: AbortSignal) => {
    const headers = await getSessionAuthHeaders();
    const response = await fetch(
      `/api/weighbridge/harvest-allocations?companyId=${encodeURIComponent(companyId)}`,
      { cache: "no-store", headers, signal }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(payload?.error || "Не удалось загрузить структуру урожая"));
    return payload;
  };

  const applyActiveHarvestRouteList = (payload: ActiveHarvestRouteList) => {
    setActiveHarvestSeasonId(payload.seasonId);
    setActiveHarvestSeasonYear(payload.seasonYear);
    setActiveHarvests(payload.active || []);
    setCompletedHarvests(payload.completed || []);
    if (profile?.company_id) activeHarvestRouteCache.set(profile.company_id, payload);
  };

  const refreshActiveHarvestRoutes = async () => {
    if (!profile?.company_id) return;
    const payload = await listActiveHarvestRoutes(profile.company_id);
    applyActiveHarvestRouteList(payload);
  };

  const applyTransportPickerData = (payload: WeighbridgeTransportPickerData) => {
    setTransportPickerData(payload);
    if (profile?.company_id) transportPickerDataCache.set(profile.company_id, payload);
  };

  const refreshTransportPickerData = async () => {
    if (!profile?.company_id) return;
    applyTransportPickerData(await loadTransportPickerDataCached(profile.company_id, true));
  };

  const loadSecondaryCatalogs = async (signal?: AbortSignal) => {
    if (!profile?.company_id || secondaryCatalogsLoaded) return;
    if (secondaryCatalogRequestRef.current) return secondaryCatalogRequestRef.current;

    const companyId = profile.company_id;
    const request = (async () => {
      const [productsRes, identityRefs, supplierRows, buyerRows, operationsRes] = await Promise.all([
        supabase
          .from("products")
          .select("id,name,trade_name,normalized_name,company_id,type,product_type,unit,default_unit,base_uom,pack_uom,package_unit,product_form,formulation,category,subcategory,stock_unit,physical_state,is_seed_material,crop_id,variety_id,seed_reproduction_id")
          .or(`company_id.eq.${companyId},company_id.is.null`)
          .eq("archived", false)
          .order("name")
          .abortSignal(signal || new AbortController().signal),
        loadMasterIdentityRefs(companyId, signal),
        loadSuppliers(companyId, signal),
        loadBuyers(companyId, signal),
        supabase
          .from("operations")
          .select("id,field_id,operation_type,operation_category_slug,operation_type_slug,date,status")
          .eq("company_id", companyId)
          .eq("archived", false)
          .order("date", { ascending: false })
          .limit(500)
          .abortSignal(signal || new AbortController().signal),
      ]);
      if (signal?.aborted) return;
      if (productsRes.error || operationsRes.error) {
        throw new Error(productsRes.error?.message || operationsRes.error?.message || "Не удалось загрузить вторичные справочники");
      }

      const dedupeByName = (rows: any[]) => {
        const map = new Map<string, any>();
        rows.forEach((row) => {
          const key = String(row.name || row.name_ru || row.id || "").trim().toLowerCase();
          if (!key) return;
          const existing = map.get(key);
          if (!existing || (existing.company_id == null && row.company_id != null)) map.set(key, row);
        });
        return Array.from(map.values());
      };
      const productRows = dedupeProductsForSelect(
        (productsRes.data || []).filter((row: any) =>
          !hasQaDataMarker(`${brandName(row) || row.name || ""} ${row.product_type || ""} ${row.type || ""}`)
        )
      );
      const cropRows = dedupeByName(
        (identityRefs.crops || []).filter((row: any) => !hasQaDataMarker(localizedName(row, lang, ["name"]) || row.name || ""))
      );
      const varietyRows = dedupeByName(((identityRefs.varieties || []) as any[]).filter(
        (row: any) => !hasQaDataMarker(brandName(row) || row.name || "")
      ));
      const reproductionRows = dedupeByName(((identityRefs.reproductions || []) as any[]).filter(
        (row: any) => !hasQaDataMarker(localizedName(row, lang, ["name"]) || row.name || "")
      ));
      const cropNameById = new Map<string, string>(
        cropRows.map((crop: any) => [String(crop.id), localizedName(crop, lang, ["name"]) || String(crop.name || "").trim()])
      );

      setProducts(productRows.map((row: any) => ({
        id: String(row.id), name: brandName(row) || String(row.name || "Номенклатура"),
        type: String(row.product_type || row.type || "").toLowerCase(), productType: String(row.product_type || ""),
        unit: String(row.unit || ""), defaultUnit: String(row.default_unit || ""), baseUom: String(row.base_uom || ""),
        packUom: String(row.pack_uom || ""), packageUnit: String(row.package_unit || ""), productForm: String(row.product_form || ""),
        formulation: String(row.formulation || ""), category: String(row.category || ""), subcategory: String(row.subcategory || ""),
        stockUnit: String(row.stock_unit || ""), physicalState: String(row.physical_state || ""), isSeedMaterial: row.is_seed_material === true,
        cropId: row.crop_id ? String(row.crop_id) : null, varietyId: row.variety_id ? String(row.variety_id) : null,
        reproductionId: row.seed_reproduction_id ? String(row.seed_reproduction_id) : null,
      })));
      setCrops(cropRows.map((row: any) => ({ id: String(row.id), name: localizedName(row, lang, ["name"]) || String(row.name || "Культура") })));
      setVarieties(varietyRows.map((row: any) => ({
        id: String(row.id), name: brandName(row) || String(row.name || "Сорт"), cropId: String(row.crop_id || ""),
        cropName: localizedName(row.crops, lang, ["name"]) || cropNameById.get(String(row.crop_id || "")) || "",
      })));
      setReproductions(reproductionRows.map((row: any) => ({
        id: String(row.id), name: localizedName(row, lang, ["name"]) || String(row.name || "Репродукция"),
      })));
      setSuppliers(supplierRows);
      setBuyers(buyerRows);
      const fieldNameById = new Map(fields.map((field) => [field.id, field.name]));
      setLinkedOperations((operationsRes.data || []).map((row: any) => {
        const fieldId = row.field_id ? String(row.field_id) : null;
        return {
          id: String(row.id), field_id: fieldId,
          category_slug: row.operation_category_slug ? String(row.operation_category_slug) : null,
          type_slug: row.operation_type_slug ? String(row.operation_type_slug) : null,
          status: row.status ? String(row.status) : null,
          label: `${row.operation_type || "Operation"} • ${fieldId ? fieldNameById.get(fieldId) || "Поле" : "Поле"} • ${row.date ? formatDate(String(row.date)) : "—"}`,
        };
      }).filter((row: any) => !hasQaDataMarker(row.label)));
      setLinkedOperationLines([]);
      setSecondaryCatalogsLoaded(true);
    })().finally(() => {
      if (secondaryCatalogRequestRef.current === request) secondaryCatalogRequestRef.current = null;
    });
    secondaryCatalogRequestRef.current = request;
    return request;
  };

  const load = async (signal?: AbortSignal, background = false) => {
    if (authLoading || !profile?.company_id || !profile?.id || !canView) return;
    if (coreLoadRequestRef.current) return coreLoadRequestRef.current;

    const companyId = profile.company_id;
    const requestSignal = signal || new AbortController().signal;
    const request = (async () => {
      if (!background && !coreDataReady) setLoading(true);
      try {
        const [resourcesResult, allocationsResult, transportPairsResult] = await Promise.allSettled([
          getWeighbridgeResources(companyId, { signal: requestSignal }),
          loadHarvestAllocations(companyId, requestSignal),
          loadTransportPickerDataCached(companyId, false, requestSignal),
        ]);
        if (requestSignal.aborted) return;
        const issues: Array<{ code: string; message: string }> = [];
        const addIssue = (code: string, message: string) => {
          if (!issues.some((issue) => issue.code === code)) issues.push({ code, message });
        };

        if (resourcesResult.status === "fulfilled") {
          const resourceRows = resourcesResult.value;
          const resourceErrors = Array.isArray(resourceRows?.resourceErrors)
            ? resourceRows.resourceErrors as Array<{ resource?: string; code?: string; message?: string }>
            : [];
          const failedResources = new Set(resourceErrors.map((error) => String(error.resource || "")));
          resourceErrors.forEach((error) => addIssue(
            String(error.code || "WB_RESOURCES"),
            String(error.message || "Не удалось обновить часть справочников. Ранее загруженные данные сохранены.")
          ));
          if (!failedResources.has("fields")) {
            setFields(((resourceRows?.fields || []) as any[])
              .map((row: any) => ({
                id: String(row.id),
                name: String(row.name || "Поле"),
                area: Number(row.area || 0),
              }))
              .filter((row) => !hasQaDataMarker(row.name)));
          }
          if (!failedResources.has("warehouses")) {
            setWarehouses(((resourceRows?.destinations || []) as any[])
              .map((row: any) => ({
                id: String(row.id),
                name: localizedName(row, lang, ["name"]) || String(row.name || "Склад"),
                warehouseType: String(row.warehouseType || ""),
                placeType: String(row.placeType || "WAREHOUSE"),
              }))
              .filter((row) => !hasQaDataMarker(row.name)));
          }
          const mappedVehicles = ((resourceRows?.vehicles || []) as any[]).map((row: any) => ({
            id: String(row.id), name: String(row.name || "Машина"), model: String(row.model || row.name || ""),
            plate: String(row.plate || ""), type: String(row.type || ""), fleetType: String(row.fleetType || ""),
            transportCategory: String(row.transportCategory || ""),
            source: row.source === "reference_machines" ? "reference_machines" as const : "reference_vehicles" as const,
            primaryPersonnelId: row.primaryPersonnelId ? String(row.primaryPersonnelId) : null,
            searchTerms: Array.isArray(row.searchTerms) ? row.searchTerms.map(String) : [],
          }));
          setVehicles((previous) => [
            ...(failedResources.has("reference_vehicles")
              ? previous.filter((row) => row.source === "reference_vehicles")
              : mappedVehicles.filter((row) => row.source === "reference_vehicles")),
            ...(failedResources.has("reference_machines")
              ? previous.filter((row) => row.source === "reference_machines")
              : mappedVehicles.filter((row) => row.source === "reference_machines")),
          ]);
          if (!failedResources.has("reference_vehicles")) {
            setTrailers(((resourceRows?.trailers || []) as any[]).map((row: any) => ({
              id: String(row.id), name: String(row.name || "Прицеп"), model: String(row.model || row.name || ""),
              plate: String(row.plate || ""), type: String(row.type || "trailer"), fleetType: String(row.fleetType || "tractor_trailer"),
              transportCategory: String(row.transportCategory || "trailer"), source: "reference_vehicles", primaryPersonnelId: null,
              searchTerms: Array.isArray(row.searchTerms) ? row.searchTerms.map(String) : [],
            })));
          }
          if (!failedResources.has("company_people")) {
            setDrivers(((resourceRows?.drivers || []) as any[]).map((row: any) => ({
              id: String(row.id), name: String(row.name || "Сотрудник"), machineId: row.machineId ? String(row.machineId) : null,
              roleType: row.roleType === "mechanic_operator" ? "mechanic_operator" : "driver",
              position: String(row.position || ""), department: String(row.department || ""),
              assignedVehicleIds: Array.isArray(row.assignedVehicleIds) ? row.assignedVehicleIds.map(String) : [],
            })));
          }
          const nextDriverNames = Object.fromEntries(
            Object.entries((resourceRows?.driverNames || {}) as Record<string, unknown>)
              .map(([id, name]) => [String(id), String(name || "Водитель")])
          );
          setDriverNames((previous) => resourceErrors.length > 0 ? { ...previous, ...nextDriverNames } : nextDriverNames);
        } else {
          addIssue("WB_RESOURCES", "Не удалось обновить транспорт и водителей. Ранее загруженные данные сохранены.");
        }
        setProcessingPoints([]);
        if (transportPairsResult.status === "fulfilled") {
          applyTransportPickerData(transportPairsResult.value);
        } else {
          addIssue("WB_TRANSPORT_PAIRS", "Не удалось обновить последние связки транспорта. Ранее загруженные данные сохранены.");
        }
        if (allocationsResult.status === "fulfilled") {
          setActiveHarvestSeasonId(allocationsResult.value?.seasonId ? String(allocationsResult.value.seasonId) : null);
          setActiveHarvestSeasonYear(allocationsResult.value?.seasonYear ? Number(allocationsResult.value.seasonYear) : null);
          setHarvestStructureByField((allocationsResult.value?.byField || {}) as Record<string, HarvestStructureOption[]>);
          setHarvestIncompleteFields((allocationsResult.value?.incompleteByField || {}) as Record<string, boolean>);
        } else {
          addIssue("WB_HARVEST_ALLOCATIONS", "Не удалось обновить структуру посевов. Ранее загруженные данные сохранены.");
        }
        setCoreResourceErrors(issues);
        if (issues.length > 0) {
          toast({
            title: "Часть справочников не обновлена",
            description: `${issues[0].message} Код ошибки: ${issues[0].code}`,
            variant: "destructive",
          });
        }
        setCoreDataReady(true);
      } catch (error: any) {
        if (requestSignal.aborted || error?.name === "AbortError") return;
        setCoreResourceErrors([{ code: "WB_BOOTSTRAP", message: "Не удалось обновить рабочие справочники. Ранее загруженные данные сохранены." }]);
        toast({ title: "Ошибка загрузки", description: "Не удалось обновить рабочие справочники. Код ошибки: WB_BOOTSTRAP", variant: "destructive" });
      } finally {
        if (!requestSignal.aborted) setLoading(false);
      }
    })().finally(() => {
      if (coreLoadRequestRef.current === request) coreLoadRequestRef.current = null;
    });
    coreLoadRequestRef.current = request;
    return request;
  };

  const refreshTickets = async (showLoading = false, signal?: AbortSignal) => {
    if (!profile?.company_id || !profile?.id) return;
    if (ticketsRequestRef.current) return ticketsRequestRef.current;
    const companyId = profile.company_id;
    const profileId = profile.id;
    if (showLoading) setTicketsLoading(true);
    const request = (async () => {
      try {
        const rows = await listTickets(companyId, profileId, { workspace: true, signal });
        if (!signal?.aborted) setTickets(rows || []);
      } catch (error: any) {
        if (!signal?.aborted && error?.name !== "AbortError") throw error;
      } finally {
        if (!signal?.aborted) setTicketsLoading(false);
      }
    })().finally(() => {
      if (ticketsRequestRef.current === request) ticketsRequestRef.current = null;
    });
    ticketsRequestRef.current = request;
    return request;
  };

  const refreshHarvestBatches = async () => {
    if (!profile?.company_id) return;
    setHarvestBatches(await listHarvestBatchSummaries(profile.company_id, { aggregateLots: true }));
  };

  const refreshBootstrap = async (includeSummary = false, signal?: AbortSignal) => {
    if (!profile?.company_id || !profile?.id) return;
    const requestRef = includeSummary ? bootstrapSummaryRequestRef : bootstrapRequestRef;
    if (requestRef.current) return requestRef.current;
    const companyId = profile.company_id;
    const profileId = profile.id;
    const request = (async () => {
      const bootstrap = await getWeighbridgeBootstrap(companyId, profileId, { includeSummary, signal });
      if (signal?.aborted) return;
      setActiveShift(bootstrap?.shift || null);
      setShiftCounters(bootstrap?.counters || shiftCounters);
      setShiftGuard(bootstrap?.shiftGuard || { stale: false, ageHours: 0 });
      setShiftSummary(bootstrap?.shiftSummary || { trips: 0, netKg: 0, open: 0, voided: 0, manualCorrections: 0 });
      if (includeSummary) {
        setHarvestSummary(bootstrap?.harvestSummary || { seasonId: null, today: EMPTY_HARVEST_AGGREGATE, byField: {} });
      }
    })().finally(() => {
      if (requestRef.current === request) requestRef.current = null;
    });
    requestRef.current = request;
    return request;
  };

  const invalidateOperatorSessionRequest = () => {
    operatorRequestGenerationRef.current += 1;
    operatorRequestAbortRef.current?.abort();
    operatorRequestAbortRef.current = null;
    operatorRequestRef.current = null;
  };

  const commitOperatorState = (nextState: WeighbridgeOperatorState) => {
    operatorCanonicalStateRef.current = nextState;
    setOperatorState(nextState);
  };

  const updateOperatorState = (updater: (current: WeighbridgeOperatorState) => WeighbridgeOperatorState) => {
    commitOperatorState(updater(operatorCanonicalStateRef.current));
  };

  const verifyOperatorSession = async (signal?: AbortSignal) => {
    if (!profile?.company_id) return;
    if (!canUseOperatorSession) {
      setOperatorSessionStatus("ready");
      return;
    }
    if (operatorMutationInFlightRef.current) return operatorCanonicalStateRef.current;
    if (operatorRequestRef.current) return operatorRequestRef.current;
    const companyId = profile.company_id;
    const generation = ++operatorRequestGenerationRef.current;
    const mutationGeneration = operatorMutationGenerationRef.current;
    const controller = new AbortController();
    operatorRequestAbortRef.current = controller;
    const abortFromParent = () => controller.abort();
    signal?.addEventListener("abort", abortFromParent, { once: true });
    setOperatorSessionStatus("checking");
    setOperatorError("");
    const request = (async () => {
      try {
        const nextState = await getWeighbridgeOperatorState(companyId, { signal: controller.signal });
        if (
          controller.signal.aborted ||
          generation !== operatorRequestGenerationRef.current ||
          mutationGeneration !== operatorMutationGenerationRef.current
        ) return;
        const canonicalState = operatorCanonicalStateRef.current;
        const isPostUnlockStaleResponse =
          canonicalState.unlocked &&
          !nextState.unlocked &&
          !nextState.lock_reason &&
          Date.now() - operatorUnlockConfirmedAtRef.current < 5_000;
        if (isPostUnlockStaleResponse) return canonicalState;
        commitOperatorState(nextState);
        setActiveShift(nextState.shift || null);
        if (nextState.operator?.id) setOperatorPersonId(nextState.operator.id);
        if (nextState.unlocked) {
          setOperatorDialogRequested(false);
          setOperatorDialogOpen(false);
        }
        setOperatorSessionStatus("ready");
        return nextState;
      } catch (error: any) {
        if (controller.signal.aborted || generation !== operatorRequestGenerationRef.current || error?.name === "AbortError") return;
        setOperatorSessionStatus("error");
        setOperatorError("Не удалось проверить PIN. Повторите");
        console.error("Operator session verification failed", error);
      }
    })().finally(() => {
      signal?.removeEventListener("abort", abortFromParent);
      if (operatorRequestRef.current === request) operatorRequestRef.current = null;
      if (operatorRequestAbortRef.current === controller) operatorRequestAbortRef.current = null;
    });
    operatorRequestRef.current = request;
    return request;
  };

  const refreshLiveData = async (event?: { source: string; table?: string }) => {
    const isForeground = !event || event.source !== "realtime";
    const table = event?.table || "";
    if (canUseOperatorSession && (isForeground || !table || table === "weighbridge_shifts")) {
      const canonicalSession = await verifyOperatorSession();
      if (canonicalSession && !canonicalSession.unlocked) return;
      if (!canonicalSession && !operatorCanonicalStateRef.current.unlocked) return;
    } else if (canUseOperatorSession && !operatorCanonicalStateRef.current.unlocked) {
      return;
    }
    const ticketChanged = !table || ["tickets", "ticket_lines", "ticket_weighings", "inventory_batches", "stock_ledger_entries"].includes(table);
    const shiftChanged = !table || table === "weighbridge_shifts";
    const tasks: Promise<unknown>[] = [];
    if (ticketChanged) {
      tasks.push(refreshTickets());
      if (form.operationType === "impurity_removal") tasks.push(refreshHarvestBatches());
    }
    if (table === "tickets") tasks.push(refreshTransportPickerData());
    if (statisticsOpen && ticketChanged) tasks.push(refreshBootstrap(true));
    if (!canUseOperatorSession && shiftChanged) tasks.push(refreshBootstrap(false));
    await Promise.all(tasks);
  };

  useLiveRefresh({
    enabled: Boolean(!authLoading && profile?.company_id && profile?.id && canView && (!canUseOperatorSession || operatorState.unlocked)),
    onRefresh: refreshLiveData,
    companyId: profile?.company_id,
    tables: LIVE_REFRESH_TABLES.weighbridge,
    intervalMs: 60_000,
    minRefreshIntervalMs: 5_000,
  });

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
    if (authLoading || loading || !profile?.company_id) return;
    performance.clearMarks("travkin-weighbridge-interactive");
    performance.mark("travkin-weighbridge-interactive");
  }, [authLoading, loading, profile?.company_id]);

  useEffect(() => {
    if (authLoading) return;
    if (!profile?.company_id) return;
    if (!canUseOperatorSession) {
      setOperatorSessionStatus("ready");
      return;
    }

    const contextKey = `${profile.company_id}:${profile.role}`;
    const contextChanged = operatorContextKeyRef.current !== contextKey;
    operatorContextKeyRef.current = contextKey;
    if (contextChanged) {
      invalidateOperatorSessionRequest();
      commitOperatorState({ shift: null, unlocked: false, operators: [] });
      setActiveShift(null);
      setOperatorSessionStatus("checking");
      setOperatorError("");
      setOperatorDialogOpen(false);
    } else if (operatorCanonicalStateRef.current.unlocked) {
      setOperatorSessionStatus("ready");
      return;
    }
    const controller = new AbortController();
    void verifyOperatorSession(controller.signal);
    return () => {
      controller.abort();
      invalidateOperatorSessionRequest();
    };
    // Session verification is the only request allowed before the gate unlocks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, profile?.company_id, profile?.role]);

  useEffect(() => {
    if (authLoading || !profile?.company_id) return;
    if (canUseOperatorSession && !operatorState.unlocked) return;
    const companyId = profile.company_id;
    const cacheKey = `${companyId}:${language}`;
    const cached = (
      weighbridgePageCache.get(cacheKey) || readWeighbridgeWorkspaceCache(companyId, profile.id, language)
    ) as any;
    const controller = new AbortController();
    let refreshTimer: number | null = null;

    setSecondaryCatalogsLoaded(false);
    if (cached) {
      setFields(cached.fields || []);
      setWarehouses(cached.warehouses || []);
      setVehicles(cached.vehicles || []);
      setTrailers(cached.trailers || []);
      setDrivers(cached.drivers || []);
      setDriverNames(cached.driverNames || {});
      setTransportPickerData(cached.transportPickerData || transportPickerDataCache.get(companyId) || emptyTransportPickerData());
      setHarvestStructureByField(cached.harvestStructureByField || {});
      setHarvestIncompleteFields(cached.harvestIncompleteFields || {});
      setTickets(cached.tickets || []);
      if (!canUseOperatorSession) setActiveShift(cached.activeShift || null);
      setShiftCounters(cached.shiftCounters || shiftCounters);
      setShiftGuard(cached.shiftGuard || { stale: false, ageHours: 0 });
      setShiftSummary(cached.shiftSummary || shiftSummary);
      setHarvestSummary(cached.harvestSummary || harvestSummary);
      setCoreDataReady(true);
      setLoading(false);
      setTicketsLoading(false);
    }

    const reconcile = () => {
      const tasks: Promise<unknown>[] = [
        load(controller.signal, Boolean(cached)),
        refreshTickets(!cached, controller.signal),
        refreshBootstrap(false, controller.signal),
      ];
      void Promise.all(tasks).catch((error: any) => {
        if (!controller.signal.aborted && error?.name !== "AbortError") {
          console.error("Weighbridge background reconciliation failed", error);
        }
      });
    };

    if (cached) refreshTimer = window.setTimeout(reconcile, 100);
    else reconcile();

    return () => {
      if (refreshTimer != null) window.clearTimeout(refreshTimer);
      controller.abort();
      coreLoadRequestRef.current = null;
      ticketsRequestRef.current = null;
      bootstrapRequestRef.current = null;
      bootstrapSummaryRequestRef.current = null;
    };
    // Business data starts only after the canonical operator session unlocks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, profile?.company_id, profile?.id, profile?.role, language, canUseOperatorSession, operatorState.unlocked]);

  useEffect(() => {
    if (canUseOperatorSession && !operatorState.unlocked) return;
    if (form.operationType !== "impurity_removal" || !profile?.company_id || harvestBatches.length > 0) return;
    void refreshHarvestBatches().catch((error) => {
      console.error("Harvest batch options refresh failed", error);
    });
    // Harvest batches are needed only by impurity removal, not by the default intake form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.operationType, profile?.company_id, harvestBatches.length, canUseOperatorSession, operatorState.unlocked]);

  const needsSecondaryCatalogs = form.operationType !== "harvest_incoming";

  useEffect(() => {
    if (canUseOperatorSession && !operatorState.unlocked) return;
    if (!needsSecondaryCatalogs || secondaryCatalogsLoaded || !profile?.company_id) return;
    const controller = new AbortController();
    void loadSecondaryCatalogs(controller.signal).catch((error: any) => {
      if (!controller.signal.aborted && error?.name !== "AbortError") {
        console.error("Weighbridge secondary catalogs failed", error);
      }
    });
    return () => controller.abort();
    // Secondary catalogs are intentionally lazy and are never part of harvest startup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsSecondaryCatalogs, profile?.company_id, language, secondaryCatalogsLoaded, canUseOperatorSession, operatorState.unlocked]);

  useEffect(() => {
    if (canUseOperatorSession && !operatorState.unlocked) return;
    if (!statisticsOpen || !profile?.company_id) return;
    const controller = new AbortController();
    void refreshBootstrap(true, controller.signal).catch((error: any) => {
      if (!controller.signal.aborted && error?.name !== "AbortError") {
        console.error("Weighbridge statistics refresh failed", error);
      }
    });
    return () => controller.abort();
    // Statistics aggregate only after the operator opens the section.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statisticsOpen, profile?.company_id, canUseOperatorSession, operatorState.unlocked]);

  useEffect(() => {
    if (!coreDataReady || !profile?.company_id) return;
    const payload = {
      fields,
      warehouses,
      vehicles,
      trailers,
      drivers,
      driverNames,
      transportPickerData,
      harvestStructureByField,
      harvestIncompleteFields,
      tickets,
      activeShift,
      shiftCounters,
      shiftGuard,
      shiftSummary,
      harvestSummary,
    };
    weighbridgePageCache.set(`${profile.company_id}:${language}`, payload);
    writeWeighbridgeWorkspaceCache(profile.company_id, profile.id, language, payload);
  }, [coreDataReady, profile?.company_id, language, fields, warehouses, vehicles, trailers, drivers, driverNames, transportPickerData, harvestStructureByField, harvestIncompleteFields, tickets, activeShift, shiftCounters, shiftGuard, shiftSummary, harvestSummary]);

  useEffect(() => {
    if (operatorState.unlocked) {
      setOperatorDialogRequested(false);
      setOperatorDialogOpen(false);
      return;
    }
    if (operatorSessionStatus !== "ready" || !canUseOperatorSession || eligibleOperators.length === 0) return;
    setOperatorPersonId((current) => current || eligibleOperators[0]?.id || "");
    setOperatorDialogOpen(true);
  }, [operatorSessionStatus, canUseOperatorSession, operatorState.unlocked, eligibleOperators]);

  useEffect(() => {
    if (!operatorGateBlocked) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [operatorGateBlocked]);

  useEffect(() => {
    if (!canUseOperatorSession) return;
    const handleExpiredSession = () => {
      invalidateOperatorSessionRequest();
      updateOperatorState((current) => ({
        ...current,
        unlocked: false,
        operator: null,
        session_expires_at: null,
        shift_expires_at: null,
      }));
      setOperatorSessionStatus("checking");
      setOperatorError("");
      setOperatorPin("");
      setOperatorDialogOpen(true);
      void verifyOperatorSession();
    };
    window.addEventListener("travkin:weighbridge-session-expired", handleExpiredSession);
    return () => window.removeEventListener("travkin:weighbridge-session-expired", handleExpiredSession);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUseOperatorSession, profile?.company_id]);

  useEffect(() => {
    if (!canUseOperatorSession || !operatorState.unlocked) return;
    const rawExpiry = operatorState.shift_expires_at || operatorState.session_expires_at;
    const expiresAt = rawExpiry ? new Date(rawExpiry).getTime() : Number.NaN;
    if (!Number.isFinite(expiresAt)) return;
    const timeoutMs = Math.max(0, expiresAt - Date.now());
    const timer = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("travkin:weighbridge-session-expired", {
        detail: { code: "inactivity_24h" },
      }));
    }, Math.min(timeoutMs, 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [canUseOperatorSession, operatorState.unlocked, operatorState.shift_expires_at, operatorState.session_expires_at]);

  useEffect(() => {
    if (canUseOperatorSession && !operatorState.unlocked) return;
    if (!profile?.id || notificationDeepLinkHandledRef.current) return;
    const ticketId = new URLSearchParams(window.location.search).get("ticket");
    if (!ticketId) {
      notificationDeepLinkHandledRef.current = true;
      return;
    }
    const cachedTicket = tickets.find((item) => item.id === ticketId) || null;
    if (cachedTicket) {
      notificationDeepLinkHandledRef.current = true;
      if (cachedTicket.status === "finalized" || cachedTicket.status === "voided") {
        setHistoryPreviewTicket(cachedTicket);
      } else {
        setActiveTicket(cachedTicket);
      }
      return;
    }
    if (ticketsLoading) return;

    notificationDeepLinkHandledRef.current = true;
    void (async () => {
      try {
        const payload = await getTicketDetails(ticketId, profile?.id);
        const ticket = {
          ...(payload.ticket || {}),
          lines: payload.lines || payload.ticket?.lines || [],
        } as WeighbridgeTicket;
        if (ticket.status === "finalized" || ticket.status === "voided") {
          setHistoryPreviewTicket(ticket);
        } else {
          setActiveTicket(ticket);
        }
      } catch (error) {
        toast({
          title: "Талон не найден",
          description: error instanceof Error ? error.message : "Не удалось открыть документ",
          variant: "destructive",
        });
      }
    })();
  }, [profile?.id, tickets, ticketsLoading, toast]);

  useEffect(() => {
    if (!idempotencyPersistKey) return;
    createTicketIdempotencyRef.current = localStorage.getItem(idempotencyPersistKey) || null;
  }, [idempotencyPersistKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setWorkstationId(getWeighbridgeWorkstationId(window.localStorage));
  }, []);

  useEffect(() => {
    setActiveHarvestSeasonId(null);
    setActiveHarvestSeasonYear(null);
    setWorkspaceHydratedKey("");
  }, [profile?.company_id]);

  useEffect(() => {
    setWorkspaceHydratedKey("");
    if (!universalWorkspacePersistKey) return;
    const saved = parseUniversalWorkspaceState<FormState, SupplierReceiptLineDraft>(
      localStorage.getItem(universalWorkspacePersistKey),
      INITIAL_FORM
    );
    const migrated = saved || migrateLegacyHarvestWorkspaces<FormState, SupplierReceiptLineDraft>(
      legacyHarvestDraftPersistKey ? localStorage.getItem(legacyHarvestDraftPersistKey) : null,
      INITIAL_FORM
    );
    const fallback = createEmptyWorkspace("harvest_incoming", "workspace-default");
    const nextState = migrated || {
      version: UNIVERSAL_WORKSPACE_SCHEMA_VERSION,
      selectedId: fallback.id,
      workspaces: [fallback],
      migratedLegacyHarvest: false,
    };
    const selected = nextState.workspaces.find((workspace) => workspace.id === nextState.selectedId)
      || nextState.workspaces[0];
    setWorkspaces(nextState.workspaces);
    setSelectedWorkspaceId(selected.id);
    setForm(selected.form);
    setSupplierReceiptLines(selected.supplierReceiptLines || []);
    setShowSupplierExtraFields(selected.showSupplierExtraFields === true);
    setClosingTare("");
    setClosingMoisture("");
    setMoistureSavedValue("");
    setCommentOpen(false);
    if (!saved && migrated) {
      localStorage.setItem(universalWorkspacePersistKey, serializeUniversalWorkspaceState(nextState));
    }
    setWorkspaceHydratedKey(universalWorkspacePersistKey);
  }, [universalWorkspacePersistKey, legacyHarvestDraftPersistKey]);

  useEffect(() => {
    if (!universalWorkspacePersistKey || workspaceHydratedKey !== universalWorkspacePersistKey) return;
    setWorkspaces((current) => current.map((workspace) =>
      workspace.id === selectedWorkspaceId
        ? { ...workspace, form, supplierReceiptLines, showSupplierExtraFields }
        : workspace
    ));
  }, [
    universalWorkspacePersistKey,
    workspaceHydratedKey,
    selectedWorkspaceId,
    form,
    supplierReceiptLines,
    showSupplierExtraFields,
  ]);

  useEffect(() => {
    if (!universalWorkspacePersistKey || workspaceHydratedKey !== universalWorkspacePersistKey) return;
    const timer = window.setTimeout(() => {
      localStorage.setItem(universalWorkspacePersistKey, serializeUniversalWorkspaceState({
        version: UNIVERSAL_WORKSPACE_SCHEMA_VERSION,
        selectedId: selectedWorkspaceId,
        workspaces,
        migratedLegacyHarvest: true,
      }));
    }, 80);
    return () => window.clearTimeout(timer);
  }, [universalWorkspacePersistKey, workspaceHydratedKey, selectedWorkspaceId, workspaces]);

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

    const companyId = profile.company_id;
    const warehouseFromId = form.warehouseFromId;
    let cancelled = false;
    setStockIdentityLoading(true);
    getSessionAuthHeaders()
      .then((headers) =>
        fetch(
          `/api/weighbridge/stock-identities?companyId=${encodeURIComponent(companyId)}&warehouseId=${encodeURIComponent(warehouseFromId)}`,
          {
            cache: "no-store",
            headers,
          }
        )
      )
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || "Не удалось загрузить остатки склада");
        return ((payload.items || []) as StockIdentityOption[]).filter((item) => !item.is_legacy_invalid);
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
    const moisture = activeTicket.lines?.[0]?.moisture_percent != null ? String(activeTicket.lines[0].moisture_percent) : "";
    setClosingMoisture(moisture);
    setMoistureSavedValue(moisture);
    finalizeTicketIdempotencyRef.current = null;
    finalizingRef.current = false;
    setVoidReason("");
    if (activeTicket.status !== "finalized" && activeTicket.status !== "voided") {
      window.setTimeout(() => tareInputRef.current?.focus(), 80);
    }
  }, [activeTicket?.id]);

  useEffect(() => {
    if (!form.vehicleId) {
      setSuggestedFieldId(null);
      return;
    }
    const lastShiftTicket = tickets.find((ticket) =>
      ticket.op_type === "harvest_incoming" &&
      ticket.vehicle_id === form.vehicleId &&
      (!activeShift?.id || ticket.shift_id === activeShift.id)
    );
    if (lastShiftTicket?.field_id && fields.some((field) => field.id === lastShiftTicket.field_id)) {
      setSuggestedFieldId(String(lastShiftTicket.field_id));
    } else {
      setSuggestedFieldId(null);
    }
  }, [form.vehicleId, tickets, activeShift?.id, fields]);

  const fieldHarvestOptions = useMemo(
    () =>
      (form.fieldId ? harvestStructureByField[form.fieldId] || [] : []).slice().sort((a, b) => {
        if (a.isIncomplete === b.isIncomplete) return 0;
        return a.isIncomplete ? 1 : -1;
      }),
    [harvestStructureByField, form.fieldId]
  );
  const harvestTargetOptions = useMemo<SearchableComboboxOption[]>(() => {
    const fieldById = new Map(fields.map((field) => [field.id, field]));
    return Object.entries(harvestStructureByField).flatMap(([fieldId, allocations]) => {
      const field = fieldById.get(fieldId);
      if (!field) return [];
      return allocations
        .slice()
        .sort((a, b) => Number(a.isIncomplete) - Number(b.isIncomplete))
        .map((allocation) => ({
          value: `${fieldId}:${allocation.allocationId}`,
          label: `${field.name} · ${allocation.cropName}`,
          description: [
            allocation.varietyName,
            allocation.reproductionName,
            `${allocation.areaHa.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} га`,
          ].filter(Boolean).join(" · "),
          keywords: [field.name, allocation.cropName, allocation.varietyName, allocation.reproductionName],
        }));
    });
  }, [fields, harvestStructureByField]);
  const selectedHarvestAllocation = useMemo(
    () => fieldHarvestOptions.find((x) => x.allocationId === form.cropStructureAllocationId) || null,
    [fieldHarvestOptions, form.cropStructureAllocationId]
  );
  const harvestContextRevision = useMemo(
    () => tickets
      .filter((ticket) => ticket.op_type === "harvest_incoming")
      .map((ticket) => `${ticket.id}:${ticket.status}:${ticket.net_weight_kg ?? ""}:${ticket.updated_at}`)
      .join("|"),
    [tickets]
  );
  useEffect(() => {
    if (!profile?.company_id || activeHarvests.length === 0) return;
    for (const route of activeHarvests) {
      void loadHarvestContextCached({
        companyId: profile.company_id,
        fieldId: route.fieldId,
        allocationId: route.cropStructureId,
        revision: harvestContextRevision,
      }).catch(() => {
        // The selected route reports a concrete error; background warming stays silent.
      });
    }
  }, [profile?.company_id, activeHarvests, harvestContextRevision]);
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
    const automaticAllocation = automaticHarvestAllocation(fieldHarvestOptions, {
      allowIncompleteIdentity: form.operationType === "harvest_incoming",
    });
    if (!exists && automaticAllocation) {
      const first = automaticAllocation;
      setForm((prev) => ({
        ...prev,
        cropStructureAllocationId: first.allocationId,
        cropId: first.cropId,
        varietyId: first.varietyId,
        reproductionId: first.reproductionId,
      }));
      return;
    }
    if (!exists) {
      setForm((prev) => ({
        ...prev,
        cropStructureAllocationId: "",
        cropId: "",
        varietyId: "",
        reproductionId: "",
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

  useEffect(() => {
    if (form.operationType !== "harvest_incoming" || !form.fieldId || !form.cropStructureAllocationId) {
      setHarvestContext({
        status: "idle",
        message: form.fieldId ? "Выберите участок / культуру." : "Выберите поле.",
        harvestedMassKg: 0,
        harvestedAreaHa: 0,
        yieldTPerHa: null,
        yieldStatus: "not_available",
      });
      return;
    }

    let cancelled = false;
    const key = harvestContextCacheKey(
      profile?.company_id || "",
      form.fieldId,
      form.cropStructureAllocationId,
      harvestContextRevision
    );
    const cached = harvestContextCache.get(key);
    if (cached) {
      setHarvestContext(cached);
      return;
    }
    setHarvestContext((current) => ({ ...current, status: "loading", message: "Проверяем активную уборку..." }));
    loadHarvestContextCached({
      companyId: profile?.company_id || "",
      fieldId: form.fieldId,
      allocationId: form.cropStructureAllocationId,
      revision: harvestContextRevision,
    }).then((context) => {
      if (!cancelled) setHarvestContext(context);
    }).catch((error: any) => {
      if (cancelled) return;
      setHarvestContext({
        status: "error",
        message: error?.message || "Не удалось определить уборку",
        harvestedMassKg: 0,
        harvestedAreaHa: 0,
        yieldTPerHa: null,
        yieldStatus: "not_available",
      });
    });

    return () => {
      cancelled = true;
    };
  }, [profile?.company_id, form.operationType, form.fieldId, form.cropStructureAllocationId, harvestContextRevision]);

  const linkedOperationsForField = useMemo(() => {
    if (!form.fieldId || form.operationType !== "issue_to_field") {
      return [] as LinkedOperationOption[];
    }
    return linkedOperations.filter((row) => {
      if (row.field_id !== form.fieldId) return false;
      return true;
    });
  }, [form.operationType, form.fieldId, linkedOperations]);

  useEffect(() => {
    if (form.operationType === "issue_to_field") {
      if (!form.fieldId) {
        if (form.linkedOperationId || form.linkedOperationLineId) {
          setForm((prev) => ({ ...prev, linkedOperationId: "", linkedOperationLineId: "" }));
        }
        setLinkedOperationLines([]);
        return;
      }
      if (form.linkedOperationId && !linkedOperationsForField.some((row) => row.id === form.linkedOperationId)) {
        setForm((prev) => ({ ...prev, linkedOperationId: "", linkedOperationLineId: "" }));
        setLinkedOperationLines([]);
      }
      return;
    }
    if (form.linkedOperationId || form.linkedOperationLineId) {
      setForm((prev) => ({ ...prev, linkedOperationId: "", linkedOperationLineId: "" }));
    }
    setLinkedOperationLines([]);
  }, [form.operationType, form.fieldId, form.linkedOperationId, form.linkedOperationLineId, linkedOperationsForField]);

  useEffect(() => {
    if (form.operationType !== "issue_to_field" || !profile?.company_id || !form.linkedOperationId) {
      setLinkedOperationLinesLoading(false);
      setLinkedOperationLines([]);
      if (form.linkedOperationLineId) {
        setForm((prev) => ({ ...prev, linkedOperationLineId: "" }));
      }
      return;
    }

    let cancelled = false;
    setLinkedOperationLinesLoading(true);

    (supabase
      .from("operation_lines")
      .select("id,operation_id,variety_id,reproduction_id,planned_area_ha,actual_area_ha,varieties:variety_id(name),seed_reproductions:reproduction_id(name)")
      .eq("company_id", profile.company_id)
      .eq("operation_id", form.linkedOperationId)
      .order("created_at", { ascending: true }) as unknown as Promise<{ data: any[] | null; error: any }>)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) throw error;
        const options = (data || []).map((row: any) => {
          const varietyName =
            String(row?.varieties?.name || "").trim() ||
            varieties.find((item) => item.id === String(row.variety_id || ""))?.name ||
            "";
          const reproductionName =
            String(row?.seed_reproductions?.name || "").trim() ||
            reproductions.find((item) => item.id === String(row.reproduction_id || ""))?.name ||
            "";
          const area = Number(row.actual_area_ha ?? row.planned_area_ha ?? 0);
          return {
            id: String(row.id),
            operation_id: String(row.operation_id),
            variety_id: row.variety_id ? String(row.variety_id) : null,
            reproduction_id: row.reproduction_id ? String(row.reproduction_id) : null,
            label: `${harvestIdentityLabel(varietyName, reproductionName) || "Участок"} • ${area.toFixed(2)} га`,
          } satisfies LinkedOperationLineOption;
        });
        setLinkedOperationLines(options);
        if (form.linkedOperationLineId && !options.some((item) => item.id === form.linkedOperationLineId)) {
          setForm((prev) => ({ ...prev, linkedOperationLineId: "" }));
        }
      })
      .catch((error: any) => {
        if (cancelled) return;
        setLinkedOperationLines([]);
        toast({
          title: "Ошибка загрузки строк операции",
          description: String(error?.message || "Не удалось загрузить строки операции"),
          variant: "destructive",
        });
      })
      .finally(() => {
        if (!cancelled) setLinkedOperationLinesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    form.operationType,
    form.linkedOperationId,
    form.linkedOperationLineId,
    profile?.company_id,
    reproductions,
    toast,
    varieties,
  ]);

  useEffect(() => {
    if (form.operationType !== "issue_to_field") return;
    if (!form.linkedOperationId || form.linkedOperationLineId || linkedOperationLines.length !== 1) return;
    setForm((prev) => ({ ...prev, linkedOperationLineId: linkedOperationLines[0].id }));
  }, [form.linkedOperationId, form.linkedOperationLineId, form.operationType, linkedOperationLines]);

  const linkedOperationLineOptions = useMemo(() => {
    if (!selectedHarvestAllocation) return linkedOperationLines;
    return [...linkedOperationLines].sort((a, b) => {
      const aMatch =
        a.variety_id === selectedHarvestAllocation.varietyId &&
        a.reproduction_id === selectedHarvestAllocation.reproductionId;
      const bMatch =
        b.variety_id === selectedHarvestAllocation.varietyId &&
        b.reproduction_id === selectedHarvestAllocation.reproductionId;
      return Number(bMatch) - Number(aMatch);
    });
  }, [linkedOperationLines, selectedHarvestAllocation]);

  useEffect(() => {
    if (form.operationType !== "issue_to_field" || !form.linkedOperationLineId) return;
    const selectedLine = linkedOperationLineOptions.find((line) => line.id === form.linkedOperationLineId);
    if (!selectedLine) return;
    if (!selectedLine.variety_id || !selectedLine.reproduction_id) return;
    const allocation = fieldHarvestOptions.find(
      (line) =>
        line.varietyId === selectedLine.variety_id &&
        line.reproductionId === selectedLine.reproduction_id
    );
    if (!allocation || allocation.allocationId === form.cropStructureAllocationId) return;
    setForm((prev) => ({
      ...prev,
      cropStructureAllocationId: allocation.allocationId,
      cropId: allocation.cropId,
      varietyId: allocation.varietyId,
      reproductionId: allocation.reproductionId,
      stockIdentityKey: "",
      quantityKg: "",
    }));
  }, [
    form.operationType,
    form.linkedOperationLineId,
    form.cropStructureAllocationId,
    linkedOperationLineOptions,
    fieldHarvestOptions,
  ]);

  const activeHarvestStorageKey = useMemo(
    () => profile?.company_id && activeHarvestSeasonId
      ? `travkin.weighbridge.activeHarvest.v1.${profile.company_id}.${activeHarvestSeasonId}`
      : "",
    [profile?.company_id, activeHarvestSeasonId]
  );
  const selectedActiveHarvest = useMemo(
    () => activeHarvests.find((route) => route.id === selectedActiveHarvestId) || null,
    [activeHarvests, selectedActiveHarvestId]
  );
  const workspaceForm = (workspace: WeighbridgeWorkspace) =>
    workspace.id === selectedWorkspaceId ? form : workspace.form;

  const openTicketCountForWorkspace = (workspace: WeighbridgeWorkspace) => {
    const draft = workspaceForm(workspace);
    return tickets.filter((ticket) => {
      if (!["draft", "active", "ready_to_close"].includes(ticket.status)) return false;
      if (draft.operationType === "harvest_incoming") {
        return Boolean(draft.cropStructureAllocationId && draft.warehouseToId)
          && ticket.op_type === "harvest_incoming"
          && ticket.crop_structure_allocation_id === draft.cropStructureAllocationId
          && ticket.warehouse_to_id === draft.warehouseToId;
      }
      if (draft.operationType === "transfer_between_warehouses") {
        return Boolean(draft.warehouseFromId && draft.warehouseToId)
          && ticket.op_type === "warehouse_transfer"
          && ticket.warehouse_from_id === draft.warehouseFromId
          && ticket.warehouse_to_id === draft.warehouseToId;
      }
      if (draft.operationType === "supplier_receipt") {
        return Boolean(draft.supplierId && draft.warehouseToId)
          && ticket.op_type === "supplier_receipt"
          && ticket.supplier_id === draft.supplierId
          && ticket.warehouse_to_id === draft.warehouseToId;
      }
      if (draft.operationType === "issue_to_field") {
        return Boolean(draft.warehouseFromId && draft.fieldId)
          && ticket.op_type === "issue_to_field"
          && ticket.warehouse_from_id === draft.warehouseFromId
          && ticket.field_id === draft.fieldId;
      }
      if (draft.operationType === "shipment_outbound") {
        return Boolean(draft.warehouseFromId && draft.buyerId)
          && ticket.op_type === "shipment_outbound"
          && ticket.warehouse_from_id === draft.warehouseFromId
          && ticket.buyer_id === draft.buyerId;
      }
      return false;
    }).length;
  };

  const workspaceTabs = useMemo<UniversalWorkspaceTab[]>(() => workspaces.map((workspace) => {
    const draft = workspaceForm(workspace);
    const field = fields.find((item) => item.id === draft.fieldId) || null;
    const allocation = (draft.fieldId ? harvestStructureByField[draft.fieldId] || [] : [])
      .find((item) => item.allocationId === draft.cropStructureAllocationId) || null;
    const warehouseFrom = warehouses.find((item) => item.id === draft.warehouseFromId) || null;
    const warehouseTo = warehouses.find((item) => item.id === draft.warehouseToId) || null;
    const supplier = suppliers.find((item) => item.id === draft.supplierId) || null;
    const buyer = buyers.find((item) => item.id === draft.buyerId) || null;
    const product = products.find((item) => item.id === draft.productId) || null;
    const crop = crops.find((item) => item.id === draft.cropId) || null;
    const materialLabel = product?.name || crop?.name || "Материал";
    let primaryLabel = "Новая вкладка";
    let secondaryLabel = WEIGHBRIDGE_MODES.find((mode) => mode.type === draft.operationType)?.label || "Рабочая форма";

    if (draft.operationType === "harvest_incoming" && (field || warehouseTo || allocation)) {
      primaryLabel = field?.name || "Урожай с поля";
      secondaryLabel = [
        allocation?.varietyName || allocation?.cropName || crop?.name,
        allocation?.reproductionName,
        warehouseTo?.name ? `→ ${warehouseTo.name}` : "",
      ].filter(Boolean).join(" · ") || "Урожай с поля";
    } else if (draft.operationType === "transfer_between_warehouses" && (warehouseFrom || warehouseTo)) {
      primaryLabel = `${warehouseFrom?.name || "Склад"} → ${warehouseTo?.name || "Склад"}`;
      secondaryLabel = materialLabel;
    } else if (draft.operationType === "supplier_receipt" && (supplier || warehouseTo)) {
      primaryLabel = supplier?.name || "Приход от контрагента";
      secondaryLabel = [warehouseTo?.name ? `→ ${warehouseTo.name}` : "", materialLabel !== "Материал" ? materialLabel : ""].filter(Boolean).join(" · ") || "От контрагента";
    } else if (draft.operationType === "issue_to_field" && (warehouseFrom || field)) {
      primaryLabel = `${warehouseFrom?.name || "Склад"} → ${field?.name || "Поле"}`;
      secondaryLabel = materialLabel;
    } else if (draft.operationType === "shipment_outbound" && (warehouseFrom || buyer)) {
      primaryLabel = `${warehouseFrom?.name || "Склад"} → ${buyer?.name || "Покупатель"}`;
      secondaryLabel = materialLabel;
    } else if (draft.operationType === "disposal_writeoff" && warehouseFrom) {
      primaryLabel = `Списание · ${warehouseFrom.name}`;
      secondaryLabel = disposalCategoryLabels[draft.disposalCategory];
    } else if (draft.operationType === "impurity_removal" && warehouseFrom) {
      primaryLabel = `${warehouseFrom.name} · Примеси`;
      secondaryLabel = impurityTypeLabels[draft.impurityType];
    }

    return {
      id: workspace.id,
      operationType: draft.operationType as UniversalWorkspaceOperationType,
      primaryLabel,
      secondaryLabel,
      fullLabel: `${primaryLabel}: ${secondaryLabel}`,
      openTicketCount: openTicketCountForWorkspace(workspace),
    };
  }), [
    workspaces,
    selectedWorkspaceId,
    form,
    fields,
    harvestStructureByField,
    warehouses,
    suppliers,
    buyers,
    products,
    crops,
    tickets,
  ]);

  const activateWorkspace = (workspace: WeighbridgeWorkspace) => {
    setSelectedWorkspaceId(workspace.id);
    setForm(workspace.form);
    setSupplierReceiptLines(workspace.supplierReceiptLines || []);
    setShowSupplierExtraFields(workspace.showSupplierExtraFields === true);
    setClosingTare("");
    setClosingMoisture("");
    setMoistureSavedValue("");
    setCommentOpen(false);
  };

  const selectWorkspace = (workspaceId: string) => {
    if (workspaceId === selectedWorkspaceId) return;
    const next = workspaces.find((workspace) => workspace.id === workspaceId);
    if (!next) return;
    setWorkspaces((current) => current.map((workspace) =>
      workspace.id === selectedWorkspaceId
        ? { ...workspace, form, supplierReceiptLines, showSupplierExtraFields }
        : workspace
    ));
    activateWorkspace(next);
  };

  const addWorkspace = (operationType: UniversalWorkspaceOperationType) => {
    if (workspaces.length >= UNIVERSAL_WORKSPACE_MAX_TABS) {
      toast({ title: "Можно открыть не более 6 рабочих вкладок." });
      return;
    }
    const next = createEmptyWorkspace(operationType);
    setWorkspaces((current) => [
      ...current.map((workspace) => workspace.id === selectedWorkspaceId
        ? { ...workspace, form, supplierReceiptLines, showSupplierExtraFields }
        : workspace),
      next,
    ]);
    activateWorkspace(next);
  };

  const removeWorkspace = async (workspaceId: string) => {
    const target = workspaces.find((workspace) => workspace.id === workspaceId);
    if (!target) return;
    const targetForm = workspaceForm(target);
    const targetLines = target.id === selectedWorkspaceId ? supplierReceiptLines : target.supplierReceiptLines;
    const dirty = isUniversalWorkspaceDirty(targetForm, INITIAL_FORM, targetLines.length);
    const openTicketCount = openTicketCountForWorkspace(target);
    if (dirty || openTicketCount > 0) {
      const description = [
        dirty ? "Несохранённые данные будут потеряны." : "",
        openTicketCount > 0 ? "Открытый талон останется в разделе “Открытые талоны”." : "",
      ].filter(Boolean).join(" ");
      const confirmed = await siteConfirm({
        title: "Закрыть вкладку?",
        description,
        actionLabel: "Закрыть",
      });
      if (!confirmed) return;
    }

    const remaining = workspaces.filter((workspace) => workspace.id !== workspaceId);
    const nextWorkspaces = remaining.length > 0
      ? remaining
      : [createEmptyWorkspace("harvest_incoming")];
    setWorkspaces(nextWorkspaces);
    if (workspaceId === selectedWorkspaceId || remaining.length === 0) {
      activateWorkspace(nextWorkspaces[0]);
    }
  };

  const changeHarvestTarget = (value: string) => {
    const [fieldId, allocationId] = value.split(":");
    const allocation = (harvestStructureByField[fieldId] || [])
      .find((item) => item.allocationId === allocationId) || null;
    setForm((previous) => ({
      ...previous,
      fieldId: allocation ? fieldId : "",
      cropStructureAllocationId: allocation?.allocationId || "",
      cropId: allocation?.cropId || "",
      varietyId: allocation?.varietyId || "",
      reproductionId: allocation?.reproductionId || "",
    }));
  };

  const setActiveHarvestForm = (route: ActiveHarvestRoute | null, clearTransient = false) => {
    setForm((previous) => ({
      ...previous,
      operationType: "harvest_incoming",
      fieldId: route?.fieldId || "",
      cropStructureAllocationId: route?.cropStructureId || "",
      cropId: route?.cropId || "",
      varietyId: route?.varietyId || "",
      reproductionId: route?.reproductionId || "",
      warehouseToId: route?.warehouseId || "",
      ...(clearTransient ? { vehicleId: "", driverId: "", grossKg: "", notes: "" } : {}),
    }));
  };

  const selectActiveHarvest = async (route: ActiveHarvestRoute, confirmVolatile = true) => {
    if (route.id === selectedActiveHarvestId) return;
    const hasVolatileInput = Boolean(form.vehicleId || form.driverId || form.grossKg);
    if (confirmVolatile && hasVolatileInput) {
      const confirmed = await siteConfirm({
        title: "Сменить активную уборку?",
        description: "Транспорт, водитель и введённый вес будут очищены.",
        actionLabel: "Сменить",
      });
      if (!confirmed) return;
    }
    setSelectedActiveHarvestId(route.id);
    setActiveHarvestForm(route, true);
    setClosingTare("");
    setClosingMoisture("");
    setMoistureSavedValue("");
    setCommentOpen(false);
    if (activeHarvestStorageKey) localStorage.setItem(activeHarvestStorageKey, route.id);
  };

  const createActiveHarvest = async (cropStructureId: string, warehouseId: string) => {
    if (!profile?.company_id) return;
    setActiveHarvestBusy(true);
    try {
      const result = await createActiveHarvestRoute(profile.company_id, cropStructureId, warehouseId);
      let fieldId = "";
      let allocation: HarvestStructureOption | null = null;
      for (const [candidateFieldId, options] of Object.entries(harvestStructureByField)) {
        const candidate = options.find((option) => option.allocationId === cropStructureId);
        if (!candidate) continue;
        fieldId = candidateFieldId;
        allocation = candidate;
        break;
      }
      const field = fields.find((item) => item.id === fieldId) || null;
      const warehouse = warehouses.find((item) => item.id === warehouseId) || null;
      const created: ActiveHarvestRoute | null = allocation && field && warehouse
        ? {
            id: result.routeId,
            companyId: profile.company_id,
            seasonId: result.seasonId,
            seasonYear: result.seasonYear,
            cropStructureId,
            fieldId,
            fieldName: field.name,
            areaHa: allocation.areaHa,
            warehouseId,
            warehouseName: warehouse.name,
            cropId: allocation.cropId,
            cropName: allocation.cropName,
            varietyId: allocation.varietyId || null,
            varietyName: allocation.varietyName || "",
            reproductionId: allocation.reproductionId || null,
            reproductionName: allocation.reproductionName || "",
            requiresReview: allocation.isIncomplete || !allocation.varietyId || !allocation.reproductionId,
            status: "active",
            openTicketCount: 0,
            createdAt: result.createdAt,
            updatedAt: result.updatedAt,
            closedAt: null,
          }
        : null;
      if (created) {
        setActiveHarvestSeasonId(result.seasonId);
        setActiveHarvestSeasonYear(result.seasonYear);
        setCompletedHarvests((current) => current.filter((route) => route.id !== created.id));
        setActiveHarvests((current) => [
          ...current.filter((route) => route.id !== created.id),
          created,
        ]);
        await selectActiveHarvest(created);
      }
      void refreshActiveHarvestRoutes().catch(() => {
        // The optimistic route remains usable until realtime or the next refresh reconciles it.
      });
      toast({ title: "Активная уборка добавлена", description: created ? `${created.fieldName} → ${created.warehouseName}` : undefined });
    } catch (error) {
      toast({ title: "Не удалось добавить уборку", description: error instanceof Error ? error.message : "Повторите попытку", variant: "destructive" });
      throw error;
    } finally {
      setActiveHarvestBusy(false);
    }
  };

  const changeActiveHarvestContext = async (
    route: ActiveHarvestRoute,
    cropStructureId: string,
    warehouseId: string
  ) => {
    if (!profile?.company_id) return;
    if (route.cropStructureId === cropStructureId && route.warehouseId === warehouseId) return;
    if (activeHarvests.some((item) =>
      item.id !== route.id &&
      item.cropStructureId === cropStructureId &&
      item.warehouseId === warehouseId
    )) {
      toast({ title: "Такая активная приёмка уже открыта", variant: "destructive" });
      return;
    }

    let fieldId = "";
    let allocation: HarvestStructureOption | null = null;
    for (const [candidateFieldId, options] of Object.entries(harvestStructureByField)) {
      const candidate = options.find((option) => option.allocationId === cropStructureId);
      if (!candidate) continue;
      fieldId = candidateFieldId;
      allocation = candidate;
      break;
    }
    const field = fields.find((item) => item.id === fieldId) || null;
    const warehouse = warehouses.find((item) => item.id === warehouseId) || null;
    if (!allocation || !field || !warehouse) {
      toast({ title: "Не удалось изменить приёмку", description: "Участок или место приёмки больше недоступны.", variant: "destructive" });
      return;
    }

    if (route.openTicketCount > 0) {
      const confirmed = await siteConfirm({
        title: "Переключить вкладку?",
        description: `По текущей приёмке открыто ${route.openTicketCount} талонов. Они останутся без изменений.`,
        actionLabel: "Переключить",
      });
      if (!confirmed) return;
    }

    const nextRoute: ActiveHarvestRoute = {
      ...route,
      cropStructureId,
      fieldId,
      fieldName: field.name,
      areaHa: allocation.areaHa,
      warehouseId,
      warehouseName: warehouse.name,
      cropId: allocation.cropId,
      cropName: allocation.cropName,
      varietyId: allocation.varietyId || null,
      varietyName: allocation.varietyName || "",
      reproductionId: allocation.reproductionId || null,
      reproductionName: allocation.reproductionName || "",
      requiresReview: allocation.isIncomplete || !allocation.varietyId || !allocation.reproductionId,
      openTicketCount: tickets.filter((ticket) =>
        ticket.op_type === "harvest_incoming" &&
        ["draft", "active", "ready_to_close"].includes(ticket.status) &&
        ticket.crop_structure_allocation_id === cropStructureId &&
        ticket.warehouse_to_id === warehouseId
      ).length,
      updatedAt: new Date().toISOString(),
    };

    setActiveHarvestBusy(true);
    setActiveHarvests((current) => current.map((item) => item.id === route.id ? nextRoute : item));
    if (route.id === selectedActiveHarvestId) setActiveHarvestForm(nextRoute);
    try {
      const result = await changeActiveHarvestRouteContext(
        profile.company_id,
        route.id,
        cropStructureId,
        fieldId,
        warehouseId
      );
      setActiveHarvests((current) => current.map((item) =>
        item.id === route.id ? { ...item, updatedAt: result.updatedAt || item.updatedAt } : item
      ));
      const cached = activeHarvestRouteCache.get(profile.company_id);
      if (cached) {
        activeHarvestRouteCache.set(profile.company_id, {
          ...cached,
          active: cached.active.map((item) => item.id === route.id ? nextRoute : item),
        });
      }
    } catch (error) {
      setActiveHarvests((current) => current.map((item) => item.id === route.id ? route : item));
      if (route.id === selectedActiveHarvestId) setActiveHarvestForm(route);
      toast({
        title: "Не удалось изменить приёмку",
        description: error instanceof Error ? error.message : "Повторите попытку",
        variant: "destructive",
      });
    } finally {
      setActiveHarvestBusy(false);
    }
  };

  const completeActiveHarvest = async (route: ActiveHarvestRoute) => {
    if (!profile?.company_id) return;
    const confirmed = await siteConfirm({
      title: "Завершить активную уборку?",
      description: route.openTicketCount > 0
        ? `Открытых талонов: ${route.openTicketCount}. Они останутся в очереди и истории.`
        : "Вкладка уйдёт в завершённые. Талоны и история не изменятся.",
      actionLabel: "Завершить",
    });
    if (!confirmed) return;
    setActiveHarvestBusy(true);
    try {
      const payload = await updateActiveHarvestRoute(profile.company_id, route.id, "complete");
      applyActiveHarvestRouteList(payload);
      if (route.id === selectedActiveHarvestId) {
        const next = payload.active[0] || null;
        setSelectedActiveHarvestId(next?.id || "");
        setActiveHarvestForm(next, true);
        if (activeHarvestStorageKey) {
          if (next) localStorage.setItem(activeHarvestStorageKey, next.id);
          else localStorage.removeItem(activeHarvestStorageKey);
        }
      }
      toast({ title: "Уборка завершена", description: "Талоны и история сохранены." });
    } catch (error) {
      toast({ title: "Не удалось завершить уборку", description: error instanceof Error ? error.message : "Повторите попытку", variant: "destructive" });
    } finally {
      setActiveHarvestBusy(false);
    }
  };

  const adjustActiveHarvestTicketCount = (ticket: WeighbridgeTicket, delta: number) => {
    if (ticket.op_type !== "harvest_incoming") return;
    setActiveHarvests((current) => current.map((route) =>
      route.cropStructureId === ticket.crop_structure_allocation_id && route.warehouseId === ticket.warehouse_to_id
        ? { ...route, openTicketCount: Math.max(0, route.openTicketCount + delta) }
        : route
    ));
  };

  const activeHarvestForTicket = (ticket: WeighbridgeTicket) =>
    [...activeHarvests, ...completedHarvests].find((route) =>
      route.cropStructureId === ticket.crop_structure_allocation_id && route.warehouseId === ticket.warehouse_to_id
    ) || null;

  const activeTickets = useMemo(() => tickets.filter((t) => ["draft", "active", "ready_to_close"].includes(t.status)), [tickets]);
  const ticketById = useMemo(() => new Map(tickets.map((ticket) => [ticket.id, ticket])), [tickets]);
  const activeCorrectionOriginalIds = useMemo(
    () => new Set(activeTickets.map((ticket) => ticket.correction_of_ticket_id).filter(Boolean)),
    [activeTickets]
  );
  const visibleActiveTickets = useMemo(
    () => pendingOpenTicket ? [...activeTickets, pendingOpenTicket] : activeTickets,
    [activeTickets, pendingOpenTicket]
  );
  const harvestWarehouses = useMemo(
    () => warehouses
      .filter((warehouse) => isHarvestDestinationPlace(warehouse.warehouseType, warehouse.placeType))
      .sort((left, right) => {
        const typeOrder = storagePlaceTypeSortOrder(left.placeType) - storagePlaceTypeSortOrder(right.placeType);
        return typeOrder || left.name.localeCompare(right.name, "ru");
      }),
    [warehouses]
  );
  const historyTypes = useMemo(() => Array.from(new Set(tickets.map((t) => t.op_type).filter(Boolean))), [tickets]);
  const historyTickets = useMemo(
    () => tickets.filter((ticket) =>
      ["finalized", "voided"].includes(ticket.status)
      && !activeCorrectionOriginalIds.has(ticket.id)
      && (historyTypeFilter === "all" || ticket.op_type === historyTypeFilter)
    ),
    [tickets, historyTypeFilter, activeCorrectionOriginalIds]
  );
  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const weighedSupplierProducts = useMemo(
    () => products.filter((product) => isWeighedSupplierProduct({
      productType: product.productType || product.type,
      stockUnit: product.stockUnit || product.baseUom || product.unit,
      physicalState: product.physicalState,
      isSeedMaterial: product.isSeedMaterial,
    })),
    [products]
  );
  const activeTicketLineTotal = useMemo(
    () => (activeTicket?.lines || []).reduce((sum, line) => sum + Number(line.quantity || 0), 0),
    [activeTicket?.id, activeTicket?.lines]
  );
  const selectedTransferStock = useMemo(
    () => stockIdentityOptions.find((item) => item.key === form.stockIdentityKey) || null,
    [stockIdentityOptions, form.stockIdentityKey]
  );
  const availableHarvestBatches = useMemo(
    () => harvestBatches.filter((batch) => !form.warehouseFromId || batch.warehouseId === form.warehouseFromId),
    [harvestBatches, form.warehouseFromId]
  );
  const selectedHarvestBatch = useMemo(
    () => harvestBatches.find((batch) => batch.id === form.sourceBatchId) || null,
    [harvestBatches, form.sourceBatchId]
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
  const selectedVehicle = useMemo(
    () => vehicles.find((vehicle) => vehicle.id === form.vehicleId) || null,
    [vehicles, form.vehicleId]
  );
  const updateTransportPickerData = (
    updater: (current: WeighbridgeTransportPickerData) => WeighbridgeTransportPickerData
  ) => {
    setTransportPickerData((current) => {
      const next = updater(current);
      if (profile?.company_id) transportPickerDataCache.set(profile.company_id, next);
      return next;
    });
  };

  const markTransportAssignmentOpen = (ticket: WeighbridgeTicket) => {
    if (!ticket.vehicle_id && !ticket.driver_id) return;
    updateTransportPickerData((current) => ({
      ...current,
      openAssignments: [
        ...current.openAssignments.filter((item) => item.ticketId !== ticket.id),
        {
          ticketId: ticket.id,
          ticketNo: ticket.ticket_no || "",
          vehicleId: ticket.vehicle_id || null,
          driverId: ticket.driver_id || null,
        },
      ],
      fetchedAt: new Date().toISOString(),
    }));
  };

  const releaseTransportAssignment = (ticket: WeighbridgeTicket, learnPair: boolean) => {
    updateTransportPickerData((current) => {
      const base = {
        ...current,
        openAssignments: current.openAssignments.filter((item) => item.ticketId !== ticket.id),
        fetchedAt: new Date().toISOString(),
      };
      if (!learnPair || !ticket.vehicle_id || !ticket.driver_id) return base;
      const existing = current.recentPairs.find(
        (pair) => pair.vehicleId === ticket.vehicle_id && pair.driverId === ticket.driver_id
      );
      const pair = {
        vehicleId: ticket.vehicle_id,
        driverId: ticket.driver_id,
        lastUsedAt: new Date().toISOString(),
        usageCount: (existing?.usageCount || 0) + 1,
        usedInOperationalDay: true,
        usedInCurrentSeason: !current.seasonId || current.seasonId === ticket.season_id,
      };
      return {
        ...base,
        recentPairs: [
          pair,
          ...current.recentPairs.filter(
            (item) => item.vehicleId !== pair.vehicleId || item.driverId !== pair.driverId
          ),
        ].slice(0, 4),
        latestDriverByVehicle: {
          ...current.latestDriverByVehicle,
          [pair.vehicleId]: pair.driverId,
        },
        latestVehicleByDriver: {
          ...current.latestVehicleByDriver,
          [pair.driverId]: pair.vehicleId,
        },
      };
    });
  };

  const openTransportAssignmentTicket = async (ticketId: string) => {
    const local = tickets.find((ticket) => ticket.id === ticketId);
    if (local) {
      setActiveTicket(local);
      return;
    }
    try {
      const payload = await getTicketDetails(ticketId, profile?.id);
      setActiveTicket({
        ...(payload.ticket || {}),
        lines: payload.lines || payload.ticket?.lines || [],
      } as WeighbridgeTicket);
    } catch (error) {
      toast({
        title: "Талон недоступен",
        description: error instanceof Error ? error.message : "Повторите попытку",
        variant: "destructive",
      });
    }
  };

  const handleBlockedTransportAssignment = async (assignment: { ticketId: string; ticketNo: string }) => {
    const confirmed = await siteConfirm({
      title: "Уже ждёт тару",
      description: assignment.ticketNo
        ? `Транспорт или водитель уже используется в талоне ${assignment.ticketNo}. Открыть этот талон?`
        : "Транспорт или водитель уже используется в открытом талоне. Открыть его?",
      actionLabel: "Открыть талон",
    });
    if (confirmed) void openTransportAssignmentTicket(assignment.ticketId);
  };
  const gross = activeTicket?.gross_weight_kg != null ? String(activeTicket.gross_weight_kg) : activeTicket?.weigh_method === "manual_override_with_reason" && activeTicketLineTotal > 0 ? String(activeTicketLineTotal) : "";
  const pure = net(gross, closingTare);
  const grossInputValidation = form.grossKg.trim() ? parseStrictWeightKg(form.grossKg, "Брутто") : null;
  const closingTareValidation = closingTare.trim() ? parseStrictWeightKg(closingTare, "Тара") : null;
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
  const isFieldIssue = form.operationType === "issue_to_field";
  const isTransfer = form.operationType === "transfer_between_warehouses";
  const isShipment = form.operationType === "shipment_outbound";
  const isDisposal = form.operationType === "disposal_writeoff";
  const isImpurityRemoval = form.operationType === "impurity_removal";
  const isSupplierDirect = form.operationType === "supplier_receipt" && form.supplierReceiptMode === "direct";
  const isTransferDirect = isTransfer && form.transferMode === "direct";
  const isFieldIssueDirect = isFieldIssue && form.fieldIssueMode === "direct";
  const isWeighbridgeForm =
    form.operationType === "harvest_incoming" ||
    (form.operationType === "supplier_receipt" && form.supplierReceiptMode === "weighbridge") ||
    (isTransfer && form.transferMode === "weighbridge") ||
    (isFieldIssue && form.fieldIssueMode === "weighbridge") ||
    isShipment ||
    isDisposal ||
    isImpurityRemoval;
  const supplierReceiptGenericLineDrafts = useMemo(() => {
    if (form.operationType !== "supplier_receipt" || form.supplierReceiptMode !== "direct") return [];
    const base: SupplierReceiptLineDraft = {
      localId: "base",
      productId: form.productId,
      quantityKg: form.quantityKg,
      uom: inferProductUnit(productById.get(form.productId)),
      warehouseToId: form.warehouseToId,
      supplierLot: form.supplierLot,
      unitPrice: form.unitPrice,
      notes: "",
    };
    return [base, ...supplierReceiptLines].filter(
      (line) =>
        line.localId === "base" ||
        Boolean(line.productId || line.quantityKg || line.supplierLot || line.notes)
    );
  }, [form.operationType, form.supplierReceiptMode, form.productId, form.quantityKg, form.warehouseToId, form.supplierLot, form.unitPrice, supplierReceiptLines, productById]);
  const supplierReceiptGenericLineTotal = useMemo(
    () => supplierReceiptGenericLineDrafts.reduce((sum, line) => sum + Number(toNum(line.quantityKg) || 0), 0),
    [supplierReceiptGenericLineDrafts]
  );
  const supplierReceiptUsesMultipleLines =
    form.operationType === "supplier_receipt" &&
    form.supplierReceiptMode === "direct" &&
    supplierReceiptLines.length > 0;

  const selectOperation = async (operationType: OperationType) => {
    if (operationType === form.operationType) return;
    if (isUniversalWorkspaceDirty(form, INITIAL_FORM, supplierReceiptLines.length)) {
      const confirmed = await siteConfirm({
        title: "Сменить тип движения?",
        description: "Несохранённые данные этой вкладки будут очищены.",
        actionLabel: "Сменить",
      });
      if (!confirmed) return;
    }
    setSupplierReceiptLines([]);
    setShowSupplierExtraFields(false);
    setForm({ ...INITIAL_FORM, operationType });
  };

  const validate = () => {
    if (!profile?.company_id || !profile?.id) return "Нет профиля пользователя";
    if (form.operationType === "harvest_incoming") {
      if (!form.driverId) return "Выберите водителя";
      if (!form.vehicleId) return "Выберите машину";
      if (!form.fieldId || !form.cropStructureAllocationId || !form.cropId) {
        return "Выберите поле и участок / культуру";
      }
      if (!form.warehouseToId) {
        return "Выберите склад назначения";
      }
      if (form.harvestMoisture.trim()) {
        const moisture = toNum(form.harvestMoisture);
        if (moisture == null || moisture < 0 || moisture > 100) {
          return "Влажность должна быть от 0 до 100 %";
        }
      }
      if (!fieldHarvestOptions.some((x) => x.allocationId === form.cropStructureAllocationId)) {
        return "Выбранная посевная строка не связана с этим полем";
      }
      if (harvestContext.status !== "ready") {
        return harvestContext.message || "Активная уборка не определена";
      }
      if (!toNum(form.grossKg) || Number(form.grossKg) <= 0) return "Укажите брутто";
    } else if (form.operationType === "supplier_receipt") {
      if (!form.supplierId) return "Выберите контрагента";
      if (form.supplierReceiptMode === "weighbridge") {
        if (!form.warehouseToId) return "Выберите склад назначения";
        if (!form.productId) return "Выберите номенклатуру";
        if (!weighedSupplierProducts.some((product) => product.id === form.productId)) return "Эта номенклатура не принимается через весовую";
        if (!toNum(form.grossKg) || Number(form.grossKg) <= 0) return "Укажите брутто";
      } else {
        if (!supplierReceiptGenericLineDrafts.length || supplierReceiptGenericLineDrafts.some((line) => !line.productId)) {
          return "Выберите номенклатуру по каждой строке поставки";
        }
        if (supplierReceiptGenericLineDrafts.some((line) => !String(productById.get(line.productId)?.stockUnit || "").trim())) {
          return "Для номенклатуры не задана единица хранения";
        }
        if (supplierReceiptGenericLineDrafts.some((line) => !line.warehouseToId)) {
          return "Выберите склад по каждой строке поставки";
        }
        if (supplierReceiptGenericLineDrafts.some((line) => !toNum(line.quantityKg) || Number(line.quantityKg) <= 0)) {
          return "Укажите количество по каждой строке поставки";
        }
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
      if (!form.driverId) return "Выберите водителя";
      if (!form.vehicleId) return "Выберите машину";
      if (form.transferMode === "weighbridge") {
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
    } else if (form.operationType === "impurity_removal") {
      if (!form.warehouseFromId) return "Выберите склад";
      if (!form.sourceBatchId || !selectedHarvestBatch) return "Выберите партию урожая";
      if (selectedHarvestBatch.warehouseId !== form.warehouseFromId) return "Партия не принадлежит выбранному складу";
      if (selectedHarvestBatch.cleanMassKg <= 0) return "В партии не осталось чистой массы";
      if (!form.impurityType) return "Выберите вид примесей";
      if (form.impurityType === "other" && !form.notes.trim()) return "Для вида «Прочее» добавьте комментарий";
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

  const secondaryModeLoading = form.operationType !== "harvest_incoming" && !secondaryCatalogsLoaded;
  const currentValidationError = !coreDataReady
    ? "Рабочие справочники ещё загружаются"
    : secondaryModeLoading
      ? "Справочник выбранного режима ещё загружается"
      : validate();

  const create = async () => {
    if (!canOperate || submitting) return;
    if (!coreDataReady || secondaryModeLoading) {
      toast({
        title: "Данные ещё загружаются",
        description: currentValidationError || "Подождите пару секунд и повторите создание талона.",
        variant: "destructive",
      });
      return;
    }
    if (!activeShift && !(form.operationType === "supplier_receipt" && form.supplierReceiptMode === "direct") && !(form.operationType === "transfer_between_warehouses" && form.transferMode === "direct")) {
      toast({
        title: "Смена не открыта",
        description: "Перед созданием талона откройте смену через меню ⋯.",
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
    const isFieldIssue = form.operationType === "issue_to_field";
    const isShipment = form.operationType === "shipment_outbound";
    const isDisposal = form.operationType === "disposal_writeoff";
    const isImpurityRemoval = form.operationType === "impurity_removal";
    const productId =
      form.operationType === "harvest_incoming"
        ? selectedHarvestAllocation?.cropId
        : isImpurityRemoval
          ? selectedHarvestBatch?.productId
        : form.operationType === "transfer_between_warehouses" || isFieldIssue || isShipment || isDisposal
          ? selectedTransferStock?.product_id
        : form.productId;
    if (!productId) {
      toast({
        title: "Ошибка",
        description: form.operationType === "transfer_between_warehouses" || isDisposal || isImpurityRemoval ? "Выберите партию или остаток из склада-источника." : "Для этой культуры не найдена складская номенклатура. Проверьте справочник номенклатуры.",
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
      form.operationType === "supplier_receipt" && form.supplierReceiptMode === "direct"
        ? supplierReceiptGenericLineTotal
        :
      form.operationType === "harvest_incoming" || (form.operationType === "supplier_receipt" && form.supplierReceiptMode === "weighbridge") || (isTransfer && form.transferMode === "weighbridge") || isFieldIssueWeighbridge || isShipment
        || isDisposal || isImpurityRemoval
        ? Number(form.grossKg)
        : Number(form.quantityKg);
    const supplierNotes = [
      form.operationType === "supplier_receipt" && form.supplierDocumentNo.trim() ? `Документ поставщика: ${form.supplierDocumentNo.trim()}` : "",
      form.operationType === "supplier_receipt" && form.supplierLot.trim() ? `Партия поставщика: ${form.supplierLot.trim()}` : "",
      form.operationType === "supplier_receipt" && form.harvestYear.trim() ? `Год урожая: ${form.harvestYear.trim()}` : "",
    ].filter(Boolean);

    let supplierCounterpartyId = form.supplierId;
    try {
      supplierCounterpartyId =
        form.operationType === "supplier_receipt"
          ? await resolveSupplierCounterparty(form.supplierId)
          : form.supplierId;
    } catch (e: any) {
      toast({ title: "Ошибка", description: e?.message || "Не удалось подготовить поставщика", variant: "destructive" });
      return;
    }

    const ticket: TicketInput = {
      company_id: profile.company_id,
      batch_id: isImpurityRemoval && !selectedHarvestBatch?.aggregateLot ? form.sourceBatchId : null,
      harvest_lot_id: isImpurityRemoval
        ? selectedHarvestBatch?.aggregateLotId || null
        : selectedTransferStock?.harvest_lot_id || null,
      source_physical_state: selectedTransferStock?.source_physical_state || null,
      audit_json: {
        ...(isImpurityRemoval ? { impurity_type: form.impurityType } : {}),
        ...(form.vehicleId
          ? {
              transport: {
                vehicle_source: selectedVehicle?.source || "reference_vehicles",
              },
            }
          : {}),
      },
      created_by: profile.id,
      ticket_type: meta.ticketType,
      op_type: meta.opType,
      direction: meta.direction,
      source_kind: meta.sourceKind,
      destination_kind: form.operationType === "harvest_incoming" ? "warehouse" : meta.destinationKind,
      source_id: form.operationType === "harvest_incoming" ? form.fieldId : form.operationType === "supplier_receipt" ? supplierCounterpartyId : form.warehouseFromId || null,
      destination_id: form.operationType === "harvest_incoming"
        ? form.warehouseToId
        : form.operationType === "issue_to_field" ? form.fieldId : form.operationType === "shipment_outbound" ? form.buyerId : form.operationType === "drying" ? form.processingPointId : form.warehouseToId || null,
      processing_node_id: null,
      crop_structure_allocation_id: form.operationType === "harvest_incoming" || isFieldIssue ? form.cropStructureAllocationId || null : null,
      supplier_id: form.operationType === "supplier_receipt" ? supplierCounterpartyId || null : null,
      buyer_id: form.operationType === "shipment_outbound" ? form.buyerId || null : null,
      shipment_purpose: form.operationType === "shipment_outbound" ? form.shipmentPurpose : null,
      destination_text: form.operationType === "shipment_outbound" ? form.destinationText.trim() || null : null,
      external_document_no: form.operationType === "shipment_outbound" ? form.externalDocumentNo.trim() || null : null,
      supplier_document_no: form.operationType === "supplier_receipt" ? form.supplierDocumentNo.trim() || null : null,
      receipt_mode: form.operationType === "supplier_receipt" ? form.supplierReceiptMode : null,
      supplier_receipt_kind: form.operationType === "supplier_receipt" ? "generic" : null,
      field_operation_type: isFieldIssue ? "issued_to_field" : null,
      field_material_category: isFieldIssue ? form.fieldMaterialCategory : null,
      linked_operation_id: isFieldIssue ? form.linkedOperationId || null : null,
      disposal_category: form.operationType === "disposal_writeoff" ? form.disposalCategory : null,
      field_id: form.operationType === "supplier_receipt" ? null : form.fieldId || null,
      warehouse_from_id: form.operationType === "supplier_receipt" ? null : form.warehouseFromId || null,
      warehouse_to_id: form.operationType === "supplier_receipt" && form.supplierReceiptMode === "direct" ? null : form.warehouseToId || null,
      processing_point_from_id: form.operationType === "drying" ? form.processingPointId || null : null,
      vehicle_id: form.vehicleId || null,
      driver_id: form.driverId || null,
      gross_weight_kg: isSupplierDirect ? null : isDirectQuantity ? movementQuantity : toNum(form.grossKg),
      tare_weight_kg: isSupplierDirect ? null : isDirectQuantity ? 0 : null,
      weigh_method: isDirectQuantity ? "manual_override_with_reason" : "preset_tare",
      notes: [
        form.operationType === "shipment_outbound" && form.externalDocumentNo.trim() ? `Документ отгрузки: ${form.externalDocumentNo.trim()}` : "",
        form.operationType === "shipment_outbound" ? `Цель отгрузки: ${shipmentPurposeLabels[form.shipmentPurpose]}` : "",
        form.operationType === "disposal_writeoff" && form.disposalReason.trim() ? `Причина списания: ${form.disposalReason.trim()}` : "",
        isImpurityRemoval ? `Вид примесей: ${impurityTypeLabels[form.impurityType]}` : "",
        ...supplierNotes,
        form.notes.trim(),
      ].filter(Boolean).join("\n") || null,
    };

    const line: TicketLineInput = {
      product_id: productId,
      crop_id: isImpurityRemoval
        ? selectedHarvestBatch?.cropId || null
        : form.operationType === "harvest_incoming" || (isFieldIssue && isSeedIssueOperation(form.fieldMaterialCategory))
          ? form.cropId
          : selectedTransferStock?.crop_id || null,
      quantity: movementQuantity,
      uom:
        form.operationType === "harvest_incoming" || isImpurityRemoval || (form.operationType === "supplier_receipt" && form.supplierReceiptMode === "weighbridge")
          ? "kg"
          : selectedTransferStock?.uom || inferProductUnit(productById.get(productId)),
      warehouse_from_id: form.warehouseFromId || null,
      warehouse_to_id: form.warehouseToId || null,
      notes: form.operationType === "harvest_incoming" ? "Приемка урожая" : isImpurityRemoval ? `Вывоз примесей: ${impurityTypeLabels[form.impurityType]}` : form.operationType === "supplier_receipt" ? "Приемка от поставщика" : form.operationType === "transfer_between_warehouses" ? "Межскладское перемещение" : undefined,
      lot_id: isImpurityRemoval
        ? selectedHarvestBatch?.aggregateLotId || selectedHarvestBatch?.batchCode || null
        : form.operationType === "supplier_receipt"
          ? form.supplierLot.trim() || null
          : (form.operationType === "transfer_between_warehouses" || isFieldIssue || isShipment || isDisposal)
            ? selectedTransferStock?.harvest_lot_id || selectedTransferStock?.batch_id || null
            : null,
      supplier_lot: form.operationType === "supplier_receipt" ? form.supplierLot.trim() || null : null,
      batch_id: isImpurityRemoval
        ? selectedHarvestBatch?.aggregateLot ? null : selectedHarvestBatch?.id || null
        : (form.operationType === "transfer_between_warehouses" || isFieldIssue || isShipment || isDisposal) && isUuidLike(selectedTransferStock?.batch_id)
          ? selectedTransferStock?.batch_id || null
          : null,
      batch_class: isImpurityRemoval ? "commodity" : form.operationType === "transfer_between_warehouses" || isFieldIssue || isShipment || isDisposal ? selectedTransferStock?.batch_class || null : null,
      variety_id: isImpurityRemoval ? selectedHarvestBatch?.varietyId || null : form.operationType === "transfer_between_warehouses" || isFieldIssue || isShipment || isDisposal ? selectedTransferStock?.variety_id || null : form.operationType === "harvest_incoming" ? form.varietyId || null : null,
      reproduction_id: isImpurityRemoval ? selectedHarvestBatch?.reproductionId || null : form.operationType === "transfer_between_warehouses" || isFieldIssue || isShipment || isDisposal ? selectedTransferStock?.reproduction_id || null : form.operationType === "harvest_incoming" ? form.reproductionId || null : null,
      operation_line_id: isImpurityRemoval ? selectedHarvestBatch?.operationLineId || null : isFieldIssue ? form.linkedOperationLineId || null : null,
      composition_hash: selectedTransferStock?.composition_hash || null,
      composition_snapshot: selectedTransferStock?.composition_snapshot || [],
      is_mixed_harvest: Boolean(selectedTransferStock?.is_mixed_harvest),
      moisture_percent: form.operationType === "harvest_incoming"
        ? toNum(form.harvestMoisture)
        : form.operationType === "drying"
          ? toNum(form.moistureIn)
          : null,
      net_line_weight_kg: form.operationType === "drying" ? toNum(form.dryingOutputKg) : null,
    };
    const linesToCreate: TicketLineInput[] =
      form.operationType === "supplier_receipt" && form.supplierReceiptMode === "direct"
        ? supplierReceiptGenericLineDrafts.map((draft, index) => {
            const qty = toNum(draft.quantityKg) ?? (supplierReceiptGenericLineDrafts.length === 1 ? movementQuantity : 0);
            const unitPrice = toNum(draft.unitPrice);
            const uom = normalizeUnit(productById.get(draft.productId)?.stockUnit || "");
            return {
              product_id: draft.productId,
              crop_id: null,
              quantity: qty,
              uom,
              warehouse_to_id: draft.warehouseToId || null,
              unit_price: unitPrice,
              amount: unitPrice != null && qty ? unitPrice * qty : null,
              notes: [
                "Приемка от поставщика",
                draft.notes.trim(),
                supplierReceiptGenericLineDrafts.length > 1 ? `Строка ${index + 1} из ${supplierReceiptGenericLineDrafts.length}` : "",
              ].filter(Boolean).join("\n"),
              lot_id: draft.supplierLot.trim() || null,
              supplier_lot: draft.supplierLot.trim() || null,
              batch_class: null,
            };
          })
        : [line];

    const buildLocalLines = (ticketId: string) => linesToCreate.map((item, index) => {
      const harvestCropName = form.operationType === "harvest_incoming"
        ? selectedHarvestAllocation?.cropName || ""
        : "";
      const productName = harvestCropName || productById.get(item.product_id)?.name || "Материал";
      return {
        id: `local-${ticketId}-${index}`,
        product_id: item.product_id,
        crop_id: item.crop_id || null,
        product_name: productName,
        product_name_snapshot: productName,
        quantity: item.quantity,
        uom: item.uom || "kg",
        variety_id: item.variety_id || null,
        variety_name: form.operationType === "harvest_incoming" ? selectedHarvestAllocation?.varietyName || null : null,
        reproduction_id: item.reproduction_id || null,
        reproduction_name: form.operationType === "harvest_incoming" ? selectedHarvestAllocation?.reproductionName || null : null,
        batch_class: item.batch_class || null,
        lot_id: item.lot_id || null,
        warehouse_from_id: item.warehouse_from_id || null,
        warehouse_to_id: item.warehouse_to_id || null,
        moisture_percent: item.moisture_percent || null,
        operation_line_id: item.operation_line_id || null,
      };
    });

    setSubmitting(true);
    try {
      const idempotencyKey = createTicketIdempotencyRef.current || crypto.randomUUID();
      createTicketIdempotencyRef.current = idempotencyKey;
      if (idempotencyPersistKey) localStorage.setItem(idempotencyPersistKey, idempotencyKey);
      if (isTransferDirect && selectedTransferStock) {
        await createWarehouseTransfer(profile.company_id, form.warehouseFromId, {
          destination_warehouse_id: form.warehouseToId,
          product_id: selectedTransferStock.product_id,
          harvest_lot_id: selectedTransferStock.harvest_lot_id || null,
          source_physical_state: selectedTransferStock.source_physical_state || null,
          quantity: Number(form.quantityKg),
          vehicle_id: form.vehicleId,
          driver_id: form.driverId,
          notes: form.notes.trim() || null,
        }, idempotencyKey);
        createTicketIdempotencyRef.current = null;
        if (idempotencyPersistKey) localStorage.removeItem(idempotencyPersistKey);
        toast({ title: "Перемещение проведено", description: "Ledger OUT/IN создан существующим складским lifecycle." });
        setForm((prev) => ({ ...INITIAL_FORM, operationType: prev.operationType, transferMode: prev.transferMode }));
        void refreshLiveData({ source: "local", table: "stock_ledger_entries" });
        return;
      }
      if (form.operationType === "harvest_incoming") {
        const now = new Date().toISOString();
        setPendingOpenTicket({
          ...ticket,
          id: `pending-${idempotencyKey}`,
          ticket_no: "Сохраняется",
          status: "active",
          weigh_method: ticket.weigh_method || "preset_tare",
          is_finalized: false,
          is_voided: false,
          created_at: now,
          updated_at: now,
          crop_name_snapshot: selectedHarvestAllocation?.cropName || null,
          variety_name_snapshot: selectedHarvestAllocation?.varietyName || null,
          reproduction_name_snapshot: selectedHarvestAllocation?.reproductionName || null,
          created_by_person_id: operatorState.operator?.id || null,
          opened_by_person_name: operatorState.operator?.name || null,
          operator_attribution_source: operatorState.operator?.id ? "ticket_person" : "unrecorded",
          lines: buildLocalLines(`pending-${idempotencyKey}`),
        });
      }
      const result = await createTicket(ticket, linesToCreate, [], idempotencyKey);
      createTicketIdempotencyRef.current = null;
      if (idempotencyPersistKey) localStorage.removeItem(idempotencyPersistKey);
      const createdStatus = String(result?.ticket?.status || "");
      const createdTicket = result?.ticket as WeighbridgeTicket | undefined;
      if (createdTicket?.id && createdStatus !== "finalized") {
        const localLines = createdTicket.lines || buildLocalLines(createdTicket.id);
        const attributedCreatedTicket = {
          ...createdTicket,
          created_by_person_id: createdTicket.created_by_person_id || operatorState.operator?.id || null,
          opened_by_person_name: createdTicket.opened_by_person_name || operatorState.operator?.name || null,
          operator_attribution_source: createdTicket.operator_attribution_source || (operatorState.operator?.id ? "ticket_person" : "unrecorded"),
        } as WeighbridgeTicket;
         setTickets((current) => [
           ...current.filter((item) => item.id !== createdTicket.id),
           { ...attributedCreatedTicket, lines: localLines },
         ]);
         adjustActiveHarvestTicketCount(attributedCreatedTicket, 1);
         markTransportAssignmentOpen(attributedCreatedTicket);
      }
      if (isSupplierDirect || createdStatus === "finalized") {
        toast({
          title: "Приход по накладной проведён",
          description: "Партия и складское движение созданы без активного талона весовой.",
        });
      }
      if (!isSupplierDirect && createdStatus !== "finalized") {
        toast({
          title: "Талон создан",
          description: result?.ticket?.ticket_no
            ? `Талон ${result.ticket.ticket_no} добавлен в активные`
            : "Талон добавлен в активные",
        });
      }
      setForm((prev) => {
        if (prev.operationType === "harvest_incoming") {
          return {
            ...INITIAL_FORM,
            operationType: "harvest_incoming",
            fieldId: prev.fieldId,
            cropStructureAllocationId: prev.cropStructureAllocationId,
            cropId: prev.cropId,
            varietyId: prev.varietyId,
            reproductionId: prev.reproductionId,
            warehouseToId: prev.warehouseToId,
          };
        }
        return {
          ...INITIAL_FORM,
          operationType: prev.operationType,
          fieldId: prev.fieldId,
          warehouseFromId: prev.warehouseFromId,
          warehouseToId: prev.warehouseToId,
          processingPointId: prev.processingPointId,
          cropId: prev.cropId,
          varietyId: prev.varietyId,
          reproductionId: prev.reproductionId,
          cropStructureAllocationId: prev.cropStructureAllocationId,
          supplierId: form.operationType === "supplier_receipt" ? supplierCounterpartyId : prev.supplierId,
          buyerId: prev.buyerId,
          supplierDocumentNo: prev.supplierDocumentNo,
          shipmentPurpose: prev.shipmentPurpose,
          destinationText: prev.destinationText,
          externalDocumentNo: prev.externalDocumentNo,
          supplierReceiptMode: prev.supplierReceiptMode,
          supplierItemMode: prev.supplierItemMode,
          transferMode: prev.transferMode,
          fieldIssueMode: prev.fieldIssueMode,
          fieldMaterialCategory: prev.fieldMaterialCategory,
          supplierLot: "",
          harvestYear: prev.harvestYear,
          productId: prev.productId,
          stockIdentityKey: prev.stockIdentityKey,
          sourceBatchId: prev.operationType === "impurity_removal" ? prev.sourceBatchId : "",
          impurityType: prev.impurityType,
          linkedOperationId: prev.linkedOperationId,
          linkedOperationLineId: prev.linkedOperationLineId,
          disposalCategory: prev.disposalCategory,
          disposalReason: prev.disposalReason,
          unitPrice: "",
          notes: prev.notes,
        };
      });
      if (form.operationType === "harvest_incoming") {
        setCommentOpen(false);
      }
      setSupplierReceiptLines([]);
      setShowSupplierExtraFields(false);
      window.setTimeout(() => {
        void refreshLiveData({
          source: "realtime",
          table: createdStatus === "finalized" ? "stock_ledger_entries" : "tickets",
        });
      }, 1_500);
    } catch (e: any) {
      toast({ title: "Ошибка создания", description: e?.message || "Не удалось создать талон", variant: "destructive" });
    } finally {
      setPendingOpenTicket(null);
      setSubmitting(false);
    }
  };

  const saveActiveTicketMoisture = async () => {
    if (!activeTicket || activeTicket.op_type !== "harvest_incoming" || !profile?.id || !canOperate || moistureSaving) return;
    const raw = closingMoisture.trim().replace(",", ".");
    const moisture = raw === "" ? null : Number(raw);
    if (moisture != null && (!Number.isFinite(moisture) || moisture < 0 || moisture > 100)) {
      toast({ title: "Ошибка", description: "Влажность должна быть от 0 до 100 %.", variant: "destructive" });
      return;
    }
    const normalized = moisture == null ? "" : String(moisture);
    if (normalized === moistureSavedValue) return;

    setMoistureSaving(true);
    try {
      await patchTicket(activeTicket.id, profile.id, { moisture_percent: moisture });
      const applyMoisture = (ticket: WeighbridgeTicket) => ({
        ...ticket,
        lines: (ticket.lines || []).map((line, index) => index === 0 ? { ...line, moisture_percent: moisture } : line),
      });
      setActiveTicket((current) => current?.id === activeTicket.id ? applyMoisture(current) : current);
      setTickets((current) => current.map((ticket) => ticket.id === activeTicket.id ? applyMoisture(ticket) : ticket));
      setClosingMoisture(normalized);
      setMoistureSavedValue(normalized);
    } catch (error: any) {
      toast({ title: "Влажность не сохранена", description: error?.message || "Повторите ввод", variant: "destructive" });
    } finally {
      setMoistureSaving(false);
    }
  };

  const patchTicketWithTareConfirmation = async (
    ticketId: string,
    patch: Parameters<typeof patchTicket>[2]
  ) => {
    try {
      return await patchTicket(ticketId, profile?.id || "", patch);
    } catch (error: any) {
      const payload = error?.payload as Record<string, any> | undefined;
      if (!payload?.requires_confirmation) throw error;
      const difference = Number(payload.difference_percent || 0);
      const confirmed = await siteConfirm({
        title: "Проверьте тару",
        description: [
          `Предыдущая тара этой машины: ${formatWeightKg(payload.previous_tare_kg)}.`,
          `Сейчас: ${formatWeightKg(payload.current_tare_kg)}.`,
          `Разница: ${difference > 0 ? "+" : ""}${difference.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%.`,
        ].join(" "),
        actionLabel: "Всё верно — продолжить",
      });
      if (!confirmed) throw new Error("Проверьте значение тары.");
      return patchTicket(ticketId, profile?.id || "", { ...patch, confirm_tare_variance: true });
    }
  };

  const openActiveTicketEditor = () => {
    if (!activeTicket) return;
    setEditGrossKg(activeTicket.gross_weight_kg == null ? "" : String(activeTicket.gross_weight_kg));
    setEditTareKg(activeTicket.tare_weight_kg == null ? "" : String(activeTicket.tare_weight_kg));
    setEditReason("");
    setOpenTicketEditOpen(true);
  };

  const saveOpenTicketCorrection = async () => {
    if (!activeTicket || !profile?.id || ticketCorrectionBusy) return;
    const gross = parseStrictWeightKg(editGrossKg, "Брутто");
    if (!gross.ok || gross.value <= 0) {
      toast({ title: "Проверьте брутто", description: gross.ok ? "Брутто должно быть больше нуля." : gross.message, variant: "destructive" });
      return;
    }
    const tare = editTareKg.trim() ? parseStrictWeightKg(editTareKg, "Тара") : null;
    if (tare && (!tare.ok || tare.value <= 0)) {
      toast({ title: "Проверьте тару", description: tare.ok ? "Тара должна быть больше нуля." : tare.message, variant: "destructive" });
      return;
    }
    if (tare?.ok) {
      const validation = validateHarvestWeights(gross.value, tare.value);
      if (!validation.ok) {
        toast({ title: "Проверьте вес", description: validation.message, variant: "destructive" });
        return;
      }
    }

    setTicketCorrectionBusy(true);
    try {
      await patchTicketWithTareConfirmation(activeTicket.id, {
        gross_weight_kg: gross.value,
        ...(tare?.ok ? { tare_weight_kg: tare.value } : {}),
        reason: editReason.trim() || null,
      });
      const details = await getTicketDetails(activeTicket.id, profile.id);
      const corrected = (details as any).ticket as WeighbridgeTicket;
      setActiveTicket(corrected);
      setTickets((current) => current.map((ticket) => ticket.id === corrected.id ? corrected : ticket));
      setClosingTare(corrected.tare_weight_kg == null ? "" : String(corrected.tare_weight_kg));
      setOpenTicketEditOpen(false);
      toast({ title: "Талон исправлен", description: "Изменение и автор сохранены в истории." });
    } catch (error: any) {
      toast({ title: "Не удалось исправить талон", description: error?.message || "Повторите попытку", variant: "destructive" });
    } finally {
      setTicketCorrectionBusy(false);
    }
  };

  const beginFinalizedTicketCorrection = async () => {
    if (!historyPreviewTicket || !ticketCorrectionReason.trim() || ticketCorrectionBusy) return;
    setTicketCorrectionBusy(true);
    try {
      const started = await startTicketCorrection(historyPreviewTicket.id, ticketCorrectionReason.trim());
      const replacementId = String((started as any)?.ticket?.id || "");
      if (!replacementId) throw new Error("Исправленный талон не создан.");
      const details = await getTicketDetails(replacementId, profile?.id);
      const replacement = (details as any).ticket as WeighbridgeTicket;
      setHistoryPreviewTicket(null);
      setTicketCorrectionOpen(false);
      setTicketCorrectionReason("");
      setActiveTicket(replacement);
      setClosingTare(replacement.tare_weight_kg == null ? "" : String(replacement.tare_weight_kg));
      setClosingMoisture(replacement.lines?.[0]?.moisture_percent == null ? "" : String(replacement.lines[0].moisture_percent));
      toast({ title: "Создан исправленный талон", description: `Проверьте данные и завершите талон ${replacement.ticket_no}.` });
    } catch (error: any) {
      toast({ title: "Исправление недоступно", description: error?.message || "Повторите попытку", variant: "destructive" });
    } finally {
      setTicketCorrectionBusy(false);
    }
  };

  const closeTicket = async () => {
    if (!activeTicket || !profile?.id || !canOperate || finalizing || finalizingRef.current) return;
    const isDirectSupplierTicket = activeTicket.op_type === "supplier_receipt" && String((activeTicket as any).receipt_mode || "") === "direct";
    const isDirectTransferTicket = activeTicket.op_type === "warehouse_transfer" && activeTicket.weigh_method === "manual_override_with_reason";
    const isDirectFieldIssueTicket = activeTicket.op_type === "issue_to_field" && activeTicket.weigh_method === "manual_override_with_reason";
    const isDirectQuantityTicket = isDirectSupplierTicket || isDirectTransferTicket || isDirectFieldIssueTicket;
    const g = isDirectQuantityTicket
      ? Number(activeTicket.gross_weight_kg || 0) || activeTicketLineTotal
      : Number(activeTicket.gross_weight_kg || 0);
    const strictTare = isDirectQuantityTicket ? null : parseStrictWeightKg(closingTare, "Тара");
    if (strictTare && !strictTare.ok) return toast({ title: "Ошибка", description: strictTare.message, variant: "destructive" });
    const t = isDirectQuantityTicket ? 0 : strictTare?.ok ? strictTare.value : 0;
    if (!Number.isFinite(g) || g <= 0) return toast({ title: "Ошибка", description: "Брутто не заполнено", variant: "destructive" });
    if (!isDirectQuantityTicket) {
      const weightValidation = validateHarvestWeights(g, t);
      if (!weightValidation.ok) {
        return toast({ title: "Ошибка", description: weightValidation.message, variant: "destructive" });
      }
    }
    const isHarvestClosure = activeTicket.op_type === "harvest_incoming";
    const moisture = closingMoisture.trim()
      ? Number(closingMoisture.replace(",", "."))
      : null;
    if (isHarvestClosure && moisture != null && (!Number.isFinite(moisture) || moisture < 0 || moisture > 100)) {
      return toast({ title: "Ошибка", description: "Влажность должна быть от 0 до 100 %.", variant: "destructive" });
    }
    const acceptedLabel = isHarvestClosure && pure != null
      ? ` Принято на склад: ${formatWeightKg(pure)}.`
      : "";
    finalizingRef.current = true;
    if (!(await siteConfirm({ title: "Закрыть талон", description: `После закрытия будет создано движение по складу.${acceptedLabel}`, actionLabel: "Закрыть" }))) {
      finalizingRef.current = false;
      return;
    }

    setFinalizing(true);
    try {
      if (isHarvestClosure) {
        const currentFinalizeKey = finalizeTicketIdempotencyRef.current?.ticketId === activeTicket.id
          ? finalizeTicketIdempotencyRef.current.key
          : crypto.randomUUID();
        finalizeTicketIdempotencyRef.current = { ticketId: activeTicket.id, key: currentFinalizeKey };
        const finalizeHarvest = async (confirmTareVariance: boolean) => finalizeTicket(activeTicket.id, profile.id, {
          tare_weight_kg: t,
          moisture_percent: moisture,
          confirm_tare_variance: confirmTareVariance,
          idempotency_key: currentFinalizeKey,
        });
        try {
          await finalizeHarvest(false);
        } catch (error: any) {
          const payload = error?.payload as Record<string, any> | undefined;
          if (!payload?.requires_confirmation) throw error;
          const previous = formatWeightKg(payload.previous_tare_kg);
          const current = formatWeightKg(payload.current_tare_kg);
          const confirmed = await siteConfirm({
            title: "Необычная тара",
            description: `Предыдущая тара: ${previous}. Текущая: ${current}. Подтвердить отклонение?`,
            actionLabel: "Подтвердить",
          });
          if (!confirmed) return;
          await finalizeHarvest(true);
        }
      } else {
        await patchTicketWithTareConfirmation(activeTicket.id, {
          tare_weight_kg: isDirectQuantityTicket ? 0 : toNum(closingTare) ?? undefined,
          status: "ready_to_close",
        });
        await finalizeTicket(activeTicket.id, profile.id);
      }
      toast({ title: "Талон закрыт", description: "Движение зафиксировано" });
      setActiveTicket(null);
      adjustActiveHarvestTicketCount(activeTicket, -1);
      releaseTransportAssignment(activeTicket, true);
      setTickets((current) => current.filter((ticket) => ticket.id !== activeTicket.id));
      setClosingTare("");
      setClosingMoisture("");
      finalizeTicketIdempotencyRef.current = null;
      window.setTimeout(() => {
        void refreshLiveData({ source: "realtime", table: "tickets" });
      }, 1_500);
    } catch (e: any) {
      const message = String(e?.message || "");
      if (message.toLowerCase().includes("read-only") || message.toLowerCase().includes("already finalized")) {
        try {
          if (!isHarvestClosure) await finalizeTicket(activeTicket.id, profile.id);
        } catch {
          // If the ticket is already finalized, refresh is still the safest UI state.
        }
        toast({ title: "Талон уже закрыт", description: "Обновляю список талонов и остатки.", variant: "default" });
        setActiveTicket(null);
        adjustActiveHarvestTicketCount(activeTicket, -1);
        releaseTransportAssignment(activeTicket, true);
        setTickets((current) => current.filter((ticket) => ticket.id !== activeTicket.id));
        setClosingTare("");
        setClosingMoisture("");
        finalizeTicketIdempotencyRef.current = null;
        void refreshLiveData({ source: "local", table: "tickets" });
        return;
      }
      const traceId = String(e?.payload?.trace_id || "").trim();
      const description = `${e?.message || "Не удалось закрыть талон"}${traceId ? `\nTrace ID: ${traceId}` : ""}`;
      toast({ title: "Ошибка закрытия", description, variant: "destructive" });
    } finally {
      finalizingRef.current = false;
      setFinalizing(false);
    }
  };

  const handleVoid = async () => {
    if (!activeTicket || !profile?.id || !canCorrectTicket || voiding) return;
    if (!voidReason.trim()) return toast({ title: "Ошибка", description: "Укажите причину аннулирования", variant: "destructive" });
    const confirmed = await siteConfirm({
      title: "Аннулировать талон",
      description: "Талон будет отменен через storno. Действие нельзя выполнить без указанной причины.",
      actionLabel: "Аннулировать",
    });
    if (!confirmed) return;
    setVoiding(true);
    try {
      await voidTicket(activeTicket.id, profile.id, voidReason.trim());
      toast({ title: "Талон аннулирован", description: "Отмена выполнена через storno" });
      setVoidReasonOpen(false);
      setVoidReason("");
      setActiveTicket(null);
      adjustActiveHarvestTicketCount(activeTicket, -1);
      releaseTransportAssignment(activeTicket, false);
      setTickets((current) => current.filter((ticket) => ticket.id !== activeTicket.id));
      window.setTimeout(() => {
        void refreshLiveData({ source: "realtime", table: "tickets" });
      }, 1_500);
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
    const reason = voidReason.trim();
    if (!reason) {
      toast({ title: "Ошибка", description: "Укажите причину в поле аннулирования/cleanup", variant: "destructive" });
      return;
    }
    const confirmed = await siteConfirm({
      title: titleMap[action],
      description: "Админ-действие будет записано в историю талона. Продолжить?",
      actionLabel: "Подтвердить",
    });
    if (!confirmed) return;
    try {
      await adminTicketAction(activeTicket.id, profile.id, action, reason);
      toast({ title: "Выполнено", description: "Админ-действие применено успешно" });
      setVoidReason("");
      setActiveTicket(null);
      releaseTransportAssignment(activeTicket, false);
      setTickets((current) => current.filter((ticket) => ticket.id !== activeTicket.id));
      void refreshLiveData({ source: "local", table: "tickets" });
    } catch (e: any) {
      toast({
        title: "Ошибка admin cleanup",
        description: e?.message || "Не удалось применить админ-действие",
        variant: "destructive",
      });
    }
  };

  if (authLoading) return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-black/90 p-4 backdrop-blur-md">
      <div role="dialog" aria-modal="true" aria-labelledby="weighbridge-first-paint-title" className="w-full max-w-sm rounded-lg border border-slate-700 bg-[#101724] p-6 text-slate-100 shadow-2xl">
        <Loader2 className="mx-auto h-7 w-7 animate-spin text-yellow-400" />
        <div id="weighbridge-first-paint-title" className="mt-4 text-center text-lg font-semibold">Проверяем действующую смену…</div>
        <div className="mt-2 text-center text-sm text-slate-400">Рабочая Весовая откроется после проверки доступа.</div>
      </div>
    </div>
  );
  if (!canView) return <PageHeader title="Весовая и движения" description="Доступ ограничен по роли" />;

  const openShiftAction = async () => {
    const selected = operatorState.operator?.id || eligibleOperators[0]?.id || "";
    setOperatorDialogRequested(true);
    setOperatorPersonId(selected);
    setOperatorPin("");
    setOperatorError("");
    setOperatorDialogOpen(true);
  };

  const submitOperatorAction = async () => {
    if (!profile?.company_id || !operatorPersonId || !/^\d{6}$/.test(operatorPin)) return;
    setOperatorBusy(true);
    setOperatorError("");
    const mutationGeneration = ++operatorMutationGenerationRef.current;
    operatorMutationInFlightRef.current = true;
    invalidateOperatorSessionRequest();
    try {
      const isHandover = Boolean(
        activeShift?.id && activeShift?.operator_person_id && activeShift.operator_person_id !== operatorPersonId
      );
      const nextState = isHandover
        ? await handoverWeighbridgeOperator(profile.company_id, operatorPersonId, operatorPin, shiftHandoverNote.trim() || undefined)
        : await unlockWeighbridgeOperator(profile.company_id, operatorPersonId, operatorPin);
      const completeOperatorState = {
        ...nextState,
        operators: Array.isArray(nextState.operators) ? nextState.operators : operatorState.operators,
      };
      if (mutationGeneration !== operatorMutationGenerationRef.current) return;
      operatorUnlockConfirmedAtRef.current = Date.now();
      commitOperatorState(completeOperatorState);
      setOperatorSessionStatus("ready");
      setActiveShift(nextState.shift || null);
      setOperatorPin("");
      setOperatorError("");
      setShiftHandoverNote("");
      setOperatorDialogRequested(false);
      setOperatorDialogOpen(false);
      toast({
        title: isHandover ? "Смена передана" : activeShift?.id ? "Терминал разблокирован" : "Смена открыта",
        description: nextState.operator?.name || "Весовщик подтверждён.",
      });
      // The mutation response is canonical. Realtime/background invalidation will reconcile it
      // without making the unlocked form compete with a full bootstrap.
    } catch (e: any) {
      const message = String(e?.message || "");
      const wrongPin = Number(e?.status) === 401 || message.toLowerCase().includes("неверный pin");
      setOperatorPin("");
      setOperatorSessionStatus(wrongPin ? "ready" : "error");
      setOperatorError(wrongPin ? "Неверный PIN" : "Не удалось проверить PIN. Повторите");
    } finally {
      if (mutationGeneration === operatorMutationGenerationRef.current) {
        operatorMutationInFlightRef.current = false;
      }
      setOperatorBusy(false);
    }
  };

  const lockOperatorAction = async () => {
    if (!profile?.company_id) return;
    invalidateOperatorSessionRequest();
    try {
      await lockWeighbridgeOperator(profile.company_id);
      updateOperatorState((state) => ({ ...state, unlocked: false, operator: null, session_expires_at: null }));
      setOperatorSessionStatus("ready");
      setOperatorPin("");
      setOperatorDialogOpen(true);
    } catch (e: any) {
      toast({ title: "Не удалось заблокировать терминал", description: e?.message, variant: "destructive" });
    }
  };

  const closeShiftAction = async () => {
    if (!profile?.company_id || !profile?.id || !activeShift) return;
    try {
      await closeShift(profile.company_id, profile.id, {
        closingNote: "manual close from weighbridge page",
        handoverNote: shiftHandoverNote.trim() || undefined,
      });
      setClosingTare("");
      setClosingMoisture("");
      setMoistureSavedValue("");
      setCommentOpen(false);
      toast({ title: "Смена закрыта", description: "Смена успешно закрыта." });
      setShiftHandoverNote("");
      setShiftDialogOpen(false);
      updateOperatorState((state) => ({ ...state, shift: null, unlocked: false, operator: null, session_expires_at: null, shift_expires_at: null }));
      setActiveShift(null);
      setOperatorSessionStatus("checking");
      setOperatorDialogOpen(true);
      await verifyOperatorSession();
    } catch (e: any) {
      toast({
        title: "Не удалось закрыть смену",
        description: e?.message || "Проверьте незакрытые талоны и handover note",
        variant: "destructive",
      });
    }
  };

  const driverNameForId = (driverId: string | null | undefined) => {
    if (!driverId) return "";
    return driverNames[String(driverId)] || drivers.find((driver) => driver.id === driverId)?.name || "";
  };
  const trailerForTicket = (ticket: WeighbridgeTicket | null | undefined) => {
    const transport = ticket?.audit_json?.transport as Record<string, unknown> | undefined;
    const trailerId = String(transport?.trailer_id || "");
    const trailer = trailers.find((item) => item.id === trailerId);
    if (trailer) return trailer;
    const name = String(transport?.trailer_name_snapshot || "");
    if (!name) return null;
    return {
      id: trailerId,
      name,
      model: name,
      plate: String(transport?.trailer_plate_snapshot || ""),
      type: "trailer",
      fleetType: "tractor_trailer",
      transportCategory: "trailer",
      source: "reference_vehicles" as const,
      primaryPersonnelId: null,
    };
  };
  const activeDriverName = activeTicket ? driverNameForId(activeTicket.driver_id) : "";
  const activeVehicle = activeTicket ? vehicles.find((v) => v.id === activeTicket.vehicle_id) : null;
  const activeTrailer = trailerForTicket(activeTicket);
  const activeLine = activeTicket?.lines?.[0] ?? null;
  const allocationLabelById = new Map<string, string>();
  Object.values(harvestStructureByField).flat().forEach((item) => {
    allocationLabelById.set(
      item.allocationId,
      `${harvestIdentityLabel(item.cropName, item.varietyName, item.reproductionName)} • ${item.areaHa.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} га`
    );
  });
  const ticketAllocationLabel = (ticket: any) => {
    const id = String(ticket?.crop_structure_allocation_id || "");
    return ticket?.crop_structure_allocation_label || allocationLabelById.get(id) || (id ? `Участок ${id.slice(0, 8)}` : "-");
  };
  const isHarvestTicket = (ticket: any) => String(ticket?.op_type || "") === "harvest_incoming";
  const isDirectSupplierTicket = (ticket: any) => String(ticket?.op_type || "") === "supplier_receipt" && String(ticket?.receipt_mode || "") === "direct";
  const supplierName = (ticket: any) => suppliers.find((item) => item.id === ticket?.supplier_id)?.name || (ticket as any)?.supplier_name_snapshot || "-";
  const buyerName = (ticket: any) => buyers.find((item) => item.id === ticket?.buyer_id)?.name || (ticket as any)?.buyer_name_snapshot || "-";
  const warehouseName = (id: string | null | undefined) => warehouses.find((w) => w.id === id)?.name || "-";
  const lineWarehouseName = (line: any, ticket: any) =>
    line?.warehouse_to_name ||
    line?.warehouse_from_name ||
    warehouseName(line?.warehouse_to_id || line?.warehouse_from_id || ticket?.warehouse_to_id || ticket?.warehouse_from_id);
  const productSummary = (ticket: any, limit = 3) => {
    const names = (ticket?.lines || []).map((line: any) => String(line.product_name || line.product_name_snapshot || "").trim()).filter(Boolean);
    if (names.length === 0) return "-";
    const shown = names.slice(0, limit).join(", ");
    return names.length > limit ? `${shown} + ещё ${names.length - limit}` : shown;
  };
  const ticketQuantitySummary = (ticket: any, limit = 3) => {
    if (ticket?.correction_of_ticket_id && ticket?.net_weight_kg != null) {
      return formatQuantityWithUnit(ticket.net_weight_kg, "kg");
    }
    const lines = ticket?.lines || [];
    if (lines.length > 0) {
      const shown = lines.slice(0, limit).map((line: any) => formatQuantityWithUnit(line.quantity, line.uom)).join(", ");
      return lines.length > limit ? `${shown} + ещё ${lines.length - limit}` : shown;
    }
    return ticket?.net_weight_kg != null ? formatQuantityWithUnit(ticket.net_weight_kg, "kg") : "-";
  };
  const ticketCardMeta = (ticket: any, vehicleName: string, driverName: string) => {
    if (isDirectSupplierTicket(ticket)) return `Поставка от ${supplierName(ticket)}`;
    return `${operationUiLabel(ticket.op_type)} • ${vehicleName} • ${driverName}`;
  };
  const ticketRouteSummary = (ticket: any) => {
    if (!ticket) return "-";
    if (ticket.op_type === "supplier_receipt") return `Поставка от ${supplierName(ticket)} → ${warehouseName(ticket.warehouse_to_id)}`;
    if (ticket.op_type === "harvest_incoming") return `${fields.find((f) => f.id === ticket.field_id)?.name || "Поле"} → ${warehouseName(ticket.warehouse_to_id)}`;
    if (ticket.op_type === "warehouse_transfer") return `${warehouseName(ticket.warehouse_from_id)} → ${warehouseName(ticket.warehouse_to_id)}`;
    if (ticket.op_type === "shipment_outbound") return `${warehouseName(ticket.warehouse_from_id)} → ${buyerName(ticket)}`;
    if (ticket.op_type === "issue_to_field") return `${warehouseName(ticket.warehouse_from_id)} → ${fields.find((f) => f.id === ticket.field_id)?.name || "Поле"}`;
    if (ticket.op_type === "weighbridge_impurities") {
      const batch = harvestBatches.find((item) => item.id === ticket.batch_id);
      return `${warehouseName(ticket.warehouse_from_id)} → ${batch ? `${batch.cropName} / ${batch.varietyName}` : "вывоз примесей"}`;
    }
    return `${warehouseName(ticket.warehouse_from_id)} → ${ticket.destination_text || ticket.destination_kind || "-"}`;
  };
  const ticketPaperLabels = (ticket: WeighbridgeTicket): WeighbridgeTicketPaperLabels => {
    const vehicle = vehicles.find((item) => item.id === ticket.vehicle_id);
    const trailer = trailerForTicket(ticket);
    return {
      company: ticketCompanyLabel(ticket),
      field: fields.find((item) => item.id === ticket.field_id)?.name || ticket.field_name_snapshot,
      warehouseFrom: warehouses.find((item) => item.id === ticket.warehouse_from_id)?.name || ticket.warehouse_from_name_snapshot,
      warehouseTo: warehouses.find((item) => item.id === ticket.warehouse_to_id)?.name || ticket.warehouse_to_name_snapshot,
      supplier: supplierName(ticket),
      buyer: buyerName(ticket),
      vehicle: vehicle?.name || ticket.vehicle_name_snapshot,
      vehiclePlate: vehicle?.plate || ticket.vehicle_plate_snapshot,
      trailer: trailer?.name || ticket.trailer_name_snapshot,
      trailerPlate: trailer?.plate || ticket.trailer_plate_snapshot,
      driver: driverNameForId(ticket.driver_id) || ticket.driver_name_snapshot,
    };
  };
  const from = activeTicket ? (activeTicket.direction === "incoming" ? fields.find((f) => f.id === activeTicket.field_id)?.name : warehouses.find((w) => w.id === activeTicket.warehouse_from_id)?.name) || "-" : "-";
  const to = activeTicket ? (activeTicket.direction === "incoming" ? warehouses.find((w) => w.id === activeTicket.warehouse_to_id)?.name : activeTicket.direction === "outgoing" ? fields.find((f) => f.id === activeTicket.field_id)?.name : warehouses.find((w) => w.id === activeTicket.warehouse_to_id)?.name) || "-" : "-";
  const currentFieldSummary = form.fieldId ? harvestSummary.byField[form.fieldId] || null : null;
  const formatTonnes = (valueKg: number) => `${(Number(valueKg || 0) / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} т`;
  const formatMoisture = (value: number | null) => value == null
    ? "—"
    : `${value.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} %`;
  const terminalPanelClass = "rounded-2xl border border-slate-800/80 bg-[#101724]/95 shadow-[0_18px_60px_rgba(2,6,23,0.28)]";
  const formSectionClass = "rounded-2xl border border-slate-800/80 bg-[#0B1220]/72 p-3";
  const segmentClass = (active: boolean) =>
    active
      ? "h-9 border-yellow-500/70 bg-yellow-500/15 text-yellow-100 hover:bg-yellow-500/20"
      : "h-9 border-slate-800 bg-slate-950/60 text-slate-200 hover:border-slate-700 hover:bg-slate-900 hover:text-slate-50";
  const operatorDialogVisible = canUseOperatorSession && (
    operatorGateBlocked || (operatorDialogOpen && operatorDialogRequested)
  );
  return (
    <div
      ref={workspaceRef}
      {...(operatorGateBlocked ? ({ inert: "" } as any) : {})}
      aria-hidden={operatorGateBlocked ? true : undefined}
      className={`mx-auto max-w-[1680px] space-y-2 px-2 pb-4 sm:px-3 ${operatorGateBlocked ? "pointer-events-none select-none blur-sm opacity-35" : ""}`}
    >
      <div className="flex h-10 min-w-0 items-center gap-2">
        <div
          role="tablist"
          aria-label="Режим весовой"
          className="travkin-scrollbar flex h-10 min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden rounded-md border border-slate-800 bg-slate-950/70 p-1"
        >
          {WEIGHBRIDGE_MODES.map((mode) => {
            const active = form.operationType === mode.type;
            return (
              <button
                key={mode.type}
                type="button"
                role="tab"
                aria-selected={active}
                className={
                  active
                    ? "h-8 shrink-0 whitespace-nowrap rounded px-3 text-xs font-semibold text-slate-950 bg-yellow-400"
                    : "h-8 shrink-0 whitespace-nowrap rounded px-3 text-xs font-medium text-slate-300 hover:bg-slate-900 hover:text-slate-50"
                }
                onClick={() => void selectOperation(mode.type)}
              >
                {mode.label}
              </button>
            );
          })}
        </div>
        {canUseOperatorSession ? (
          <Button
            type="button"
            variant="outline"
            className={operatorState.unlocked
              ? "h-8 max-w-[210px] shrink-0 border-emerald-500/40 bg-emerald-500/10 px-2 text-xs text-emerald-100"
              : "h-8 shrink-0 border-amber-500/40 bg-amber-500/10 px-2 text-xs text-amber-100"}
            onClick={openShiftAction}
          >
            {operatorState.unlocked ? <UserRound className="mr-1 h-3.5 w-3.5" /> : <LockKeyhole className="mr-1 h-3.5 w-3.5" />}
            <span className="truncate">{operatorState.operator?.name || "Введите PIN"}</span>
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="h-8 w-8 border-slate-700 bg-slate-950 text-slate-100" aria-label="Дополнительные действия">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem onClick={() => setShiftDialogOpen(true)}>
              <Info className="mr-2 h-4 w-4" />Информация о смене
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => historyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              <Clock3 className="mr-2 h-4 w-4" />История талонов
            </DropdownMenuItem>
            {canUseInventory ? (
              <DropdownMenuItem asChild>
                <Link href="/warehouses/inventory"><ClipboardList className="mr-2 h-4 w-4" />Инвентаризация</Link>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            {activeShift ? (
              <DropdownMenuItem onClick={() => setShiftDialogOpen(true)}>Закрыть смену</DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={openShiftAction}>Открыть смену</DropdownMenuItem>
            )}
            {operatorState.unlocked ? (
              <DropdownMenuItem onClick={() => void lockOperatorAction()}>
                <LockKeyhole className="mr-2 h-4 w-4" />Заблокировать терминал
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <UniversalWorkspaceTabs
        tabs={workspaceTabs}
        selectedId={selectedWorkspaceId}
        onSelect={selectWorkspace}
        onAdd={addWorkspace}
        onRemove={(workspaceId) => void removeWorkspace(workspaceId)}
        onLimit={() => toast({ title: "Можно открыть не более 6 рабочих вкладок." })}
      />

      <div className="grid gap-3 xl:grid-cols-[minmax(760px,1fr)_340px]">
        <Card className={`${terminalPanelClass} overflow-hidden xl:col-start-1`}>
          <CardHeader className="border-b border-slate-800/80 px-4 py-3">
            <CardTitle className="flex flex-col gap-3 text-base text-slate-50 md:flex-row md:items-center md:justify-between">
              <span className="flex items-center gap-2">
                <Scale className="h-4 w-4 text-yellow-400" />
                Новый талон
              </span>
              <span className="flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2 md:min-w-[260px]">
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Live вес</span>
                <span className="text-2xl font-black leading-none text-white">{liveWeightKg.toLocaleString("ru-RU")} кг</span>
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            {coreResourceErrors.length > 0 ? (
              <div className="space-y-1 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-100" role="status">
                {coreResourceErrors.map((issue) => (
                  <div key={issue.code} className="flex flex-wrap items-center justify-between gap-2">
                    <span>{issue.message} Код ошибки: {issue.code}</span>
                    <button
                      type="button"
                      className="font-semibold text-amber-200 underline underline-offset-2 hover:text-white"
                      onClick={() => void load(undefined, true)}
                    >
                      Повторить
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            {!canOperate ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                Режим просмотра: создание и закрытие талонов недоступны.
              </div>
            ) : null}

            {form.operationType !== "harvest_incoming" ? (
            <div className={formSectionClass}>
              <div className="mb-3">
                <Label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Маршрут и документ</Label>
              </div>
            <div className="grid gap-3 md:grid-cols-2">
              {isFieldIssue ? (
                <div className="space-y-1">
                  <Label>Поле *</Label>
                  <Select value={form.fieldId} onValueChange={(v) => setForm((p) => ({ ...p, fieldId: v, cropStructureAllocationId: "", cropId: "", varietyId: "", reproductionId: "", stockIdentityKey: "", linkedOperationId: "", linkedOperationLineId: "" }))}>
                    <SelectTrigger className="h-8"><SelectValue placeholder="Выберите поле" /></SelectTrigger>
                    <SelectContent>{fields.map((f) => <SelectItem key={f.id} value={f.id}>{f.name} • {f.area.toFixed(2)} га</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ) : null}

              {(isTransfer || isFieldIssue || isDisposal || isShipment || isImpurityRemoval) ? (
                <div className="space-y-1">
                  <Label>{isImpurityRemoval ? "Склад" : "Склад-источник"} *</Label>
                  <Select value={form.warehouseFromId} onValueChange={(v) => setForm((p) => ({ ...p, warehouseFromId: v, sourceBatchId: "", stockIdentityKey: "", productId: "", varietyId: "", reproductionId: "", quantityKg: "" }))}>
                    <SelectTrigger className="h-8"><SelectValue placeholder="Выберите склад" /></SelectTrigger>
                    <SelectContent>{(isImpurityRemoval ? harvestWarehouses : warehouses).map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ) : null}

              {((form.operationType === "supplier_receipt" && form.supplierReceiptMode === "weighbridge") || isTransfer) ? (
                <div className="space-y-1">
                  <Label>Склад назначения *</Label>
                  <Select value={form.warehouseToId} onValueChange={(v) => setForm((p) => ({ ...p, warehouseToId: v }))}>
                    <SelectTrigger className="h-8"><SelectValue placeholder="Выберите склад" /></SelectTrigger>
                    <SelectContent>{warehouses.filter((w) => !isTransfer || w.id !== form.warehouseFromId).map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
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
            </div>
            ) : null}

            {form.operationType === "harvest_incoming" ? (
              <div className="space-y-1.5">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="min-w-0 space-y-1.5">
                    <Label>Поле / участок *</Label>
                    <HarvestAllocationPicker
                      value={form.fieldId && form.cropStructureAllocationId
                        ? `${form.fieldId}:${form.cropStructureAllocationId}`
                        : ""}
                      options={harvestTargetOptions}
                      onValueChange={changeHarvestTarget}
                      disabled={loading || submitting}
                    />
                    {selectedHarvestAllocation ? (
                      <div className="truncate text-xs text-slate-400" title={`${selectedHarvestAllocation.cropName} · ${selectedHarvestAllocation.varietyName} · ${selectedHarvestAllocation.reproductionName}`}>
                        {[selectedHarvestAllocation.cropName, selectedHarvestAllocation.varietyName, selectedHarvestAllocation.reproductionName].filter(Boolean).join(" · ")}
                      </div>
                    ) : null}
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <Label>Место приёмки *</Label>
                    <SearchableCombobox
                      value={form.warehouseToId}
                      options={harvestWarehouses.map((warehouse) => ({
                        value: warehouse.id,
                        label: warehouse.name,
                        description: storagePlaceTypeLabel(warehouse.placeType),
                        group: storagePlaceTypeGroupLabel(warehouse.placeType),
                        keywords: [warehouse.warehouseType, warehouse.placeType],
                      }))}
                      onValueChange={(warehouseToId) => setForm((previous) => ({ ...previous, warehouseToId }))}
                      placeholder="Выберите место приёмки"
                      searchPlaceholder="Поиск места приёмки"
                      emptyLabel="Место приёмки не найдено"
                      ariaLabel="Место приёмки"
                      disabled={loading || submitting}
                    />
                  </div>
                </div>
                {harvestWarehouses.length === 0 ? (
                  <div className="text-xs text-amber-300">
                    {profile?.role === "company_admin" || profile?.role === "global_admin"
                      ? "Добавьте место приёмки урожая перед началом работы весовой."
                      : "Место приёмки не настроено. Обратитесь к администратору."}
                  </div>
                ) : null}
              </div>
            ) : null}

            {isImpurityRemoval ? (
              <div className={formSectionClass}>
                <div className="mb-3">
                  <Label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Партия и вид примесей</Label>
                </div>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Партия урожая *</Label>
                    <Select value={form.sourceBatchId} onValueChange={(v) => setForm((p) => ({ ...p, sourceBatchId: v }))} disabled={!form.warehouseFromId}>
                      <SelectTrigger className="h-11"><SelectValue placeholder={form.warehouseFromId ? "Выберите партию урожая" : "Сначала выберите склад"} /></SelectTrigger>
                      <SelectContent>
                        {availableHarvestBatches.length === 0 ? <SelectItem value="__empty" disabled>На складе нет принятых партий урожая</SelectItem> : null}
                        {availableHarvestBatches.map((batch) => (
                          <SelectItem key={batch.id} value={batch.id}>{batch.cropName} / {batch.varietyName} · {batch.fieldName} · чистая масса {batch.cleanMassKg.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} кг</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {selectedHarvestBatch ? (
                    <div className="grid gap-2 rounded-md border border-slate-700 bg-slate-950/55 p-3 text-xs sm:grid-cols-3">
                      <div><span className="text-slate-500">Принято</span><div className="mt-1 font-semibold text-slate-100">{selectedHarvestBatch.receivedKg.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} кг</div></div>
                      <div><span className="text-slate-500">Уже вывезено</span><div className="mt-1 font-semibold text-amber-300">{selectedHarvestBatch.removedKg.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} кг</div></div>
                      <div><span className="text-slate-500">Чистая масса</span><div className="mt-1 font-semibold text-emerald-300">{selectedHarvestBatch.cleanMassKg.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} кг</div></div>
                    </div>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    {(Object.keys(impurityTypeLabels) as ImpurityType[]).map((type) => (
                      <Button key={type} type="button" size="sm" variant="outline" className={`${segmentClass(form.impurityType === type)} h-auto min-h-10 whitespace-normal`} onClick={() => setForm((p) => ({ ...p, impurityType: type }))}>
                        {impurityTypeLabels[type]}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {form.operationType === "supplier_receipt" ? (
              <div className={formSectionClass}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <Label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Товары в поставке</Label>
                  <div className="text-xs text-slate-500">{form.supplierReceiptMode === "weighbridge" ? "Один талон — один товар" : "Один документ — несколько строк"}</div>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <Button type="button" size="sm" variant="outline" className={segmentClass(form.supplierReceiptMode === "weighbridge")} onClick={() => { setSupplierReceiptLines([]); setForm((p) => ({ ...p, supplierReceiptMode: "weighbridge", quantityKg: "", quantityUom: "kg" })); }}>Через весовую</Button>
                  <Button type="button" size="sm" variant="outline" className={segmentClass(form.supplierReceiptMode === "direct")} onClick={() => setForm((p) => ({ ...p, supplierReceiptMode: "direct", grossKg: "", warehouseToId: "" }))}>По накладной</Button>
                </div>
                {form.supplierReceiptMode === "weighbridge" ? (
                  <div className="mt-3 space-y-2 rounded-xl border border-slate-800/80 bg-slate-950/45 p-3">
                    <Label>Номенклатура *</Label>
                    <Select value={form.productId} onValueChange={(v) => setForm((p) => ({ ...p, productId: v, quantityKg: "", quantityUom: "kg" }))}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Выберите взвешиваемый товар" /></SelectTrigger>
                      <SelectContent>
                        {weighedSupplierProducts.length === 0 ? <SelectItem value="__empty" disabled>Нет доступных сыпучих товаров в кг</SelectItem> : null}
                        {weighedSupplierProducts.map((product) => <SelectItem key={product.id} value={product.id}>{product.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <div className="text-xs text-slate-400">Количество будет равно нетто: брутто минус тара. Ручной ввод количества и единицы не используется.</div>
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    <div className="grid gap-2 rounded-xl border border-slate-800/80 bg-slate-950/45 p-3 md:grid-cols-[minmax(220px,1.4fr)_130px_100px_minmax(180px,1fr)]">
                      <div className="space-y-1 md:col-span-2">
                        <Label>Номенклатура *</Label>
                        <Select value={form.productId} onValueChange={(v) => setForm((p) => ({ ...p, productId: v, quantityUom: String(productById.get(v)?.stockUnit || "") }))}>
                          <SelectTrigger className="h-8"><SelectValue placeholder="Выберите товар" /></SelectTrigger>
                          <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label>Количество *</Label>
                        <Input className="h-8" value={form.quantityKg} onChange={(e) => setForm((p) => ({ ...p, quantityKg: e.target.value }))} />
                      </div>
                      <div className="space-y-1">
                        <Label>Ед.</Label>
                        <div className="flex h-8 items-center rounded-md border border-slate-700 bg-slate-950/60 px-3 text-sm text-slate-200">{unitLabel(productById.get(form.productId)?.stockUnit || "") || "—"}</div>
                      </div>
                      <div className="space-y-1">
                        <Label>Склад строки *</Label>
                        <Select value={form.warehouseToId} onValueChange={(v) => setForm((p) => ({ ...p, warehouseToId: v }))}>
                          <SelectTrigger className="h-8"><SelectValue placeholder="Склад" /></SelectTrigger>
                          <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    </div>
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-0 text-xs text-slate-400 hover:text-slate-100" onClick={() => setShowSupplierExtraFields((v) => !v)}>
                      {showSupplierExtraFields ? "Скрыть дополнительные данные" : "Показать номер партии / цену"}
                    </Button>
                    {showSupplierExtraFields ? (
                      <div className="grid gap-2 md:grid-cols-2">
                        <div className="space-y-1">
                          <Label>Партия / номер партии</Label>
                          <Input className="h-8" value={form.supplierLot} onChange={(e) => setForm((p) => ({ ...p, supplierLot: e.target.value }))} placeholder="необязательно" />
                        </div>
                        <div className="space-y-1">
                          <Label>Цена</Label>
                          <Input className="h-8" value={form.unitPrice} onChange={(e) => setForm((p) => ({ ...p, unitPrice: e.target.value }))} placeholder="необязательно" />
                        </div>
                      </div>
                    ) : null}
                    {supplierReceiptLines.map((line) => (
                      <div key={line.localId} className="grid gap-2 rounded-xl border border-slate-800/80 bg-slate-950/45 p-3 md:grid-cols-[1.2fr_110px_90px_160px_auto]">
                        <div className="space-y-1">
                          <Label>Номенклатура *</Label>
                          <Select
                            value={line.productId}
                            onValueChange={(v) => setSupplierReceiptLines((prev) => prev.map((item) => item.localId === line.localId ? { ...item, productId: v, uom: String(productById.get(v)?.stockUnit || "") } : item))}
                          >
                            <SelectTrigger className="h-8"><SelectValue placeholder="Выберите товар" /></SelectTrigger>
                            <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label>Количество *</Label>
                          <Input className="h-8" value={line.quantityKg} onChange={(e) => setSupplierReceiptLines((prev) => prev.map((item) => item.localId === line.localId ? { ...item, quantityKg: e.target.value } : item))} />
                        </div>
                        <div className="space-y-1">
                          <Label>Ед.</Label>
                          <div className="flex h-8 items-center rounded-md border border-slate-700 bg-slate-950/60 px-3 text-sm text-slate-200">{unitLabel(productById.get(line.productId)?.stockUnit || "") || "—"}</div>
                        </div>
                        <div className="space-y-1">
                          <Label>Склад строки *</Label>
                          <Select value={line.warehouseToId} onValueChange={(v) => setSupplierReceiptLines((prev) => prev.map((item) => item.localId === line.localId ? { ...item, warehouseToId: v } : item))}>
                            <SelectTrigger className="h-8"><SelectValue placeholder="Склад" /></SelectTrigger>
                            <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        {showSupplierExtraFields ? (
                          <>
                            <div className="space-y-1 md:col-span-2">
                              <Label>Партия / номер партии</Label>
                              <Input className="h-8" value={line.supplierLot} onChange={(e) => setSupplierReceiptLines((prev) => prev.map((item) => item.localId === line.localId ? { ...item, supplierLot: e.target.value } : item))} placeholder="необязательно" />
                            </div>
                            <div className="space-y-1">
                              <Label>Цена</Label>
                              <Input className="h-8" value={line.unitPrice} onChange={(e) => setSupplierReceiptLines((prev) => prev.map((item) => item.localId === line.localId ? { ...item, unitPrice: e.target.value } : item))} placeholder="необязательно" />
                            </div>
                          </>
                        ) : null}
                        <div className="flex items-end">
                          <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => setSupplierReceiptLines((prev) => prev.filter((item) => item.localId !== line.localId))}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    <div className="flex items-center justify-between gap-2">
                      <Button type="button" size="sm" variant="outline" className="h-9 border-slate-700 bg-slate-950 text-slate-100 hover:bg-slate-900" onClick={() => setSupplierReceiptLines((prev) => [...prev, createSupplierReceiptLineDraft()])}>
                        + Добавить строку
                      </Button>
                      {supplierReceiptGenericLineDrafts.length > 1 ? <div className="text-xs text-slate-400">Итого по строкам: {supplierReceiptGenericLineTotal.toLocaleString("ru-RU", { maximumFractionDigits: 3 })}</div> : null}
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {isFieldIssue ? (
              <div className={formSectionClass}>
                <div className="grid gap-2 md:grid-cols-2">
                  <Button type="button" size="sm" variant="outline" className={segmentClass(form.fieldIssueMode === "weighbridge")} onClick={() => setForm((p) => ({ ...p, fieldIssueMode: "weighbridge", quantityKg: "" }))}>Через весовую</Button>
                  <Button type="button" size="sm" variant="outline" className={segmentClass(form.fieldIssueMode === "direct")} onClick={() => setForm((p) => ({ ...p, fieldIssueMode: "direct", grossKg: "", driverId: "", vehicleId: "" }))}>Ручная выдача</Button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
                  {(Object.keys(fieldMaterialCategoryLabels) as FieldMaterialCategory[]).map((type) => (
                    <Button key={type} type="button" size="sm" variant="outline" className={`${segmentClass(form.fieldMaterialCategory === type)} h-auto min-h-10 whitespace-normal`} onClick={() => setForm((p) => ({ ...p, fieldMaterialCategory: type, stockIdentityKey: "", productId: "", varietyId: "", reproductionId: "", quantityKg: "" }))}>
                      {fieldMaterialCategoryLabels[type]}
                    </Button>
                  ))}
                </div>
                {fieldHarvestOptions.length > 1 ? (
                  <Select value={form.cropStructureAllocationId} onValueChange={(v) => setForm((p) => ({ ...p, cropStructureAllocationId: v, stockIdentityKey: "", productId: "", varietyId: "", reproductionId: "", quantityKg: "" }))}>
                    <SelectTrigger className="h-8"><SelectValue placeholder="Посевная строка / участок поля" /></SelectTrigger>
                    <SelectContent>{fieldHarvestOptions.map((x) => <SelectItem key={x.allocationId} value={x.allocationId}>{harvestIdentityLabel(x.cropName, x.varietyName, x.reproductionName)} • {x.areaHa.toFixed(2)} га</SelectItem>)}</SelectContent>
                  </Select>
                ) : null}
                {selectedHarvestAllocation ? <div className="text-xs text-emerald-300">Участок: {harvestIdentityLabel(selectedHarvestAllocation.cropName, selectedHarvestAllocation.varietyName, selectedHarvestAllocation.reproductionName)} • {selectedHarvestAllocation.areaHa.toFixed(2)} га</div> : null}
                <div className="grid gap-2 md:grid-cols-2">
                  <Select value={form.stockIdentityKey} onValueChange={(v) => {
                    const selected = fieldIssueStockOptions.find((item) => item.key === v);
                    setForm((p) => ({ ...p, stockIdentityKey: v, productId: selected?.product_id || "", varietyId: selected?.variety_id || "", reproductionId: selected?.reproduction_id || "" }));
                  }} disabled={!form.warehouseFromId || !selectedHarvestAllocation || stockIdentityLoading}>
                    <SelectTrigger className="h-8"><SelectValue placeholder="Материал из наличия склада" /></SelectTrigger>
                    <SelectContent>{fieldIssueStockOptions.map((item) => <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>)}</SelectContent>
                  </Select>
                  {form.fieldIssueMode === "direct" ? <Input className="h-8" value={form.quantityKg} onChange={(e) => setForm((p) => ({ ...p, quantityKg: e.target.value }))} placeholder="Количество, кг" /> : <div className="rounded-md border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-xs text-slate-300">Количество рассчитается при закрытии: нетто = брутто - тара.</div>}
                </div>
              </div>
            ) : null}

            {isTransfer || isDisposal || isShipment ? (
              <div className={formSectionClass}>
                {isTransfer ? (
                  <div className="grid gap-2 md:grid-cols-2">
                    <Button type="button" size="sm" variant="outline" className={segmentClass(form.transferMode === "weighbridge")} onClick={() => setForm((p) => ({ ...p, transferMode: "weighbridge", quantityKg: "" }))}>Через весовую</Button>
                    <Button type="button" size="sm" variant="outline" className={segmentClass(form.transferMode === "direct")} onClick={() => setForm((p) => ({ ...p, transferMode: "direct", grossKg: "", driverId: "", vehicleId: "" }))}>Ручное перемещение</Button>
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

            {isFieldIssueDirect ? null : (
              <div className={form.operationType === "harvest_incoming" ? "" : formSectionClass}>
                {form.operationType !== "harvest_incoming" ? <div className="mb-3">
                  <Label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Транспорт</Label>
                </div> : null}
              <TransportDriverSelects
                vehicleId={form.vehicleId}
                driverId={form.driverId}
                vehicles={vehicles}
                drivers={drivers}
                recentPairs={transportPickerData.recentPairs}
                latestDriverByVehicle={transportPickerData.latestDriverByVehicle}
                latestVehicleByDriver={transportPickerData.latestVehicleByDriver}
                openAssignments={transportPickerData.openAssignments}
                optional={form.operationType === "supplier_receipt"}
                disabled={loading || submitting}
                onChange={(vehicleId, driverId) => setForm((previous) => ({ ...previous, vehicleId, driverId }))}
                onBlockedAssignment={(assignment) => void handleBlockedTransportAssignment(assignment)}
                onComplete={() => grossInputRef.current?.focus()}
              />
              {drivers.length === 0 ? (
                <div className="mt-1 text-xs text-amber-300">
                  {profile?.role === "company_admin" || profile?.role === "global_admin"
                    ? "Добавьте водителей в справочнике сотрудников до начала уборки."
                    : "Водители не настроены. Обратитесь к администратору компании."}
                </div>
              ) : null}
              {suggestedFieldId && suggestedFieldId !== form.fieldId && form.operationType !== "harvest_incoming" ? (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-200">
                  <span>Последнее поле этой машины: {fields.find((field) => field.id === suggestedFieldId)?.name || "поле"}</span>
                  <Button type="button" size="sm" variant="outline" onClick={() => setForm((prev) => ({ ...prev, fieldId: suggestedFieldId }))}>
                    Выбрать
                  </Button>
                </div>
              ) : null}
              </div>
            )}

            {isWeighbridgeForm ? (
              <div className={form.operationType === "harvest_incoming" ? "" : formSectionClass}>
                {form.operationType !== "harvest_incoming" ? <Label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Вес</Label> : null}
              <div className={form.operationType === "harvest_incoming" ? "" : "mt-3"}>
                <div className={form.operationType === "harvest_incoming" ? "grid items-end gap-3 md:grid-cols-[1fr_220px]" : "space-y-1"}>
                  <div className="space-y-1">
                  <Label>Брутто / вес (кг) *</Label>
                  <Input ref={grossInputRef} className="h-10" inputMode="decimal" value={form.grossKg} onChange={(e) => setForm((p) => ({ ...p, grossKg: e.target.value }))} placeholder="0" />
                  {grossInputValidation && !grossInputValidation.ok ? <div className="text-xs text-rose-300">{grossInputValidation.message}</div> : null}
                  </div>
                  {form.operationType === "harvest_incoming" && canOperate ? (
                    <Button
                      className="h-10 w-full font-semibold"
                      onClick={() => void create()}
                      disabled={submitting || Boolean(currentValidationError) || !activeShift || (canUseOperatorSession && !operatorState.unlocked)}
                    >
                      {submitting ? "Открытие..." : "Открыть талон"}
                    </Button>
                  ) : null}
                </div>
              </div>
              </div>
            ) : null}

            {form.operationType !== "harvest_incoming" ? <div className="space-y-1">
              <Button type="button" variant="ghost" size="sm" className="h-7 px-0 text-xs" onClick={() => setCommentOpen((v) => !v)}>
                {commentOpen ? "− Комментарий" : "+ Комментарий"}
              </Button>
              {commentOpen ? <Textarea value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} rows={2} /> : null}
            </div> : null}

            {canOperate && form.operationType !== "harvest_incoming" ? (
              <div className="sticky bottom-0 z-10 -mx-4 border-t border-slate-800 bg-[#101724]/95 px-4 pt-3 backdrop-blur">
                <Button
                  className="h-11 w-full text-base font-semibold"
                  onClick={() => void create()}
                  disabled={
                    submitting ||
                    Boolean(currentValidationError) ||
                    (!activeShift && !isSupplierDirect) ||
                    (canUseOperatorSession && !operatorState.unlocked && !isSupplierDirect)
                  }
                >
                  {submitting ? "Сохранение..." : "Создать талон"}
                </Button>
                {!coreDataReady || secondaryModeLoading ? <div className="mt-1 text-xs text-amber-300">{currentValidationError}</div> : null}
                {coreDataReady && !activeShift && !isSupplierDirect ? <div className="mt-1 text-xs text-amber-300">Смена закрыта: откройте её через меню ⋯.</div> : null}
                {coreDataReady && activeShift && canUseOperatorSession && !operatorState.unlocked && !isSupplierDirect ? (
                  <button type="button" className="mt-1 text-left text-xs font-medium text-amber-300 underline underline-offset-2" onClick={openShiftAction}>
                    Терминал заблокирован: введите PIN весовщика.
                  </button>
                ) : null}
                {coreDataReady && !secondaryModeLoading && activeShift && currentValidationError ? (
                  <div className="mt-1 text-xs text-amber-300">{currentValidationError}</div>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className={`${terminalPanelClass} xl:col-start-2 xl:row-start-1`}>
          <CardHeader className="border-b border-slate-800/80 px-4 py-3">
            <CardTitle className="flex items-center justify-between gap-2 text-base text-slate-50">
              <span className="flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-yellow-400" />Открытые талоны
              </span>
              <Badge className="border border-slate-700 bg-slate-950 text-slate-200">{visibleActiveTickets.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[720px] space-y-2 overflow-y-auto px-3 py-3 travkin-scrollbar">
            {ticketsLoading ? <div className="text-sm text-slate-400">Загрузка очереди...</div> : visibleActiveTickets.length === 0 ? <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/45 p-6 text-center text-sm text-slate-500">Открытых талонов нет</div> : [...visibleActiveTickets].sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()).map((t) => {
              const isPending = t.id.startsWith("pending-");
              const vehicleName = vehicles.find((v) => v.id === t.vehicle_id)?.name || "Транспорт";
              const driverName = driverNameForId(t.driver_id) || "Без водителя";
              const meta = ticketCardMeta(t, vehicleName, driverName);
              const harvestRoute = activeHarvestForTicket(t);
              const correctionOriginal = t.correction_of_ticket_id ? ticketById.get(t.correction_of_ticket_id) : null;
              return (
                <button key={`open-${t.id}`} type="button" disabled={isPending} onClick={() => setActiveTicket(t)} className={isPending ? "w-full cursor-wait rounded-xl border border-yellow-500/25 bg-yellow-500/5 px-3 py-3 text-left" : "w-full rounded-xl border border-slate-800 bg-slate-950/55 px-3 py-3 text-left transition hover:border-yellow-500/50 hover:bg-slate-900"}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-50">{productSummary(t)}</div>
                      <div className="mt-1 line-clamp-2 text-xs text-slate-400">{ticketRouteSummary(t)}</div>
                    </div>
                    <Badge className="h-5 shrink-0 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2 text-[10px] text-yellow-100">{isPending ? "Сохраняется" : correctionOriginal ? "Исправляется" : ticketStageLabel(t)}</Badge>
                  </div>
                  {correctionOriginal ? (
                    <div className="mt-2 grid gap-1 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-2.5 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-400">Исходный талон</span>
                        <span className="font-semibold text-slate-100">{ticketQuantitySummary(correctionOriginal)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-yellow-200">Новое исправление</span>
                        <span className="font-semibold text-yellow-100">{ticketQuantitySummary(t)}</span>
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-semibold text-slate-200">{ticketQuantitySummary(t)}</span>
                    <span className="shrink-0 text-[11px] text-slate-500">{fmt(t.created_at, lang)}</span>
                  </div>
                  <div className="mt-1 truncate text-[11px] text-slate-500">{meta} • {t.ticket_no}</div>
                  {harvestRoute ? <div className="mt-1 truncate text-[10px] font-medium text-yellow-200/80">Уборка: {harvestRoute.fieldName} → {harvestRoute.warehouseName}</div> : null}
                </button>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <details
        className={`${terminalPanelClass} group`}
        open={statisticsOpen}
        onToggle={(event) => setStatisticsOpen(event.currentTarget.open)}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-slate-200">
          <span>Статистика</span>
          <span className="text-xs font-normal text-slate-500">Сегодня и текущее поле</span>
        </summary>
        <div className="grid gap-4 border-t border-slate-800 px-4 py-3 lg:grid-cols-2">
          <section aria-label="Сводка за сегодня">
            <div className="text-xs font-semibold uppercase text-slate-500">Сегодня</div>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div><div className="text-xs text-slate-400">Нетто</div><div className="mt-1 text-lg font-bold text-slate-50">{formatTonnes(harvestSummary.today.netKg)}</div></div>
              <div><div className="text-xs text-slate-400">Рейсов</div><div className="mt-1 text-lg font-bold text-slate-50">{harvestSummary.today.trips}</div></div>
              <div><div className="text-xs text-slate-400">Средний рейс</div><div className="mt-1 text-lg font-bold text-slate-50">{formatTonnes(harvestSummary.today.averageTripKg)}</div></div>
              <div><div className="text-xs text-slate-400">Влажность</div><div className="mt-1 text-lg font-bold text-slate-50">{formatMoisture(harvestSummary.today.averageMoisture)}</div></div>
            </div>
          </section>
          <section aria-label="Сводка по текущему полю">
            <div className="text-xs font-semibold uppercase text-slate-500">Текущее поле</div>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div><div className="text-xs text-slate-400">Сегодня</div><div className="mt-1 text-lg font-bold text-slate-50">{formatTonnes(currentFieldSummary?.today.netKg || 0)}</div></div>
              <div><div className="text-xs text-slate-400">За сезон</div><div className="mt-1 text-lg font-bold text-slate-50">{formatTonnes(currentFieldSummary?.cumulative.netKg || 0)}</div></div>
              <div><div className="text-xs text-slate-400">Рейсов</div><div className="mt-1 text-lg font-bold text-slate-50">{currentFieldSummary?.cumulative.trips || 0}</div></div>
              <div><div className="text-xs text-slate-400">Влажность</div><div className="mt-1 text-lg font-bold text-slate-50">{formatMoisture(currentFieldSummary?.cumulative.averageMoisture ?? null)}</div></div>
            </div>
            <div className="mt-2 text-xs text-slate-500">
              {harvestContext.yieldTPerHa != null
                ? `${harvestContext.yieldStatus === "final" ? "Итоговая" : "Предварительная"} урожайность: ${harvestContext.yieldTPerHa.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} т/га`
                : "Урожайность появится после фиксации убранной площади"}
            </div>
          </section>
        </div>
      </details>

      <div ref={historyRef}>
        <Card className={terminalPanelClass}>
          <CardHeader className="flex flex-col items-stretch justify-between gap-3 space-y-0 border-b border-slate-800/80 px-4 py-3 sm:flex-row sm:items-center">
            <div>
              <CardTitle className="text-xl text-slate-50">Журнал талонов</CardTitle>
              <div className="mt-1 text-xs text-slate-500">Закрытые и аннулированные документы</div>
            </div>
            <div className="w-full sm:w-[240px]">
              <Select value={historyTypeFilter} onValueChange={(value) => {
                setHistoryTypeFilter(value);
              }}>
                <SelectTrigger className="border-slate-700 bg-slate-950 text-slate-100"><SelectValue placeholder="Фильтр по типу" /></SelectTrigger>
                <SelectContent><SelectItem value="all">Все типы</SelectItem>{historyTypes.map((type) => <SelectItem key={type} value={type}>{operationUiLabel(type)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 px-3 py-3 sm:px-4">
            {ticketsLoading ? <div className="text-sm text-slate-400">Загрузка журнала...</div> : null}
            {!ticketsLoading && historyTickets.length === 0 ? <div className="rounded-lg border border-dashed border-slate-800 p-6 text-center text-sm text-slate-500">Закрытых талонов пока нет</div> : null}
            {!ticketsLoading && historyTickets.map((t) => {
              const vehicleName = vehicles.find((v) => v.id === t.vehicle_id)?.name || "Транспорт";
              const driverName = driverNameForId(t.driver_id) || "Без водителя";
              const meta = ticketCardMeta(t, vehicleName, driverName);
              const dt = fmt(t.finalized_at || t.updated_at || t.created_at, lang);
              return (
                <div key={t.id} className="rounded-xl border border-slate-800 bg-slate-950/45 px-3 py-2.5 transition hover:border-slate-700">
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold leading-tight text-slate-50">{productSummary(t)}</div>
                      <div className="mt-0.5 truncate text-sm text-slate-300">{ticketRouteSummary(t)}</div>
                      <div className="mt-1 truncate text-xs text-slate-500">{meta} • {t.ticket_no}</div>
                    </div>
                    <div className="grid shrink-0 grid-cols-[1fr_auto_auto] items-center gap-2 md:flex">
                      <Badge className={statusClass(t.status)}>{statusLabel(t.status)}</Badge>
                      <Button variant="outline" size="sm" className="h-8 border-slate-700 bg-slate-950 text-slate-100 hover:bg-slate-800" onClick={() => setHistoryPreviewTicket(t)}>Открыть</Button>
                      <Button variant="outline" size="sm" className="h-8 border-slate-700 bg-slate-950 text-slate-100 hover:bg-slate-800" onClick={async () => { if (!profile?.id) return; try { await downloadTicketPdf(t.id, profile.id); } catch (error: any) { toast({ title: "Ошибка PDF", description: error?.message || "Не удалось скачать PDF", variant: "destructive" }); } }}><FileDown className="mr-1 h-4 w-4" />PDF</Button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
                    <div><span className="text-slate-500">Количество: </span><span className="font-semibold text-slate-100">{ticketQuantitySummary(t)}</span></div>
                    <div><span className="text-slate-500">Время: </span><span className="font-semibold text-slate-100">{dt}</span></div>
                  </div>
                </div>
              );
            })}
            {!ticketsLoading && historyTickets.length >= 20 ? (
              <Button asChild variant="outline" className="w-full border-slate-700 bg-slate-950 text-slate-200 hover:bg-slate-900">
                <Link href="/weighbridge/history">Открыть полный журнал</Link>
              </Button>
            ) : null}
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
        <SheetContent side="right" className="w-full overflow-y-auto bg-slate-950 text-slate-100 sm:max-w-xl lg:overflow-hidden lg:max-w-3xl">
          {activeTicket ? (
            <div className="flex min-h-0 flex-col gap-2 lg:h-full">
              <SheetHeader className="sr-only">
                <SheetTitle>Талон {activeTicket.ticket_no}</SheetTitle>
                <SheetDescription>{operationUiLabel(activeTicket.op_type)}</SheetDescription>
              </SheetHeader>
              <WeighbridgeTicketPaper
                ticket={activeTicket}
                labels={ticketPaperLabels(activeTicket)}
                className="travkin-scrollbar lg:max-h-[calc(100vh-96px)] lg:overflow-y-auto"
                headerActions={(
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-[#3f3426] hover:bg-[#e8dcc5]" aria-label="Действия с талоном">
                        <MoreHorizontal className="h-5 w-5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {canCorrectTicket ? <DropdownMenuItem onSelect={openActiveTicketEditor}><Pencil className="mr-2 h-4 w-4" />Исправить</DropdownMenuItem> : null}
                      <DropdownMenuItem onSelect={() => { if (profile?.id) void downloadTicketPdf(activeTicket.id, profile.id); }}><FileDown className="mr-2 h-4 w-4" />PDF</DropdownMenuItem>
                      {canCorrectTicket ? <DropdownMenuSeparator /> : null}
                      {canCorrectTicket ? <DropdownMenuItem className="text-red-600 focus:text-red-600" onSelect={() => setVoidReasonOpen(true)}><Trash2 className="mr-2 h-4 w-4" />Аннулировать</DropdownMenuItem> : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                weightEditor={canOperate ? {
                  tareValue: closingTare,
                  moistureValue: closingMoisture,
                  physicalNetKg: pure,
                  disabled: finalizing,
                  moistureSaving,
                  tareError: closingTareValidation && !closingTareValidation.ok
                    ? closingTareValidation.message
                    : pure != null && pure <= 0 ? "Тара должна быть меньше брутто." : "",
                  tareInputRef,
                  onTareChange: setClosingTare,
                  onMoistureChange: setClosingMoisture,
                  onMoistureCommit: () => { void saveActiveTicketMoisture(); },
                } : undefined}
              />

              {canOperate ? (
                <div className="flex shrink-0 justify-center pt-1">
                  <Button className="w-full max-w-sm bg-emerald-600 font-semibold hover:bg-emerald-700" onClick={closeTicket} disabled={finalizing || !closingTare || Boolean(closingTareValidation && !closingTareValidation.ok) || (pure != null && pure <= 0)}>
                    {finalizing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                    {finalizing ? "Закрытие..." : "Закрыть талон"}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
      <Dialog open={voidReasonOpen} onOpenChange={(open) => { if (!voiding) setVoidReasonOpen(open); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Аннулировать талон</DialogTitle>
            <DialogDescription>Укажите причину. Исходный талон и история останутся в системе.</DialogDescription>
          </DialogHeader>
          <Textarea value={voidReason} onChange={(event) => setVoidReason(event.target.value)} rows={3} placeholder="Причина аннулирования" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidReasonOpen(false)} disabled={voiding}>Отмена</Button>
            <Button variant="destructive" onClick={handleVoid} disabled={voiding || !voidReason.trim()}>
              {voiding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              {voiding ? "Аннулирование..." : "Аннулировать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Sheet open={Boolean(historyPreviewTicket)} onOpenChange={(open) => !open && setHistoryPreviewTicket(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto bg-slate-950 text-slate-100 sm:max-w-2xl">
          {historyPreviewTicket ? (
            <div className="space-y-4">
              <SheetHeader className="sr-only">
                <SheetTitle>Талон {historyPreviewTicket.ticket_no}</SheetTitle>
                <SheetDescription>{operationUiLabel(historyPreviewTicket.op_type)}</SheetDescription>
              </SheetHeader>
              <WeighbridgeTicketPaper ticket={historyPreviewTicket} labels={ticketPaperLabels(historyPreviewTicket)} />
              <div className="flex items-center justify-end gap-2">
                {historyPreviewTicket.status === "finalized" && canCorrectTicket ? (
                  <Button variant="outline" onClick={() => { setTicketCorrectionReason(""); setTicketCorrectionOpen(true); }}>
                    <Pencil className="mr-1 h-4 w-4" />Исправить талон
                  </Button>
                ) : null}
                <Button variant="outline" onClick={async () => { if (!profile?.id || !historyPreviewTicket) return; try { await downloadTicketPdf(historyPreviewTicket.id, profile.id); } catch (error: any) { toast({ title: "Ошибка PDF", description: error?.message || "Не удалось скачать PDF", variant: "destructive" }); } }}><FileDown className="mr-1 h-4 w-4" />Скачать PDF</Button>
                <Button onClick={() => setHistoryPreviewTicket(null)}>Закрыть</Button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
      <Dialog open={openTicketEditOpen} onOpenChange={(open) => { if (!ticketCorrectionBusy) setOpenTicketEditOpen(open); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Исправить открытый талон</DialogTitle>
            <DialogDescription>Талон останется тем же. Система сохранит прежние и новые значения в истории.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Брутто, кг</Label>
              <Input inputMode="decimal" value={editGrossKg} onChange={(event) => setEditGrossKg(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Тара, кг</Label>
              <Input inputMode="decimal" value={editTareKg} onChange={(event) => setEditTareKg(event.target.value)} placeholder="Ещё не введена" />
            </div>
            <div className="space-y-2">
              <Label>Причина или комментарий</Label>
              <Textarea value={editReason} onChange={(event) => setEditReason(event.target.value)} rows={2} placeholder="Например: исправлена опечатка веса" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenTicketEditOpen(false)} disabled={ticketCorrectionBusy}>Отмена</Button>
            <Button onClick={saveOpenTicketCorrection} disabled={ticketCorrectionBusy}>{ticketCorrectionBusy ? "Сохранение..." : "Сохранить исправление"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={ticketCorrectionOpen} onOpenChange={(open) => { if (!ticketCorrectionBusy) setTicketCorrectionOpen(open); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Исправить завершённый талон</DialogTitle>
            <DialogDescription>Старый документ останется в истории. Склад будет пересчитан только после завершения исправленного талона.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Причина исправления *</Label>
            <Textarea value={ticketCorrectionReason} onChange={(event) => setTicketCorrectionReason(event.target.value)} rows={3} placeholder="Что было указано неверно" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTicketCorrectionOpen(false)} disabled={ticketCorrectionBusy}>Отмена</Button>
            <Button onClick={beginFinalizedTicketCorrection} disabled={ticketCorrectionBusy || !ticketCorrectionReason.trim()}>{ticketCorrectionBusy ? "Подготовка..." : "Подготовить исправление"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={operatorDialogVisible}
        onOpenChange={(open) => {
          if (!open && (operatorGateBlocked || operatorBusy)) return;
          if (!open) setOperatorDialogRequested(false);
          setOperatorDialogOpen(open);
        }}
      >
        <DialogContent
          className="sm:max-w-sm"
          hideCloseButton={operatorGateBlocked}
          overlayClassName="bg-black/85 backdrop-blur-md"
          onEscapeKeyDown={(event) => { if (operatorGateBlocked) event.preventDefault(); }}
          onPointerDownOutside={(event) => { if (operatorGateBlocked) event.preventDefault(); }}
          onInteractOutside={(event) => { if (operatorGateBlocked) event.preventDefault(); }}
        >
          <DialogHeader>
            <DialogTitle>{operatorGateChecking ? "Проверяем действующую смену…" : activeShift ? "Весовщик смены" : "Открыть смену"}</DialogTitle>
            <DialogDescription>
              {operatorGateChecking
                ? "Рабочие данные Весовой заблокированы до завершения проверки."
                : operatorSessionStatus === "error"
                  ? "Доступ к Весовой остаётся заблокированным."
                  : "Выберите сотрудника и подтвердите доступ личным PIN."}
            </DialogDescription>
          </DialogHeader>
          {operatorGateChecking ? (
            <div className="flex items-center justify-center gap-3 rounded-md border border-slate-800 bg-slate-950/60 px-4 py-6 text-sm text-slate-300">
              <Loader2 className="h-5 w-5 animate-spin text-yellow-400" />
              Проверяем действующую смену…
            </div>
          ) : operatorSessionStatus === "error" ? (
            <div className="space-y-3">
              <div role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                {operatorError || "Не удалось проверить PIN. Повторите"}
              </div>
              <Button type="button" className="w-full" onClick={() => void verifyOperatorSession()}>
                Повторить проверку
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
            {eligibleOperators.length ? (
              <div className="space-y-2">
                <Label>Весовщик</Label>
                <Select value={operatorPersonId} onValueChange={(value) => { setOperatorPersonId(value); setOperatorPin(""); }}>
                  <SelectTrigger><SelectValue placeholder="Выберите весовщика" /></SelectTrigger>
                  <SelectContent>
                    {eligibleOperators.map((operator) => (
                      <SelectItem key={operator.id} value={operator.id}>
                        {operator.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                {unconfiguredOperatorCount > 0
                  ? "PIN не настроен. Обратитесь к администратору компании."
                  : "В справочнике сотрудников нет активных весовщиков."}
              </div>
            )}
            {eligibleOperators.length ? (
              <div className="space-y-2">
                <Label>PIN</Label>
                 <Input
                  autoFocus
                  type="password"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={operatorPin}
                  onChange={(event) => setOperatorPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  onKeyDown={(event) => { if (event.key === "Enter" && /^\d{6}$/.test(operatorPin)) void submitOperatorAction(); }}
                  placeholder="••••••"
                  className="text-center text-xl tracking-[0.35em]"
                />
                {operatorError ? <div role="alert" className="text-sm font-medium text-red-400">{operatorError}</div> : null}
              </div>
            ) : null}
            {activeShift?.id && activeShift?.operator_person_id && activeShift.operator_person_id !== operatorPersonId ? (
              <div className="space-y-2">
                <Label>Комментарий к передаче</Label>
                <Textarea value={shiftHandoverNote} onChange={(event) => setShiftHandoverNote(event.target.value)} rows={2} placeholder="Необязательно" />
              </div>
            ) : null}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button asChild type="button" variant="outline">
              <Link href="/dashboard">Выйти из Весовой</Link>
            </Button>
            {!operatorGateChecking && operatorSessionStatus !== "error" ? (
              <Button type="button" onClick={() => void submitOperatorAction()} disabled={operatorBusy || !eligibleOperators.length || !operatorPersonId || !/^\d{6}$/.test(operatorPin)}>
                {operatorBusy
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Проверка...</>
                  : activeShift?.id && activeShift?.operator_person_id && activeShift.operator_person_id !== operatorPersonId
                    ? "Передать смену"
                    : activeShift?.id ? "Продолжить смену" : "Открыть смену"}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={shiftDialogOpen} onOpenChange={setShiftDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Смена весовой</DialogTitle>
            <DialogDescription>
              {activeShift
                ? `Открыта ${fmt(activeShift.opened_at, lang)}${shiftGuard.stale ? ` · ${Math.max(1, Math.floor(shiftGuard.ageHours))} ч без закрытия` : ""}`
                : "Смена сейчас закрыта"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="col-span-2 rounded-md border p-3">
              <div className="text-slate-500">Весовщик</div>
              <div className="mt-1 font-semibold">{operatorState.operator?.name || (activeShift ? "Требуется PIN" : "—")}</div>
            </div>
            <div className="rounded-md border p-3"><div className="text-slate-500">Рейсы</div><div className="mt-1 text-xl font-semibold">{shiftSummary.trips}</div></div>
            <div className="rounded-md border p-3"><div className="text-slate-500">Нетто</div><div className="mt-1 text-xl font-semibold">{formatTonnes(shiftSummary.netKg)}</div></div>
            <div className="rounded-md border p-3"><div className="text-slate-500">Незакрытые</div><div className="mt-1 text-xl font-semibold">{shiftSummary.open}</div></div>
            <div className="rounded-md border p-3"><div className="text-slate-500">Аннулированные</div><div className="mt-1 text-xl font-semibold">{shiftSummary.voided}</div></div>
            <div className="col-span-2 rounded-md border p-3"><div className="text-slate-500">Ручные корректировки</div><div className="mt-1 text-xl font-semibold">{shiftSummary.manualCorrections}</div></div>
          </div>
          {activeShift ? (
            <div className="space-y-2">
              <Label>Комментарий</Label>
              <Textarea value={shiftHandoverNote} onChange={(event) => setShiftHandoverNote(event.target.value)} rows={3} placeholder="Необязательно" />
              {shiftCounters.activeTickets > 0 ? (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800">
                  Сначала закройте все открытые талоны.
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShiftDialogOpen(false)}>Отмена</Button>
            {activeShift ? (
              <Button onClick={closeShiftAction} disabled={shiftCounters.activeTickets > 0}>Закрыть смену</Button>
            ) : (
              <Button onClick={async () => { await openShiftAction(); setShiftDialogOpen(false); }}>Открыть смену</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
