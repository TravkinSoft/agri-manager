"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ClipboardList, Clock3, FileDown, Info, LockKeyhole, MoreHorizontal, Pencil, Scale, Trash2, UserRound } from "lucide-react";
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
import { adminTicketAction, closeShift, createTicket, downloadTicketPdf, finalizeTicket, getTicketDetails, getWeighbridgeBootstrap, getWeighbridgeOperatorState, getWeighbridgeResources, handoverWeighbridgeOperator, listHarvestBatchSummaries, listTickets, lockWeighbridgeOperator, patchTicket, startTicketCorrection, unlockWeighbridgeOperator, voidTicket } from "@/lib/services/weighbridge";
import type { HarvestBatchSummary, TicketDirection, TicketInput, TicketLineInput, WeighbridgeOperatorState, WeighbridgeTicket } from "@/lib/types/weighbridge";
import { hasQaDataMarker } from "@/lib/utils/qa-data";
import { isHarvestWarehouseType } from "@/lib/warehouse/warehouse-scope";
import { createWarehouseTransfer } from "@/lib/services/warehouses";
import { isWeighedFieldMaterial, isWeighedSupplierProduct } from "@/lib/weighbridge/product-rules";
import { dedupeProductsForSelect } from "@/lib/catalog/catalog-identity";
import { automaticHarvestAllocation, validateHarvestWeights } from "@/lib/weighbridge/harvest-contract";
import { personnelRoleForVehicle, personnelRoleLabel, type WeighbridgePersonnelRole } from "@/lib/weighbridge/personnel";
import { SearchableCombobox, type SearchableComboboxOption } from "@/components/weighbridge/searchable-combobox";
import { WeighbridgeTicketPaper, type WeighbridgeTicketPaperLabels } from "@/components/weighbridge/weighbridge-ticket-paper";
import {
  parseWeighbridgeFastRepeatContext,
  pickWeighbridgeFastRepeatContext,
  weighbridgeFastRepeatStorageKey,
} from "@/lib/weighbridge/fast-repeat";
import { formatWeightKg, formatWeightNumber } from "@/lib/weighbridge/weight-format";
import { parseStrictWeightKg } from "@/lib/weighbridge/weight-input";

type Lang = "ru" | "kz" | "en";
type OperationType = "harvest_incoming" | "supplier_receipt" | "issue_to_field" | "transfer_between_warehouses" | "shipment_outbound" | "disposal_writeoff" | "impurity_removal" | "drying";
type MovementGroup = "warehouse_inbound" | "field_issue" | "internal_transfer" | "shipment" | "writeoff" | "impurities";
type Option = { id: string; name: string };
type WarehouseOption = Option & { warehouseType: string };
type VehicleOption = Option & {
  model: string;
  plate: string;
  type: string;
  fleetType: string;
  transportCategory: string;
  source: "reference_vehicles" | "reference_machines";
  primaryPersonnelId: string | null;
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

export default function WeighbridgeOperationsPage() {
  const { profile, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const { language } = useLanguage();
  const lang = getLang(language);

  const [loading, setLoading] = useState(true);
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const createTicketIdempotencyRef = useRef<string | null>(null);
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
  const [harvestStructureByField, setHarvestStructureByField] = useState<Record<string, HarvestStructureOption[]>>({});
  const [harvestIncompleteFields, setHarvestIncompleteFields] = useState<Record<string, boolean>>({});
  const [activeTicket, setActiveTicket] = useState<WeighbridgeTicket | null>(null);
  const [closingTare, setClosingTare] = useState("");
  const [closingMoisture, setClosingMoisture] = useState("");
  const [moistureSaving, setMoistureSaving] = useState(false);
  const [moistureSavedValue, setMoistureSavedValue] = useState("");
  const [suggestedFieldId, setSuggestedFieldId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
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
  const [operatorSessionStatus, setOperatorSessionStatus] = useState<"unknown" | "checking" | "ready" | "error">("unknown");
  const [operatorDialogOpen, setOperatorDialogOpen] = useState(false);
  const [operatorPersonId, setOperatorPersonId] = useState("");
  const [operatorPin, setOperatorPin] = useState("");
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
  const tareInputRef = useRef<HTMLInputElement | null>(null);

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
  const idempotencyPersistKey = useMemo(
    () => (profile?.company_id && profile?.id ? `travkin.weighbridge.formDraft.${profile.company_id}.${profile.id}.idempotency` : ""),
    [profile?.company_id, profile?.id]
  );
  const fastRepeatPersistKey = useMemo(
    () => weighbridgeFastRepeatStorageKey(profile?.company_id, activeShift?.id),
    [profile?.company_id, activeShift?.id]
  );
  const [hydratedFastRepeatKey, setHydratedFastRepeatKey] = useState("");

  const loadSuppliers = async (companyId: string) => {
    const headers = await getSessionAuthHeaders();
    const resp = await fetch(`/api/weighbridge/suppliers?companyId=${encodeURIComponent(companyId)}`, {
      cache: "no-store",
      headers,
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(String(json?.error || "Не удалось загрузить поставщиков"));
    return (json?.suppliers || []) as SupplierOption[];

  };

  const loadBuyers = async (companyId: string) => {
    const headers = await getSessionAuthHeaders();
    const response = await fetch(`/api/counterparties?companyId=${encodeURIComponent(companyId)}&type=buyer`, {
      cache: "no-store",
      headers,
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

  const loadMasterIdentityRefs = async (companyId: string) => {
    const headers = await getSessionAuthHeaders();
    const resp = await fetch(
      `/api/weighbridge/master-identity?companyId=${encodeURIComponent(companyId)}`,
      { cache: "no-store", headers }
    );
    const json = await resp.json();
    if (!resp.ok) throw new Error(String(json?.error || "Не удалось загрузить культуры, сорта и репродукции"));
    return {
      crops: (json?.crops || []) as any[],
      varieties: (json?.varieties || []) as any[],
      reproductions: (json?.reproductions || []) as any[],
    };
  };

  const loadHarvestAllocations = async (companyId: string) => {
    const headers = await getSessionAuthHeaders();
    const response = await fetch(
      `/api/weighbridge/harvest-allocations?companyId=${encodeURIComponent(companyId)}`,
      { cache: "no-store", headers }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(payload?.error || "Не удалось загрузить структуру урожая"));
    return payload;
  };

  const load = async () => {
    if (authLoading || !profile?.company_id || !profile?.id || !canView) return;
    const cacheKey = `${profile.company_id}:${language}`;
    if (!weighbridgePageCache.has(cacheKey)) setLoading(true);
    try {
      const [fieldsRes, warehousesRes, resourceRows, productsRes, identityRefs, supplierRows, buyerRows, operationsRes, bootstrap, harvestAllocations] = await Promise.all([
        supabase.from("fields").select("id,name,area").eq("company_id", profile.company_id).eq("archived", false).order("name"),
        supabase.from("warehouses").select("id,name,name_ru,name_kz,name_en,warehouse_type").eq("company_id", profile.company_id).eq("archived", false).order("name"),
        getWeighbridgeResources(profile.company_id),
        supabase
          .from("products")
          .select("id,name,trade_name,normalized_name,company_id,type,product_type,unit,default_unit,base_uom,pack_uom,package_unit,product_form,formulation,category,subcategory,stock_unit,physical_state,is_seed_material,crop_id,variety_id,seed_reproduction_id")
          .or(`company_id.eq.${profile.company_id},company_id.is.null`)
          .eq("archived", false)
          .order("name"),
        loadMasterIdentityRefs(profile.company_id),
        loadSuppliers(profile.company_id),
        loadBuyers(profile.company_id),
        supabase
          .from("operations")
          .select("id,field_id,operation_type,operation_category_slug,operation_type_slug,date,status")
          .eq("company_id", profile.company_id)
          .eq("archived", false)
          .order("date", { ascending: false })
          .limit(500),
        getWeighbridgeBootstrap(profile.company_id, profile.id),
        loadHarvestAllocations(profile.company_id),
      ]);
      if (fieldsRes.error || warehousesRes.error || productsRes.error || operationsRes.error) {
        throw new Error(fieldsRes.error?.message || warehousesRes.error?.message || productsRes.error?.message || "Не удалось загрузить данные");
      }
      setFields((fieldsRes.data || []).map((r: any) => ({ id: String(r.id), name: String(r.name || "Поле"), area: Number(r.area || 0) })));
      setWarehouses((warehousesRes.data || []).map((r: any) => ({
        id: String(r.id),
        name: localizedName(r, lang, ["name"]) || String(r.name || "Склад"),
        warehouseType: String(r.warehouse_type || ""),
      })));
      setSuppliers(supplierRows);
      setBuyers(buyerRows);
      setFields((prev) => prev.filter((row) => !hasQaDataMarker(row.name)));
      setWarehouses((prev) => prev.filter((row) => !hasQaDataMarker(row.name)));
      setVehicles(((resourceRows?.vehicles || []) as any[]).map((r: any) => ({
        id: String(r.id),
        name: String(r.name || "Машина"),
        model: String(r.model || r.name || ""),
        plate: String(r.plate || ""),
        type: String(r.type || ""),
        fleetType: String(r.fleetType || ""),
        transportCategory: String(r.transportCategory || ""),
        source: r.source === "reference_machines" ? "reference_machines" : "reference_vehicles",
        primaryPersonnelId: r.primaryPersonnelId ? String(r.primaryPersonnelId) : null,
      })));
      setTrailers(((resourceRows?.trailers || []) as any[]).map((r: any) => ({
        id: String(r.id),
        name: String(r.name || "Прицеп"),
        model: String(r.model || r.name || ""),
        plate: String(r.plate || ""),
        type: String(r.type || "trailer"),
        fleetType: String(r.fleetType || "tractor_trailer"),
        transportCategory: String(r.transportCategory || "trailer"),
        source: "reference_vehicles",
        primaryPersonnelId: null,
      })));
      setProcessingPoints([]);
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

      const productRows = dedupeProductsForSelect(
        (productsRes.data || []).filter((row: any) =>
          !hasQaDataMarker(`${brandName(row) || row.name || ""} ${row.product_type || ""} ${row.type || ""}`)
        )
      );
      const cropRows = dedupeByName(
        (identityRefs.crops || []).filter((row: any) => !hasQaDataMarker(localizedName(row, lang, ["name"]) || row.name || ""))
      );
      const varietyRowsRaw = ((identityRefs.varieties || []) as any[]).filter(
        (row: any) => !hasQaDataMarker(brandName(row) || row.name || "")
      );
      const reproductionRowsRaw = ((identityRefs.reproductions || []) as any[]).filter(
        (row: any) => !hasQaDataMarker(localizedName(row, lang, ["name"]) || row.name || "")
      );
      const varietyRows = dedupeByName(varietyRowsRaw);
      const reproductionRows = dedupeByName(reproductionRowsRaw);
      const cropNameById = new Map<string, string>(
        cropRows.map((c: any) => [String(c.id), localizedName(c, lang, ["name"]) || String(c.name || "").trim()])
      );
      const varietyNameById = new Map<string, string>(
        varietyRowsRaw.map((v: any) => [String(v.id), brandName(v) || String(v.name || "").trim()])
      );
      const reproductionNameById = new Map<string, string>(
        reproductionRowsRaw.map((r: any) => [String(r.id), localizedName(r, lang, ["name"]) || String(r.name || "").trim()])
      );

      setProducts(
        productRows.map((r: any) => ({
          id: String(r.id),
          name: brandName(r) || String(r.name || "Номенклатура"),
          type: String(r.product_type || r.type || "").toLowerCase(),
          productType: String(r.product_type || ""),
          unit: String(r.unit || ""),
          defaultUnit: String(r.default_unit || ""),
          baseUom: String(r.base_uom || ""),
          packUom: String(r.pack_uom || ""),
          packageUnit: String(r.package_unit || ""),
          productForm: String(r.product_form || ""),
          formulation: String(r.formulation || ""),
          category: String(r.category || ""),
          subcategory: String(r.subcategory || ""),
          stockUnit: String(r.stock_unit || ""),
          physicalState: String(r.physical_state || ""),
          isSeedMaterial: r.is_seed_material === true,
          cropId: r.crop_id ? String(r.crop_id) : null,
          varietyId: r.variety_id ? String(r.variety_id) : null,
          reproductionId: r.seed_reproduction_id ? String(r.seed_reproduction_id) : null,
        }))
      );
      setCrops(cropRows.map((r: any) => ({ id: String(r.id), name: localizedName(r, lang, ["name"]) || String(r.name || "Культура") })));
      setVarieties(
        varietyRows.map((r: any) => ({
          id: String(r.id),
          name: brandName(r) || String(r.name || "Сорт"),
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
      setDrivers(((resourceRows?.drivers || []) as any[]).map((r: any) => ({
        id: String(r.id),
        name: String(r.name || "Сотрудник"),
        machineId: r.machineId ? String(r.machineId) : null,
        roleType: r.roleType === "mechanic_operator" ? "mechanic_operator" : "driver",
        position: String(r.position || ""),
        department: String(r.department || ""),
        assignedVehicleIds: Array.isArray(r.assignedVehicleIds) ? r.assignedVehicleIds.map(String) : [],
      })));
      setDriverNames(
        Object.fromEntries(
          Object.entries((resourceRows?.driverNames || {}) as Record<string, unknown>).map(([id, name]) => [
            String(id),
            String(name || "Водитель"),
          ])
        )
      );
      const fieldNameById = new Map((fieldsRes.data || []).map((row: any) => [String(row.id), String(row.name || "Поле")]));
      setLinkedOperations(
        (operationsRes.data || []).map((row: any) => {
          const fieldId = row.field_id ? String(row.field_id) : null;
          const fieldName = fieldId ? fieldNameById.get(fieldId) || "Поле" : "Поле";
          const dateText = row.date ? formatDate(String(row.date)) : "—";
          return {
            id: String(row.id),
            field_id: fieldId,
            category_slug: row.operation_category_slug ? String(row.operation_category_slug) : null,
            type_slug: row.operation_type_slug ? String(row.operation_type_slug) : null,
            status: row.status ? String(row.status) : null,
            label: `${row.operation_type || "Operation"} • ${fieldName} • ${dateText}`,
          };
        })
      );
      setLinkedOperations((prev) => prev.filter((row) => !hasQaDataMarker(row.label)));
      setLinkedOperationLines([]);
      setActiveShift(bootstrap?.shift || null);
      setShiftCounters(bootstrap?.counters || {
        activeTickets: 0,
        stuckTickets: 0,
        unsynced: 0,
        requiresReview: 0,
        manualCorrections: 0,
      });
      setShiftGuard(bootstrap?.shiftGuard || { stale: false, ageHours: 0 });
      setShiftSummary(bootstrap?.shiftSummary || { trips: 0, netKg: 0, open: 0, voided: 0, manualCorrections: 0 });
      setHarvestSummary(bootstrap?.harvestSummary || { seasonId: null, today: EMPTY_HARVEST_AGGREGATE, byField: {} });
      setHarvestStructureByField((harvestAllocations?.byField || {}) as Record<string, HarvestStructureOption[]>);
      setHarvestIncompleteFields((harvestAllocations?.incompleteByField || {}) as Record<string, boolean>);
    } catch (e: any) {
      toast({ title: "Ошибка", description: e?.message || "Не удалось загрузить весовую", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const refreshTickets = async (showLoading = false) => {
    if (!profile?.company_id || !profile?.id) return;
    if (showLoading) setTicketsLoading(true);
    try {
      const [rows, batchRows] = await Promise.all([
        listTickets(profile.company_id, profile.id),
        listHarvestBatchSummaries(profile.company_id),
      ]);
      setTickets(rows || []);
      setHarvestBatches(batchRows || []);
    } finally {
      setTicketsLoading(false);
    }
  };

  const refreshBootstrap = async () => {
    if (!profile?.company_id || !profile?.id) return;
    const bootstrap = await getWeighbridgeBootstrap(profile.company_id, profile.id);
    setActiveShift(bootstrap?.shift || null);
    setShiftCounters(bootstrap?.counters || shiftCounters);
    setShiftGuard(bootstrap?.shiftGuard || { stale: false, ageHours: 0 });
    setShiftSummary(bootstrap?.shiftSummary || { trips: 0, netKg: 0, open: 0, voided: 0, manualCorrections: 0 });
    setHarvestSummary(bootstrap?.harvestSummary || { seasonId: null, today: EMPTY_HARVEST_AGGREGATE, byField: {} });
  };

  const verifyOperatorSession = async () => {
    if (!profile?.company_id) return;
    if (!canUseOperatorSession) {
      setOperatorSessionStatus("ready");
      return;
    }
    setOperatorSessionStatus("checking");
    try {
      const nextState = await getWeighbridgeOperatorState(profile.company_id);
      setOperatorState(nextState);
      if (nextState.operator?.id) setOperatorPersonId(nextState.operator.id);
      setOperatorSessionStatus("ready");
    } catch (error) {
      setOperatorSessionStatus("error");
      console.error("Operator session verification failed", error);
    }
  };

  const refreshLiveData = async (event?: { source: string; table?: string }) => {
    const isForeground = !event || event.source !== "realtime";
    const table = event?.table || "";
    const ticketChanged = !table || ["tickets", "ticket_lines", "ticket_weighings", "inventory_batches", "stock_ledger_entries"].includes(table);
    const shiftChanged = !table || table === "weighbridge_shifts";
    const tasks: Promise<unknown>[] = [];
    if (ticketChanged) tasks.push(refreshTickets());
    if (ticketChanged || shiftChanged) tasks.push(refreshBootstrap());
    if (isForeground || shiftChanged) tasks.push(verifyOperatorSession());
    await Promise.all(tasks);
  };

  useLiveRefresh({
    enabled: Boolean(!authLoading && profile?.company_id && profile?.id && canView),
    onRefresh: refreshLiveData,
    companyId: profile?.company_id,
    tables: LIVE_REFRESH_TABLES.weighbridge,
    intervalMs: 60_000,
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
    if (authLoading) return;
    if (!profile?.company_id) return;
    const cached = weighbridgePageCache.get(`${profile.company_id}:${language}`) as any;
    if (cached) {
      setFields(cached.fields || []);
      setWarehouses(cached.warehouses || []);
      setSuppliers(cached.suppliers || []);
      setBuyers(cached.buyers || []);
      setVehicles(cached.vehicles || []);
      setTrailers(cached.trailers || []);
      setProducts(cached.products || []);
      setCrops(cached.crops || []);
      setVarieties(cached.varieties || []);
      setReproductions(cached.reproductions || []);
      setDrivers(cached.drivers || []);
      setDriverNames(cached.driverNames || {});
      setLinkedOperations(cached.linkedOperations || []);
      setHarvestStructureByField(cached.harvestStructureByField || {});
      setHarvestIncompleteFields(cached.harvestIncompleteFields || {});
      setTickets(cached.tickets || []);
      setHarvestBatches(cached.harvestBatches || []);
      setActiveShift(cached.activeShift || null);
      setOperatorState(cached.operatorState || { shift: null, unlocked: false, operators: [] });
      setShiftCounters(cached.shiftCounters || shiftCounters);
      setShiftGuard(cached.shiftGuard || { stale: false, ageHours: 0 });
      setShiftSummary(cached.shiftSummary || shiftSummary);
      setHarvestSummary(cached.harvestSummary || harvestSummary);
      setLoading(false);
      setTicketsLoading(false);
      setOperatorSessionStatus("checking");
    }
    void load();
    void refreshTickets(!cached);
    void verifyOperatorSession();
  }, [authLoading, profile?.company_id, profile?.id, profile?.role, language]);

  useEffect(() => {
    if (loading || !profile?.company_id) return;
    weighbridgePageCache.set(`${profile.company_id}:${language}`, {
      fields,
      warehouses,
      suppliers,
      buyers,
      vehicles,
      trailers,
      products,
      crops,
      varieties,
      reproductions,
      drivers,
      driverNames,
      linkedOperations,
      harvestStructureByField,
      harvestIncompleteFields,
      tickets,
      harvestBatches,
      activeShift,
      operatorState,
      shiftCounters,
      shiftGuard,
      shiftSummary,
      harvestSummary,
    });
  }, [loading, profile?.company_id, language, fields, warehouses, suppliers, buyers, vehicles, trailers, products, crops, varieties, reproductions, drivers, driverNames, linkedOperations, harvestStructureByField, harvestIncompleteFields, tickets, harvestBatches, activeShift, operatorState, shiftCounters, shiftGuard, shiftSummary, harvestSummary]);

  useEffect(() => {
    if (loading || operatorSessionStatus !== "ready" || !canUseOperatorSession || operatorState.unlocked || eligibleOperators.length === 0) return;
    setOperatorPersonId((current) => current || eligibleOperators[0]?.id || "");
    setOperatorDialogOpen(true);
  }, [loading, operatorSessionStatus, canUseOperatorSession, operatorState.unlocked, eligibleOperators]);

  useEffect(() => {
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
    setHydratedFastRepeatKey("");
    if (!fastRepeatPersistKey) return;
    const saved = parseWeighbridgeFastRepeatContext(localStorage.getItem(fastRepeatPersistKey));
    setForm({
      ...INITIAL_FORM,
      ...(saved || {}),
      operationType: "harvest_incoming",
    });
    setClosingTare("");
    setClosingMoisture("");
    setMoistureSavedValue("");
    setCommentOpen(false);
    setHydratedFastRepeatKey(fastRepeatPersistKey);
  }, [fastRepeatPersistKey]);

  useEffect(() => {
    if (
      !fastRepeatPersistKey ||
      hydratedFastRepeatKey !== fastRepeatPersistKey ||
      form.operationType !== "harvest_incoming"
    ) return;
    localStorage.setItem(
      fastRepeatPersistKey,
      JSON.stringify(pickWeighbridgeFastRepeatContext(form))
    );
  }, [fastRepeatPersistKey, hydratedFastRepeatKey, form]);

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
    setHarvestContext((current) => ({ ...current, status: "loading", message: "Проверяем активную уборку..." }));
    (async () => {
      const headers = await buildClientAuthHeaders("none");
      const params = new URLSearchParams({
        fieldId: form.fieldId,
        allocationId: form.cropStructureAllocationId,
      });
      const response = await fetch(`/api/weighbridge/harvest-context?${params.toString()}`, {
        headers,
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error || "Не удалось определить уборку"));
      if (cancelled) return;
      setHarvestContext({
        status: payload.status,
        message: String(payload.message || ""),
        harvestedMassKg: Number(payload.harvestedMassKg || 0),
        harvestedAreaHa: Number(payload.harvestedAreaHa || 0),
        yieldTPerHa: payload.yieldTPerHa == null ? null : Number(payload.yieldTPerHa),
        yieldStatus: payload.yieldStatus || "not_available",
      });
    })().catch((error: any) => {
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
  }, [form.operationType, form.fieldId, form.cropStructureAllocationId, harvestContextRevision]);

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
            "Сорт не указан";
          const reproductionName =
            String(row?.seed_reproductions?.name || "").trim() ||
            reproductions.find((item) => item.id === String(row.reproduction_id || ""))?.name ||
            "Репродукция не указана";
          const area = Number(row.actual_area_ha ?? row.planned_area_ha ?? 0);
          return {
            id: String(row.id),
            operation_id: String(row.operation_id),
            variety_id: row.variety_id ? String(row.variety_id) : null,
            reproduction_id: row.reproduction_id ? String(row.reproduction_id) : null,
            label: `${varietyName} / ${reproductionName} • ${area.toFixed(2)} га`,
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

  const activeTickets = useMemo(() => tickets.filter((t) => ["draft", "active", "ready_to_close"].includes(t.status)), [tickets]);
  const harvestWarehouses = useMemo(
    () => warehouses.filter((warehouse) => isHarvestWarehouseType(warehouse.warehouseType)),
    [warehouses]
  );
  const historyTypes = useMemo(() => Array.from(new Set(tickets.map((t) => t.op_type).filter(Boolean))), [tickets]);
  const historyTickets = useMemo(() => tickets.filter((t) => ["finalized", "voided"].includes(t.status) && (historyTypeFilter === "all" || t.op_type === historyTypeFilter)), [tickets, historyTypeFilter]);
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
  const recommendedPersonnelRole = personnelRoleForVehicle(selectedVehicle);
  const selectableVehicles = vehicles;
  const selectableDrivers = useMemo(() => {
    const ordered = [...drivers].sort((a, b) => {
      const rolePriority = Number(b.roleType === recommendedPersonnelRole) - Number(a.roleType === recommendedPersonnelRole);
      if (rolePriority !== 0) return rolePriority;
      const assignmentPriority = Number(b.assignedVehicleIds.includes(form.vehicleId)) - Number(a.assignedVehicleIds.includes(form.vehicleId));
      if (assignmentPriority !== 0) return assignmentPriority;
      return a.name.localeCompare(b.name, "ru");
    });
    return ordered;
  }, [drivers, recommendedPersonnelRole, form.vehicleId]);
  const vehicleComboboxOptions = useMemo<SearchableComboboxOption[]>(
    () => selectableVehicles.map((vehicle) => ({
      value: vehicle.id,
      label: vehicle.name,
      description: [vehicle.model !== vehicle.name ? vehicle.model : "", vehicle.plate].filter(Boolean).join(" · "),
      keywords: [vehicle.name, vehicle.model, vehicle.plate],
    })),
    [selectableVehicles]
  );
  const driverComboboxOptions = useMemo<SearchableComboboxOption[]>(
    () => selectableDrivers.map((driver) => ({
      value: driver.id,
      label: driver.name,
      description: [driver.position, driver.department].filter(Boolean).join(" · "),
      group: `${personnelRoleLabel(driver.roleType)}${driver.roleType === recommendedPersonnelRole ? " · рекомендуется" : ""}`,
      keywords: [driver.name, driver.position, driver.department],
    })),
    [selectableDrivers, recommendedPersonnelRole]
  );
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

  const selectOperation = (operationType: OperationType) => {
    if (operationType !== "supplier_receipt") {
      setSupplierReceiptLines([]);
    }
    setForm((prev) => {
      const next: FormState = {
        ...INITIAL_FORM,
        operationType,
      };

      const prevGroup = movementGroupForOperation(prev.operationType);
      const nextGroup = movementGroupForOperation(operationType);
      const sameGroup = prevGroup === nextGroup;

      // Shared contextual values for production flow are preserved,
      // but transport/weight actors are always reset between type switches.
      if (operationType === "harvest_incoming" || operationType === "issue_to_field") {
        next.fieldId = prev.fieldId;
        next.cropId = prev.cropId;
        next.varietyId = prev.varietyId;
        next.reproductionId = prev.reproductionId;
        next.cropStructureAllocationId = prev.cropStructureAllocationId;
        next.linkedOperationId = prev.linkedOperationId;
        next.linkedOperationLineId = prev.linkedOperationLineId;
      }

      if (operationType === "harvest_incoming" || operationType === "supplier_receipt" || operationType === "transfer_between_warehouses") {
        next.warehouseToId = prev.warehouseToId;
      }
      if (operationType === "issue_to_field" || operationType === "transfer_between_warehouses" || operationType === "shipment_outbound" || operationType === "disposal_writeoff" || operationType === "impurity_removal") {
        next.warehouseFromId = prev.warehouseFromId;
      }

      if (sameGroup) {
        next.notes = prev.notes;
        next.stockIdentityKey = prev.stockIdentityKey;
        next.productId = prev.productId;
      }

      if (operationType === "supplier_receipt") {
        next.supplierReceiptMode = prev.supplierReceiptMode;
        next.supplierItemMode = prev.supplierItemMode;
        next.supplierId = prev.supplierId;
        next.supplierDocumentNo = prev.supplierDocumentNo;
        next.supplierLot = prev.supplierLot;
        next.harvestYear = prev.harvestYear;
      }

      if (operationType === "issue_to_field") {
        next.fieldIssueMode = prev.fieldIssueMode;
        next.fieldMaterialCategory = prev.fieldMaterialCategory;
        next.linkedOperationId = prev.linkedOperationId;
        next.linkedOperationLineId = prev.linkedOperationLineId;
      }

      if (operationType === "transfer_between_warehouses") {
        next.transferMode = prev.transferMode;
      }

      if (operationType === "shipment_outbound") {
        next.buyerId = prev.buyerId;
        next.shipmentPurpose = prev.shipmentPurpose;
        next.destinationText = prev.destinationText;
        next.externalDocumentNo = prev.externalDocumentNo;
      }

      if (operationType === "disposal_writeoff") {
        next.disposalCategory = prev.disposalCategory;
        next.disposalReason = prev.disposalReason;
      }

      if (operationType === "impurity_removal") {
        next.sourceBatchId = prev.sourceBatchId;
        next.impurityType = prev.impurityType;
      }

      // Explicit volatile reset for every type switch.
      next.driverId = "";
      next.vehicleId = "";
      next.grossKg = "";
      next.harvestMoisture = "";
      next.quantityKg = "";
      next.quantityUom = "";
      next.unitPrice = "";
      next.dryingOutputKg = "";
      next.moistureIn = "";
      next.moistureOut = "";

      return next;
    });
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

  const currentValidationError = loading ? "Данные ещё загружаются" : validate();

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
      batch_id: isImpurityRemoval ? form.sourceBatchId : null,
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
      crop_id: isImpurityRemoval ? selectedHarvestBatch?.cropId || null : form.operationType === "harvest_incoming" || (isFieldIssue && isSeedIssueOperation(form.fieldMaterialCategory)) ? form.cropId : null,
      quantity: movementQuantity,
      uom:
        form.operationType === "harvest_incoming" || isImpurityRemoval || (form.operationType === "supplier_receipt" && form.supplierReceiptMode === "weighbridge")
          ? "kg"
          : selectedTransferStock?.uom || inferProductUnit(productById.get(productId)),
      warehouse_from_id: form.warehouseFromId || null,
      warehouse_to_id: form.warehouseToId || null,
      notes: form.operationType === "harvest_incoming" ? "Приемка урожая" : isImpurityRemoval ? `Вывоз примесей: ${impurityTypeLabels[form.impurityType]}` : form.operationType === "supplier_receipt" ? "Приемка от поставщика" : form.operationType === "transfer_between_warehouses" ? "Межскладское перемещение" : undefined,
      lot_id: isImpurityRemoval ? selectedHarvestBatch?.batchCode || null : form.operationType === "supplier_receipt" ? form.supplierLot.trim() || null : (form.operationType === "transfer_between_warehouses" || isFieldIssue || isShipment || isDisposal) ? selectedTransferStock?.batch_id || null : null,
      supplier_lot: form.operationType === "supplier_receipt" ? form.supplierLot.trim() || null : null,
      batch_id: isImpurityRemoval ? selectedHarvestBatch?.id || null : (form.operationType === "transfer_between_warehouses" || isFieldIssue || isShipment || isDisposal) && isUuidLike(selectedTransferStock?.batch_id) ? selectedTransferStock?.batch_id || null : null,
      batch_class: isImpurityRemoval ? "commodity" : form.operationType === "transfer_between_warehouses" || isFieldIssue || isShipment || isDisposal ? selectedTransferStock?.batch_class || null : null,
      variety_id: isImpurityRemoval ? selectedHarvestBatch?.varietyId || null : form.operationType === "transfer_between_warehouses" || isFieldIssue || isShipment || isDisposal ? selectedTransferStock?.variety_id || null : form.operationType === "harvest_incoming" ? form.varietyId || null : null,
      reproduction_id: isImpurityRemoval ? selectedHarvestBatch?.reproductionId || null : form.operationType === "transfer_between_warehouses" || isFieldIssue || isShipment || isDisposal ? selectedTransferStock?.reproduction_id || null : form.operationType === "harvest_incoming" ? form.reproductionId || null : null,
      operation_line_id: isImpurityRemoval ? selectedHarvestBatch?.operationLineId || null : isFieldIssue ? form.linkedOperationLineId || null : null,
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

    setSubmitting(true);
    try {
      const idempotencyKey = createTicketIdempotencyRef.current || crypto.randomUUID();
      createTicketIdempotencyRef.current = idempotencyKey;
      if (idempotencyPersistKey) localStorage.setItem(idempotencyPersistKey, idempotencyKey);
      if (isTransferDirect && selectedTransferStock) {
        await createWarehouseTransfer(profile.company_id, form.warehouseFromId, {
          destination_warehouse_id: form.warehouseToId,
          product_id: selectedTransferStock.product_id,
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
      const result = await createTicket(ticket, linesToCreate, [], idempotencyKey);
      createTicketIdempotencyRef.current = null;
      if (idempotencyPersistKey) localStorage.removeItem(idempotencyPersistKey);
      const createdStatus = String(result?.ticket?.status || "");
      const createdTicket = result?.ticket as WeighbridgeTicket | undefined;
      if (createdTicket?.id && createdStatus !== "finalized") {
        const localLines = createdTicket.lines || linesToCreate.map((item, index) => ({
          id: `local-${createdTicket.id}-${index}`,
          product_id: item.product_id,
          product_name: productById.get(item.product_id)?.name || "Материал",
          quantity: item.quantity,
          uom: item.uom || "kg",
          variety_id: item.variety_id || null,
          reproduction_id: item.reproduction_id || null,
          batch_class: item.batch_class || null,
          lot_id: item.lot_id || null,
          warehouse_from_id: item.warehouse_from_id || null,
          warehouse_to_id: item.warehouse_to_id || null,
          moisture_percent: item.moisture_percent || null,
          operation_line_id: item.operation_line_id || null,
        }));
        setTickets((current) => [
          ...current.filter((item) => item.id !== createdTicket.id),
          { ...createdTicket, lines: localLines },
        ]);
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
      void refreshBootstrap();
      if (createdStatus === "finalized") void refreshTickets();
    } catch (e: any) {
      toast({ title: "Ошибка создания", description: e?.message || "Не удалось создать талон", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const selectHarvestTarget = (value: string) => {
    const [fieldId, allocationId] = value.split(":");
    const allocation = harvestStructureByField[fieldId]?.find((item) => item.allocationId === allocationId);
    if (!fieldId || !allocation) return;
    setForm((prev) => ({
      ...prev,
      fieldId,
      cropStructureAllocationId: allocation.allocationId,
      cropId: allocation.cropId,
      varietyId: allocation.varietyId,
      reproductionId: allocation.reproductionId,
      linkedOperationId: "",
      linkedOperationLineId: "",
    }));
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
    if (!activeTicket || !profile?.id || !canOperate || finalizing) return;
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
    if (!(await siteConfirm({ title: "Закрыть талон", description: "После закрытия будет создано движение по складу.", actionLabel: "Закрыть" }))) return;

    setFinalizing(true);
    try {
      await patchTicketWithTareConfirmation(activeTicket.id, {
        tare_weight_kg: isDirectQuantityTicket ? 0 : toNum(closingTare) ?? undefined,
        moisture_percent: isHarvestClosure ? moisture : undefined,
        status: "ready_to_close",
      });
      await finalizeTicket(activeTicket.id, profile.id);
      toast({ title: "Талон закрыт", description: "Движение зафиксировано" });
      setActiveTicket(null);
      setTickets((current) => current.filter((ticket) => ticket.id !== activeTicket.id));
      setClosingTare("");
      setClosingMoisture("");
      void refreshBootstrap();
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
        setTickets((current) => current.filter((ticket) => ticket.id !== activeTicket.id));
        setClosingTare("");
        setClosingMoisture("");
        void refreshLiveData({ source: "local", table: "tickets" });
        return;
      }
      toast({ title: "Ошибка закрытия", description: e?.message || "Не удалось закрыть талон", variant: "destructive" });
    } finally {
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
      setActiveTicket(null);
      setTickets((current) => current.filter((ticket) => ticket.id !== activeTicket.id));
      void refreshBootstrap();
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

  if (authLoading) return <PageHeader title="Весовая и движения" description="Проверка доступа..." />;
  if (!canView) return <PageHeader title="Весовая и движения" description="Доступ ограничен по роли" />;

  const openShiftAction = async () => {
    const selected = operatorState.operator?.id || eligibleOperators[0]?.id || "";
    setOperatorPersonId(selected);
    setOperatorPin("");
    setOperatorDialogOpen(true);
  };

  const submitOperatorAction = async () => {
    if (!profile?.company_id || !operatorPersonId || !/^\d{6}$/.test(operatorPin)) return;
    setOperatorBusy(true);
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
      setOperatorState(completeOperatorState);
      setOperatorSessionStatus("ready");
      setActiveShift(nextState.shift || null);
      setOperatorPin("");
      setShiftHandoverNote("");
      setOperatorDialogOpen(false);
      toast({
        title: isHandover ? "Смена передана" : activeShift?.id ? "Терминал разблокирован" : "Смена открыта",
        description: nextState.operator?.name || "Весовщик подтверждён.",
      });
      void Promise.all([refreshTickets(), refreshBootstrap()]);
    } catch (e: any) {
      toast({ title: "PIN не подтверждён", description: e?.message || "Проверьте PIN весовщика.", variant: "destructive" });
    } finally {
      setOperatorBusy(false);
    }
  };

  const lockOperatorAction = async () => {
    if (!profile?.company_id) return;
    try {
      await lockWeighbridgeOperator(profile.company_id);
      setOperatorState((state) => ({ ...state, unlocked: false, operator: null, session_expires_at: null }));
      setOperatorSessionStatus("ready");
      setOperatorPin("");
      setOperatorDialogOpen(true);
    } catch (e: any) {
      toast({ title: "Не удалось заблокировать терминал", description: e?.message, variant: "destructive" });
    }
  };

  const closeShiftAction = async () => {
    if (!profile?.company_id || !profile?.id || !activeShift) return;
    if (shiftCounters.activeTickets > 0) {
      toast({
        title: "Смена не закрыта",
        description: "Сначала закройте все открытые талоны.",
        variant: "destructive",
      });
      return;
    }
    try {
      await closeShift(profile.company_id, profile.id, {
        closingNote: "manual close from weighbridge page",
        handoverNote: shiftHandoverNote.trim() || undefined,
      });
      if (fastRepeatPersistKey) localStorage.removeItem(fastRepeatPersistKey);
      setHydratedFastRepeatKey("");
      setForm(INITIAL_FORM);
      setClosingTare("");
      setClosingMoisture("");
      setMoistureSavedValue("");
      setCommentOpen(false);
      toast({ title: "Смена закрыта", description: "Смена успешно закрыта." });
      setShiftHandoverNote("");
      setShiftDialogOpen(false);
      await Promise.all([refreshTickets(), refreshBootstrap(), verifyOperatorSession()]);
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
      `${item.cropName} / ${item.varietyName} / ${item.reproductionName} • ${item.areaHa.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} га`
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
      operator: ticket.created_by_name_snapshot || profile?.full_name?.trim() || profile?.email,
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
  return (
    <div className="mx-auto max-w-[1680px] space-y-2 px-2 pb-4 sm:px-3">
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
                onClick={() => selectOperation(mode.type)}
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
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-sm">Поле / участок *</Label>
                  <SearchableCombobox
                    value={form.fieldId && form.cropStructureAllocationId ? `${form.fieldId}:${form.cropStructureAllocationId}` : ""}
                    options={harvestTargetOptions}
                    onValueChange={selectHarvestTarget}
                    placeholder="Выберите поле или участок"
                    searchPlaceholder="Поле, культура, сорт или репродукция"
                    emptyLabel="Участок не найден"
                    ariaLabel="Поле или участок"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">Место приёмки *</Label>
                  <Select value={form.warehouseToId} onValueChange={(v) => setForm((p) => ({ ...p, warehouseToId: v }))}>
                    <SelectTrigger className="h-10"><SelectValue placeholder="Выберите место приёмки" /></SelectTrigger>
                    <SelectContent>
                      {harvestWarehouses.length === 0 ? <SelectItem value="__empty" disabled>Места приёмки не настроены</SelectItem> : null}
                      {harvestWarehouses.map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {harvestWarehouses.length === 0 ? (
                    <div className="text-xs text-amber-300">
                      {profile?.role === "company_admin" || profile?.role === "global_admin"
                        ? "Добавьте место приёмки урожая перед началом работы весовой."
                        : "Место приёмки не настроено. Обратитесь к администратору."}
                    </div>
                  ) : null}
                </div>
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
                    <SelectContent>{fieldHarvestOptions.map((x) => <SelectItem key={x.allocationId} value={x.allocationId}>{x.cropName} / {x.varietyName} / {x.reproductionName} • {x.areaHa.toFixed(2)} га</SelectItem>)}</SelectContent>
                  </Select>
                ) : null}
                {selectedHarvestAllocation ? <div className="text-xs text-emerald-300">Участок: {selectedHarvestAllocation.cropName} / {selectedHarvestAllocation.varietyName} / {selectedHarvestAllocation.reproductionName} • {selectedHarvestAllocation.areaHa.toFixed(2)} га</div> : null}
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
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>Транспорт{form.operationType === "supplier_receipt" ? " (необязательно)" : " *"}</Label>
                  <SearchableCombobox
                    value={form.vehicleId}
                    options={vehicleComboboxOptions}
                    onValueChange={(vehicleId) => setForm((prev) => ({ ...prev, vehicleId }))}
                    placeholder="Выберите транспорт"
                    searchPlaceholder="Название, модель или госномер"
                    emptyLabel="Транспорт не найден"
                    ariaLabel="Транспорт"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Водитель{form.operationType === "supplier_receipt" ? " (необязательно)" : " *"}</Label>
                  <SearchableCombobox
                    value={form.driverId}
                    options={driverComboboxOptions}
                    onValueChange={(driverId) => setForm((prev) => ({ ...prev, driverId }))}
                    placeholder="Выберите водителя"
                    searchPlaceholder="Фамилия, имя или ФИО"
                    emptyLabel="Водитель не найден"
                    ariaLabel="Водитель"
                  />
                  {drivers.length === 0 ? (
                    <div className="text-xs text-amber-300">
                      {profile?.role === "company_admin" || profile?.role === "global_admin"
                        ? "Добавьте водителей в справочнике сотрудников до начала уборки."
                        : "Водители не настроены. Обратитесь к администратору компании."}
                    </div>
                  ) : null}
                </div>
              </div>
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
                  <Input className="h-10" inputMode="decimal" value={form.grossKg} onChange={(e) => setForm((p) => ({ ...p, grossKg: e.target.value }))} placeholder="0" />
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
                {form.operationType === "harvest_incoming" && !loading && currentValidationError ? (
                  <div className="mt-1 truncate text-xs text-amber-300" title={currentValidationError}>{currentValidationError}</div>
                ) : null}
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
                {loading ? <div className="mt-1 text-xs text-amber-300">Данные ещё загружаются. Повторите через пару секунд.</div> : null}
                {!loading && !activeShift && !isSupplierDirect ? <div className="mt-1 text-xs text-amber-300">Смена закрыта: откройте её через меню ⋯.</div> : null}
                {!loading && activeShift && canUseOperatorSession && !operatorState.unlocked && !isSupplierDirect ? (
                  <button type="button" className="mt-1 text-left text-xs font-medium text-amber-300 underline underline-offset-2" onClick={openShiftAction}>
                    Терминал заблокирован: введите PIN весовщика.
                  </button>
                ) : null}
                {!loading && activeShift && currentValidationError ? (
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
              <Badge className="border border-slate-700 bg-slate-950 text-slate-200">{activeTickets.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[720px] space-y-2 overflow-y-auto px-3 py-3 travkin-scrollbar">
            {ticketsLoading ? <div className="text-sm text-slate-400">Загрузка очереди...</div> : activeTickets.length === 0 ? <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/45 p-6 text-center text-sm text-slate-500">Открытых талонов нет</div> : [...activeTickets].sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()).map((t) => {
              const vehicleName = vehicles.find((v) => v.id === t.vehicle_id)?.name || "Транспорт";
              const driverName = driverNameForId(t.driver_id) || "Без водителя";
              const meta = ticketCardMeta(t, vehicleName, driverName);
              return (
                <button key={`open-${t.id}`} type="button" onClick={() => setActiveTicket(t)} className="w-full rounded-xl border border-slate-800 bg-slate-950/55 px-3 py-3 text-left transition hover:border-yellow-500/50 hover:bg-slate-900">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-50">{productSummary(t)}</div>
                      <div className="mt-1 line-clamp-2 text-xs text-slate-400">{ticketRouteSummary(t)}</div>
                    </div>
                    <Badge className="h-5 shrink-0 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2 text-[10px] text-yellow-100">{ticketStageLabel(t)}</Badge>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-semibold text-slate-200">{ticketQuantitySummary(t)}</span>
                    <span className="shrink-0 text-[11px] text-slate-500">{fmt(t.created_at, lang)}</span>
                  </div>
                  <div className="mt-1 truncate text-[11px] text-slate-500">{meta} • {t.ticket_no}</div>
                </button>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <details className={`${terminalPanelClass} group`}>
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
              <Select value={historyTypeFilter} onValueChange={setHistoryTypeFilter}>
                <SelectTrigger className="border-slate-700 bg-slate-950 text-slate-100"><SelectValue placeholder="Фильтр по типу" /></SelectTrigger>
                <SelectContent><SelectItem value="all">Все типы</SelectItem>{historyTypes.map((type) => <SelectItem key={type} value={type}>{operationUiLabel(type)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 px-3 py-3 sm:px-4">
            {ticketsLoading ? <div className="text-sm text-slate-400">Загрузка журнала...</div> : null}
            {!ticketsLoading && historyTickets.length === 0 ? <div className="rounded-lg border border-dashed border-slate-800 p-6 text-center text-sm text-slate-500">Закрытых талонов пока нет</div> : null}
            {!ticketsLoading && historyTickets.slice(0, 80).map((t) => {
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
        <SheetContent side="right" className="w-full overflow-y-auto bg-slate-950 text-slate-100 sm:max-w-xl">
          {activeTicket ? (
            <div className="space-y-4">
              <SheetHeader className="sr-only">
                <SheetTitle>Талон {activeTicket.ticket_no}</SheetTitle>
                <SheetDescription>{operationUiLabel(activeTicket.op_type)}</SheetDescription>
              </SheetHeader>
              <WeighbridgeTicketPaper ticket={activeTicket} labels={ticketPaperLabels(activeTicket)} />

              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
                <div className="space-y-2">
                  <Label>Брутто (кг)</Label>
                  <Input value={gross} readOnly className="border-slate-700 bg-slate-950 font-semibold text-slate-100" />
                </div>
                {activeTicket.op_type === "harvest_incoming" ? (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <Label>Влажность, %</Label>
                      <span className="text-xs text-slate-500">{moistureSaving ? "Сохранение..." : closingMoisture === moistureSavedValue ? "Сохранено" : "Enter или уход из поля"}</span>
                    </div>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="100"
                      step="0.1"
                      value={closingMoisture}
                      onChange={(e) => setClosingMoisture(e.target.value)}
                      onBlur={() => void saveActiveTicketMoisture()}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        void saveActiveTicketMoisture();
                      }}
                      disabled={!canOperate || moistureSaving}
                      placeholder="13,8"
                    />
                  </div>
                ) : null}
                <div className="mt-3 space-y-2">
                  <Label>Тара (кг)</Label>
                  <Input ref={tareInputRef} value={closingTare} onChange={(e) => setClosingTare(e.target.value)} disabled={!canOperate} />
                  {closingTareValidation && !closingTareValidation.ok ? <div className="text-xs text-rose-300">{closingTareValidation.message}</div> : null}
                </div>
                <div className="mt-3 rounded-md border border-slate-700 bg-slate-950 p-3 text-sm text-slate-100">
                  <div className="flex items-center justify-between"><span>Брутто</span><span>{formatWeightKg(gross)}</span></div>
                  <div className="flex items-center justify-between"><span>Тара</span><span>{formatWeightKg(closingTare)}</span></div>
                  <div className="my-2 border-t border-slate-700" />
                  <div className="flex items-center justify-between font-semibold"><span>Чистый вес (нетто)</span><span>{formatWeightKg(pure)}</span></div>
                  <div className="mt-2 text-xs text-slate-400">Формула: net = gross - tare</div>
                  {pure != null && pure <= 0 ? <div className="mt-2 text-xs text-red-300">Ошибка: тара не может быть больше или равна брутто</div> : null}
                </div>
              </div>

              {canOperate ? (
                <div className="space-y-2">
                  {canCorrectTicket ? (
                    <Button variant="outline" className="w-full" onClick={openActiveTicketEditor}>
                      <Pencil className="mr-2 h-4 w-4" />Исправить данные открытого талона
                    </Button>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" onClick={async () => { if (!profile?.id) return; try { await downloadTicketPdf(activeTicket.id, profile.id); } catch (error: any) { toast({ title: "Ошибка PDF", description: error?.message || "Не удалось скачать PDF", variant: "destructive" }); } }}>
                      <FileDown className="mr-2 h-4 w-4" />Скачать PDF
                    </Button>
                    <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={closeTicket} disabled={finalizing || !closingTare || (pure != null && pure <= 0)}>
                      <CheckCircle2 className="mr-2 h-4 w-4" />{finalizing ? "Закрытие..." : "Закрыть талон"}
                    </Button>
                  </div>
                  {canCorrectTicket ? (
                    <div className="space-y-2 rounded-md border border-red-500/30 bg-red-950/30 p-3 text-red-50">
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
      <Dialog open={operatorDialogOpen} onOpenChange={(open) => { if (!operatorBusy) setOperatorDialogOpen(open); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{activeShift ? "Весовщик смены" : "Открыть смену"}</DialogTitle>
            <DialogDescription>Выберите сотрудника и подтвердите доступ личным PIN.</DialogDescription>
          </DialogHeader>
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
              </div>
            ) : null}
            {activeShift?.id && activeShift?.operator_person_id && activeShift.operator_person_id !== operatorPersonId ? (
              <div className="space-y-2">
                <Label>Комментарий к передаче</Label>
                <Textarea value={shiftHandoverNote} onChange={(event) => setShiftHandoverNote(event.target.value)} rows={2} placeholder="Необязательно" />
              </div>
            ) : null}
          </div>
          <DialogFooter className="gap-2">
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setOperatorDialogOpen(false)} disabled={operatorBusy}>Отмена</Button>
              <Button type="button" onClick={() => void submitOperatorAction()} disabled={operatorBusy || !eligibleOperators.length || !operatorPersonId || !/^\d{6}$/.test(operatorPin)}>
                {operatorBusy
                  ? "Проверка..."
                  : activeShift?.id && activeShift?.operator_person_id && activeShift.operator_person_id !== operatorPersonId
                    ? "Передать смену"
                    : activeShift?.id ? "Продолжить смену" : "Открыть смену"}
              </Button>
            </div>
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
