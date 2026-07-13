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
import { brandName, localizedName } from "@/lib/i18n/helpers";
import { supabase } from "@/lib/supabase/client";
import { buildClientAuthHeaders } from "@/lib/supabase/client-auth";
import { adminTicketAction, closeShift, createTicket, downloadTicketPdf, finalizeTicket, getWeighbridgeBootstrap, getWeighbridgeResources, listTickets, openShift, patchTicket, voidTicket } from "@/lib/services/weighbridge";
import type { TicketDirection, TicketInput, TicketLineInput, WeighbridgeTicket } from "@/lib/types/weighbridge";
import { hasQaDataMarker } from "@/lib/utils/qa-data";

type Lang = "ru" | "kz" | "en";
type OperationType = "harvest_incoming" | "supplier_receipt" | "issue_to_field" | "transfer_between_warehouses" | "shipment_outbound" | "disposal_writeoff" | "drying";
type MovementGroup = "warehouse_inbound" | "field_issue" | "internal_transfer" | "shipment" | "writeoff";
type Option = { id: string; name: string };
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
type LinkedOperationOption = { id: string; field_id: string | null; label: string };
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
  linkedOperationId: string;
  linkedOperationLineId: string;
  quantityKg: string;
  quantityUom: string;
  unitPrice: string;
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
  linkedOperationId: "",
  linkedOperationLineId: "",
  quantityKg: "",
  quantityUom: "",
  unitPrice: "",
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

const PERSIST_KEYS: Array<keyof FormState> = [
  "operationType",
  "fieldId",
  "warehouseFromId",
  "warehouseToId",
  "processingPointId",
  "cropId",
  "varietyId",
  "reproductionId",
  "cropStructureAllocationId",
  "supplierId",
  "buyerId",
  "supplierDocumentNo",
  "shipmentPurpose",
  "destinationText",
  "externalDocumentNo",
  "supplierReceiptMode",
  "supplierItemMode",
  "transferMode",
  "fieldIssueMode",
  "fieldMaterialCategory",
  "supplierLot",
  "harvestYear",
  "productId",
  "stockIdentityKey",
  "linkedOperationId",
  "linkedOperationLineId",
  "quantityUom",
  "disposalCategory",
  "notes",
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

const ticketCompanyLabel = (ticket: WeighbridgeTicket | null | undefined) =>
  String(ticket?.company_name || "").trim() || "Компания";

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
  const n = Number(quantity || 0);
  if (!Number.isFinite(n)) return "-";
  return `${n.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} ${unitLabel(unit)}`;
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

export default function WeighbridgeOperationsPage() {
  const { profile, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const { language } = useLanguage();
  const lang = getLang(language);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [supplierReceiptLines, setSupplierReceiptLines] = useState<SupplierReceiptLineDraft[]>([]);
  const [showSupplierExtraFields, setShowSupplierExtraFields] = useState(false);
  const [tickets, setTickets] = useState<WeighbridgeTicket[]>([]);
  const [fields, setFields] = useState<{ id: string; name: string; area: number }[]>([]);
  const [warehouses, setWarehouses] = useState<Option[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [buyers, setBuyers] = useState<Option[]>([]);
  const [vehicles, setVehicles] = useState<{ id: string; name: string; plate: string; primaryPersonnelId: string | null }[]>([]);
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
  const [drivers, setDrivers] = useState<{ id: string; name: string; machineId: string | null; assignedVehicleIds: string[] }[]>([]);
  const [harvestStructureByField, setHarvestStructureByField] = useState<Record<string, HarvestStructureOption[]>>({});
  const [harvestIncompleteFields, setHarvestIncompleteFields] = useState<Record<string, boolean>>({});
  const [activeTicket, setActiveTicket] = useState<WeighbridgeTicket | null>(null);
  const [closingTare, setClosingTare] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [shiftHandoverNote, setShiftHandoverNote] = useState("");
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
  const persistKey = useMemo(
    () => (profile?.company_id && profile?.id ? `travkin.weighbridge.formDraft.${profile.company_id}.${profile.id}` : ""),
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
    const { data, error } = await supabase
      .from("counterparties")
      .select("id,name,counterparty_type,is_active,archived")
      .eq("company_id", companyId)
      .eq("archived", false)
      .eq("is_active", true)
      .in("counterparty_type", ["buyer", "both", "other"])
      .order("name");
    if (error) {
      const msg = String(error?.message || "").toLowerCase();
      if (msg.includes("counterparties") || msg.includes("schema cache")) return [] as Option[];
      throw error;
    }
    return (data || []).map((r: any) => ({ id: String(r.id), name: String(r.name || "Контрагент") }));
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

  const load = async () => {
    if (authLoading || !profile?.company_id || !profile?.id || !canView) return;
    setLoading(true);
    try {
      const [fieldsRes, warehousesRes, resourceRows, processingRes, productsRes, identityRefs, supplierRows, buyerRows, ticketRows, operationsRes] = await Promise.all([
        supabase.from("fields").select("id,name,area").eq("company_id", profile.company_id).eq("archived", false).order("name"),
        supabase.from("warehouses").select("id,name,name_ru,name_kz,name_en").eq("company_id", profile.company_id).eq("archived", false).order("name"),
        getWeighbridgeResources(profile.company_id),
        supabase.from("processing_points").select("id,name").eq("company_id", profile.company_id).eq("archived", false).order("name"),
        supabase
          .from("products")
          .select("id,name,trade_name,normalized_name,company_id,type,product_type,unit,default_unit,base_uom,pack_uom,package_unit,product_form,formulation,category,subcategory")
          .or(`company_id.eq.${profile.company_id},company_id.is.null`)
          .eq("archived", false)
          .order("name"),
        loadMasterIdentityRefs(profile.company_id),
        loadSuppliers(profile.company_id),
        loadBuyers(profile.company_id),
        listTickets(profile.company_id, profile.id),
        supabase
          .from("operations")
          .select("id,field_id,operation_type,date,status")
          .eq("company_id", profile.company_id)
          .eq("archived", false)
          .order("date", { ascending: false })
          .limit(500),
      ]);
      if (fieldsRes.error || warehousesRes.error || processingRes.error || productsRes.error || operationsRes.error) {
        throw new Error(fieldsRes.error?.message || warehousesRes.error?.message || processingRes.error?.message || productsRes.error?.message || "Не удалось загрузить данные");
      }
      setFields((fieldsRes.data || []).map((r: any) => ({ id: String(r.id), name: String(r.name || "Поле"), area: Number(r.area || 0) })));
      setWarehouses((warehousesRes.data || []).map((r: any) => ({ id: String(r.id), name: localizedName(r, lang, ["name"]) || String(r.name || "Склад") })));
      setSuppliers(supplierRows);
      setBuyers(buyerRows);
      setFields((prev) => prev.filter((row) => !hasQaDataMarker(row.name)));
      setWarehouses((prev) => prev.filter((row) => !hasQaDataMarker(row.name)));
      setVehicles(((resourceRows?.vehicles || []) as any[]).map((r: any) => ({ id: String(r.id), name: String(r.name || "Машина"), plate: String(r.plate || ""), primaryPersonnelId: r.primaryPersonnelId ? String(r.primaryPersonnelId) : null })));
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

      const productRows = dedupeByName(
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
        name: String(r.name || "Ответственный"),
        machineId: r.machineId ? String(r.machineId) : null,
        assignedVehicleIds: Array.isArray(r.assignedVehicleIds) ? r.assignedVehicleIds.map(String) : [],
      })));
      setTickets(ticketRows || []);
      const fieldNameById = new Map((fieldsRes.data || []).map((row: any) => [String(row.id), String(row.name || "Поле")]));
      setLinkedOperations(
        (operationsRes.data || []).map((row: any) => {
          const fieldId = row.field_id ? String(row.field_id) : null;
          const fieldName = fieldId ? fieldNameById.get(fieldId) || "Поле" : "Поле";
          const dateText = row.date ? formatDate(String(row.date)) : "—";
          return {
            id: String(row.id),
            field_id: fieldId,
            label: `${row.operation_type || "Operation"} • ${fieldName} • ${dateText}`,
          };
        })
      );
      setLinkedOperations((prev) => prev.filter((row) => !hasQaDataMarker(row.label)));
      setLinkedOperationLines([]);
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
        const headers = await getSessionAuthHeaders();
        const resp = await fetch(
          `/api/weighbridge/harvest-allocations?companyId=${encodeURIComponent(profile.company_id)}`,
          { cache: "no-store", headers }
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
    if (authLoading) return;
    void load();
  }, [authLoading, profile?.company_id, profile?.id, profile?.role, language]);

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
    const payload = PERSIST_KEYS.reduce((acc, key) => {
      (acc as Record<string, string>)[key] = form[key];
      return acc;
    }, {} as Partial<FormState>);
    localStorage.setItem(persistKey, JSON.stringify(payload));
  }, [persistKey, form]);

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
    setVoidReason("");
    if (activeTicket.status !== "finalized" && activeTicket.status !== "voided") {
      window.setTimeout(() => tareInputRef.current?.focus(), 80);
    }
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

  const linkedOperationsForField = useMemo(() => {
    if (form.operationType !== "issue_to_field" || !form.fieldId) return [] as LinkedOperationOption[];
    return linkedOperations.filter((row) => !row.field_id || row.field_id === form.fieldId);
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
  const historyTypes = useMemo(() => Array.from(new Set(tickets.map((t) => t.op_type).filter(Boolean))), [tickets]);
  const historyTickets = useMemo(() => tickets.filter((t) => ["finalized", "voided"].includes(t.status) && (historyTypeFilter === "all" || t.op_type === historyTypeFilter)), [tickets, historyTypeFilter]);
  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const activeTicketLineTotal = useMemo(
    () => (activeTicket?.lines || []).reduce((sum, line) => sum + Number(line.quantity || 0), 0),
    [activeTicket?.id, activeTicket?.lines]
  );
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
  const gross = activeTicket?.gross_weight_kg != null ? String(activeTicket.gross_weight_kg) : activeTicket?.weigh_method === "manual_override_with_reason" && activeTicketLineTotal > 0 ? String(activeTicketLineTotal) : "";
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
  const supplierReceiptGenericLineDrafts = useMemo(() => {
    if (form.operationType !== "supplier_receipt" || form.supplierItemMode !== "generic") return [];
    const base: SupplierReceiptLineDraft = {
      localId: "base",
      productId: form.productId,
      quantityKg: form.quantityKg,
      uom: form.quantityUom,
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
  }, [form.operationType, form.supplierItemMode, form.productId, form.quantityKg, form.quantityUom, form.warehouseToId, form.supplierLot, form.unitPrice, supplierReceiptLines]);
  const supplierReceiptGenericLineTotal = useMemo(
    () => supplierReceiptGenericLineDrafts.reduce((sum, line) => sum + Number(toNum(line.quantityKg) || 0), 0),
    [supplierReceiptGenericLineDrafts]
  );
  const supplierReceiptUsesMultipleLines =
    form.operationType === "supplier_receipt" &&
    form.supplierItemMode === "generic" &&
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
      }

      if (operationType === "harvest_incoming" || operationType === "supplier_receipt" || operationType === "transfer_between_warehouses") {
        next.warehouseToId = prev.warehouseToId;
      }
      if (operationType === "issue_to_field" || operationType === "transfer_between_warehouses" || operationType === "shipment_outbound" || operationType === "disposal_writeoff") {
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

      // Explicit volatile reset for every type switch.
      next.driverId = "";
      next.vehicleId = "";
      next.grossKg = "";
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
      if (!form.fieldId || !form.warehouseToId || !form.cropStructureAllocationId || !form.cropId) {
        return "Заполните поле, склад и культуру";
      }
      if (!fieldHarvestOptions.some((x) => x.allocationId === form.cropStructureAllocationId)) {
        return "Выбранная посевная строка не связана с этим полем";
      }
      if (!selectedHarvestAllocation?.varietyId || !selectedHarvestAllocation?.reproductionId) {
        return "Для прихода урожая нужно указать сорт и репродукцию в структуре посевов. Откройте структуру посевов, выберите строку и заполните сорт/репродукцию.";
      }
      if (!toNum(form.grossKg) || Number(form.grossKg) <= 0) return "Укажите брутто";
    } else if (form.operationType === "supplier_receipt") {
      if (!form.supplierId) return "Выберите контрагента";
      if (!form.warehouseToId) return "Выберите склад назначения";
      if (form.supplierReceiptMode === "weighbridge") {
        if (!form.driverId) return "Выберите водителя";
        if (!form.vehicleId) return "Выберите машину";
        if (!toNum(form.grossKg) || Number(form.grossKg) <= 0) return "Укажите брутто";
      } else if (form.supplierItemMode === "generic" && supplierReceiptGenericLineTotal <= 0) {
        return "Укажите количество по накладной";
      } else if (form.supplierItemMode === "agro_identity" && (!toNum(form.quantityKg) || Number(form.quantityKg) <= 0)) {
        return "Укажите количество по накладной";
      }
      if (form.supplierItemMode === "generic") {
        if (!supplierReceiptGenericLineDrafts.length || supplierReceiptGenericLineDrafts.some((line) => !line.productId)) {
          return "Выберите номенклатуру по каждой строке поставки";
        }
        if (supplierReceiptGenericLineDrafts.some((line) => !normalizeUnit(line.uom || inferProductUnit(productById.get(line.productId))))) {
          return "Выберите единицу измерения по каждой строке поставки";
        }
        if (supplierReceiptGenericLineDrafts.some((line) => !(line.warehouseToId || form.warehouseToId))) {
          return "Выберите склад по каждой строке поставки";
        }
        if ((form.supplierReceiptMode === "direct" || supplierReceiptUsesMultipleLines) && supplierReceiptGenericLineDrafts.some((line) => !toNum(line.quantityKg) || Number(line.quantityKg) <= 0)) {
          return "Укажите количество по каждой строке поставки";
        }
      }
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
      if (!form.fieldId || !form.warehouseToId || !form.cropStructureAllocationId || !form.cropId) {
        return "Заполните поле, склад и культуру";
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
      if (form.linkedOperationLineId && !form.linkedOperationId) return "Сначала выберите операцию, затем строку операции";
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
    if (!activeShift && !(form.operationType === "supplier_receipt" && form.supplierReceiptMode === "direct")) {
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
      form.operationType === "supplier_receipt" && form.supplierItemMode === "generic" && form.supplierReceiptMode === "direct"
        ? supplierReceiptGenericLineTotal
        :
      form.operationType === "harvest_incoming" || (form.operationType === "supplier_receipt" && form.supplierReceiptMode === "weighbridge") || (isTransfer && form.transferMode === "weighbridge") || isFieldIssueWeighbridge || isShipment
        || isDisposal
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
      created_by: profile.id,
      ticket_type: meta.ticketType,
      op_type: meta.opType,
      direction: meta.direction,
      source_kind: meta.sourceKind,
      destination_kind: meta.destinationKind,
      source_id: form.operationType === "harvest_incoming" ? form.fieldId : form.operationType === "supplier_receipt" ? supplierCounterpartyId : form.warehouseFromId || null,
      destination_id: form.operationType === "harvest_incoming" ? form.warehouseToId : form.operationType === "issue_to_field" ? form.fieldId : form.operationType === "shipment_outbound" ? form.buyerId : form.operationType === "drying" ? form.processingPointId : form.warehouseToId || null,
      crop_structure_allocation_id: form.operationType === "harvest_incoming" || isFieldIssue ? form.cropStructureAllocationId || null : null,
      supplier_id: form.operationType === "supplier_receipt" ? supplierCounterpartyId || null : null,
      buyer_id: form.operationType === "shipment_outbound" ? form.buyerId || null : null,
      shipment_purpose: form.operationType === "shipment_outbound" ? form.shipmentPurpose : null,
      destination_text: form.operationType === "shipment_outbound" ? form.destinationText.trim() || null : null,
      external_document_no: form.operationType === "shipment_outbound" ? form.externalDocumentNo.trim() || null : null,
      supplier_document_no: form.operationType === "supplier_receipt" ? form.supplierDocumentNo.trim() || null : null,
      receipt_mode: form.operationType === "supplier_receipt" ? form.supplierReceiptMode : null,
      supplier_receipt_kind: form.operationType === "supplier_receipt" ? form.supplierItemMode : null,
      field_operation_type: isFieldIssue ? "issued_to_field" : null,
      field_material_category: isFieldIssue ? form.fieldMaterialCategory : null,
      linked_operation_id: isFieldIssue ? form.linkedOperationId || null : null,
      disposal_category: form.operationType === "disposal_writeoff" ? form.disposalCategory : null,
      field_id: form.operationType === "supplier_receipt" ? null : form.fieldId || null,
      warehouse_from_id: form.operationType === "supplier_receipt" ? null : form.warehouseFromId || null,
      warehouse_to_id: form.warehouseToId || null,
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
        ...supplierNotes,
        form.notes.trim(),
      ].filter(Boolean).join("\n") || null,
    };

    const line: TicketLineInput = {
      product_id: productId,
      crop_id: form.operationType === "harvest_incoming" || (form.operationType === "supplier_receipt" && form.supplierItemMode === "agro_identity") || (isFieldIssue && isSeedIssueOperation(form.fieldMaterialCategory)) ? form.cropId : null,
      quantity: movementQuantity,
      uom:
        form.operationType === "harvest_incoming"
          ? "kg"
          : selectedTransferStock?.uom || inferProductUnit(productById.get(productId)),
      warehouse_from_id: form.warehouseFromId || null,
      warehouse_to_id: form.warehouseToId || null,
      notes: form.operationType === "harvest_incoming" ? "Приемка урожая" : form.operationType === "supplier_receipt" ? "Приемка от поставщика" : form.operationType === "transfer_between_warehouses" ? "Межскладское перемещение" : undefined,
      lot_id: form.operationType === "supplier_receipt" ? form.supplierLot.trim() || null : (form.operationType === "transfer_between_warehouses" || isFieldIssue || isShipment || isDisposal) ? selectedTransferStock?.batch_id || null : null,
      supplier_lot: form.operationType === "supplier_receipt" ? form.supplierLot.trim() || null : null,
      batch_id: (form.operationType === "transfer_between_warehouses" || isFieldIssue || isShipment || isDisposal) && isUuidLike(selectedTransferStock?.batch_id) ? selectedTransferStock?.batch_id || null : null,
      batch_class: form.operationType === "transfer_between_warehouses" || isFieldIssue || isShipment || isDisposal ? selectedTransferStock?.batch_class || null : null,
      variety_id: form.operationType === "transfer_between_warehouses" || isFieldIssue || isShipment || isDisposal ? selectedTransferStock?.variety_id || null : form.operationType === "harvest_incoming" || (form.operationType === "supplier_receipt" && form.supplierItemMode === "agro_identity") ? form.varietyId || null : null,
      reproduction_id: form.operationType === "transfer_between_warehouses" || isFieldIssue || isShipment || isDisposal ? selectedTransferStock?.reproduction_id || null : form.operationType === "harvest_incoming" || (form.operationType === "supplier_receipt" && form.supplierItemMode === "agro_identity") ? form.reproductionId || null : null,
      operation_line_id: isFieldIssue ? form.linkedOperationLineId || null : null,
      moisture_percent: form.operationType === "drying" ? toNum(form.moistureIn) : null,
      net_line_weight_kg: form.operationType === "drying" ? toNum(form.dryingOutputKg) : null,
    };
    const linesToCreate: TicketLineInput[] =
      form.operationType === "supplier_receipt" && form.supplierItemMode === "generic"
        ? supplierReceiptGenericLineDrafts.map((draft, index) => {
            const qty = toNum(draft.quantityKg) ?? (supplierReceiptGenericLineDrafts.length === 1 ? movementQuantity : 0);
            const unitPrice = toNum(draft.unitPrice);
            const uom = normalizeUnit(draft.uom || inferProductUnit(productById.get(draft.productId)));
            return {
              product_id: draft.productId,
              crop_id: null,
              quantity: qty,
              uom,
              warehouse_to_id: draft.warehouseToId || form.warehouseToId || null,
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
      const result = await createTicket(ticket, linesToCreate, []);
      const createdStatus = String(result?.ticket?.status || "");
      if (isSupplierDirect || createdStatus === "finalized") {
        toast({
          title: "Приход по накладной проведён",
          description: "Партия и складское движение созданы без активного талона весовой.",
        });
      }
      if (!isSupplierDirect && createdStatus !== "finalized") {
        toast({ title: "Талон создан", description: "Талон добавлен в активные" });
      }
      setForm((prev) => ({
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
      }));
      setSupplierReceiptLines([]);
      setShowSupplierExtraFields(false);
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
    const g = isDirectQuantityTicket
      ? Number(activeTicket.gross_weight_kg || 0) || activeTicketLineTotal
      : Number(activeTicket.gross_weight_kg || 0);
    const t = isDirectQuantityTicket ? 0 : Number(closingTare || 0);
    if (!Number.isFinite(g) || g <= 0) return toast({ title: "Ошибка", description: "Брутто не заполнено", variant: "destructive" });
    if (!isDirectQuantityTicket && (!Number.isFinite(t) || t < 0)) return toast({ title: "Ошибка", description: "Укажите тару", variant: "destructive" });
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
      await load();
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
    const confirmed = await siteConfirm({
      title: "Закрыть смену",
      description: shiftCounters.activeTickets > 0
        ? "Есть открытые талоны. Проверьте комментарий передачи смены и подтвердите закрытие."
        : "Смена будет закрыта для новых операций весовой.",
      actionLabel: "Закрыть смену",
    });
    if (!confirmed) return;
    try {
      await closeShift(profile.company_id, profile.id, {
        closingNote: "manual close from weighbridge page",
        handoverNote: shiftHandoverNote.trim() || undefined,
      });
      toast({ title: "Смена закрыта", description: "Смена успешно закрыта." });
      setShiftHandoverNote("");
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
    return `${warehouseName(ticket.warehouse_from_id)} → ${ticket.destination_text || ticket.destination_kind || "-"}`;
  };
  const from = activeTicket ? (activeTicket.direction === "incoming" ? fields.find((f) => f.id === activeTicket.field_id)?.name : warehouses.find((w) => w.id === activeTicket.warehouse_from_id)?.name) || "-" : "-";
  const to = activeTicket ? (activeTicket.direction === "incoming" ? warehouses.find((w) => w.id === activeTicket.warehouse_to_id)?.name : activeTicket.direction === "outgoing" ? fields.find((f) => f.id === activeTicket.field_id)?.name : warehouses.find((w) => w.id === activeTicket.warehouse_to_id)?.name) || "-" : "-";
  const terminalPanelClass = "rounded-2xl border border-slate-800/80 bg-[#101724]/95 shadow-[0_18px_60px_rgba(2,6,23,0.28)]";
  const formSectionClass = "rounded-2xl border border-slate-800/80 bg-[#0B1220]/72 p-3";
  const segmentClass = (active: boolean) =>
    active
      ? "h-9 border-yellow-500/70 bg-yellow-500/15 text-yellow-100 hover:bg-yellow-500/20"
      : "h-9 border-slate-800 bg-slate-950/60 text-slate-200 hover:border-slate-700 hover:bg-slate-900 hover:text-slate-50";

  return (
    <div className="mx-auto max-w-[1680px] space-y-3 px-2 pb-4 sm:px-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-800/80 bg-[#101724]/95 px-4 py-3 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-50">Весовая</h1>
            <Badge className={activeShift ? "bg-emerald-400/15 text-emerald-200 border border-emerald-400/30" : "bg-amber-400/15 text-amber-200 border border-amber-400/30"}>
              {activeShift ? "смена открыта" : "смена закрыта"}
            </Badge>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
            <span>Открытые: <b className="text-slate-100">{shiftCounters.activeTickets}</b></span>
            <span>Зависшие: <b className="text-slate-100">{shiftCounters.stuckTickets}</b></span>
            <span>Проверка: <b className="text-slate-100">{shiftCounters.requiresReview}</b></span>
            {activeShift?.opened_at ? <span>с {fmt(activeShift.opened_at, lang)}</span> : null}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <Button
            variant="outline"
            className="h-9 border-slate-700 bg-slate-950 text-slate-100 hover:bg-slate-800"
            onClick={() => historyRef.current?.scrollIntoView({ behavior: "smooth" })}
          >
            <History className="mr-2 h-4 w-4" />История
          </Button>
            <Select value={workstationMode} onValueChange={(v) => setWorkstationMode(v as WorkstationMode)}>
              <SelectTrigger className="h-9 w-full border-slate-700 bg-slate-950 text-slate-100 sm:w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Обычный режим</SelectItem>
                <SelectItem value="peak_harvest">Пик уборки</SelectItem>
                <SelectItem value="night_minimal">Ночной минимум</SelectItem>
              </SelectContent>
            </Select>
            {activeShift ? (
              <Button variant="outline" className="h-9 border-slate-700 bg-slate-950 text-slate-100 hover:bg-slate-800" onClick={closeShiftAction}>Закрыть смену</Button>
            ) : (
              <Button className="h-9" onClick={openShiftAction}>Открыть смену</Button>
            )}
            {activeShift ? (
              <Textarea
                value={shiftHandoverNote}
                onChange={(e) => setShiftHandoverNote(e.target.value)}
                placeholder="Комментарий к закрытию смены"
                rows={2}
                className="col-span-2 min-h-[52px] border-slate-700 bg-slate-950 text-slate-100 placeholder:text-slate-500 sm:w-[360px]"
              />
            ) : null}
        </div>
      </div>

      {!activeShift && canOperate ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            Действия весовой заблокированы: сначала откройте смену.
          </div>
        </div>
      ) : null}

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

            <div className={formSectionClass}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <Label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Сценарий движения</Label>
                  <div className="mt-1 text-sm text-slate-300">Сначала выберите, что происходит с товаром.</div>
                </div>
                <Badge className="border border-yellow-500/30 bg-yellow-500/10 text-yellow-100">{opMeta(form.operationType).title}</Badge>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {MOVEMENT_GROUPS.map((group) => {
                  const active = selectedMovementGroup === group.id;
                  return (
                    <Button
                      key={group.id}
                      type="button"
                      variant="outline"
                      className={
                        active
                          ? "h-auto min-h-[64px] justify-start rounded-xl border-yellow-500/70 bg-yellow-500/15 px-3 py-2 text-left text-yellow-50 hover:bg-yellow-500/20"
                          : "h-auto min-h-[64px] justify-start rounded-xl border-slate-800 bg-slate-950/60 px-3 py-2 text-left text-slate-200 hover:border-slate-700 hover:bg-slate-900 hover:text-slate-50"
                      }
                      onClick={() => selectOperation(GROUP_DEFAULT_OPERATION[group.id])}
                    >
                      <span className="min-w-0">
                        <span className="block whitespace-normal text-sm font-semibold leading-snug">{group.title}</span>
                        <span className={active ? "block text-[11px] text-yellow-200/80" : "block text-[11px] text-slate-500"}>{group.hint}</span>
                      </span>
                    </Button>
                  );
                })}
              </div>

              {selectedSubtypes.length > 1 ? (
              <div className="mt-3 space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Уточнение</Label>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                  {selectedSubtypes.map((subtype) => (
                    <Button
                      key={subtype.type}
                      type="button"
                      size="sm"
                      variant="outline"
                      className={`${segmentClass(form.operationType === subtype.type)} justify-start`}
                      onClick={() => selectOperation(subtype.type)}
                    >
                      {subtype.title}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
            </div>

            <div className={formSectionClass}>
              <div className="mb-3">
                <Label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Маршрут и документ</Label>
              </div>
            <div className="grid gap-3 md:grid-cols-2">
              {(form.operationType === "harvest_incoming" || isFieldIssue) ? (
                <div className="space-y-1">
                  <Label>Поле *</Label>
                  <Select value={form.fieldId} onValueChange={(v) => setForm((p) => ({ ...p, fieldId: v, cropStructureAllocationId: "", cropId: "", varietyId: "", reproductionId: "", stockIdentityKey: "", linkedOperationId: "", linkedOperationLineId: "" }))}>
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
            </div>

            {form.operationType === "harvest_incoming" ? (
              <div className={formSectionClass}>
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
                <div className="text-xs text-slate-400">
                  Партия: {selectedHarvestAllocation?.cropName || "—"} / {selectedHarvestAllocation?.varietyName || "—"} / {selectedHarvestAllocation?.reproductionName || "—"}
                </div>
              </div>
            ) : null}

            {form.operationType === "supplier_receipt" ? (
              <div className={formSectionClass}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <Label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Товары в поставке</Label>
                  <div className="text-xs text-slate-500">Один документ, несколько строк</div>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <Button type="button" size="sm" variant="outline" className={segmentClass(form.supplierReceiptMode === "weighbridge")} onClick={() => setForm((p) => ({ ...p, supplierReceiptMode: "weighbridge" }))}>Через весовую</Button>
                  <Button type="button" size="sm" variant="outline" className={segmentClass(form.supplierReceiptMode === "direct")} onClick={() => setForm((p) => ({ ...p, supplierReceiptMode: "direct", grossKg: "", driverId: "", vehicleId: "" }))}>По накладной</Button>
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <Button type="button" size="sm" variant="outline" className={segmentClass(form.supplierItemMode === "generic")} onClick={() => setForm((p) => ({ ...p, supplierItemMode: "generic", cropId: "", varietyId: "", reproductionId: "", supplierLot: "", harvestYear: "" }))}>Обычная поставка</Button>
                  <Button type="button" size="sm" variant="outline" className={segmentClass(form.supplierItemMode === "agro_identity")} onClick={() => setForm((p) => ({ ...p, supplierItemMode: "agro_identity", productId: "" }))}>Семена / Агро</Button>
                </div>
                {form.supplierItemMode === "generic" ? (
                  <div className="mt-3 space-y-3">
                    <div className="grid gap-2 rounded-xl border border-slate-800/80 bg-slate-950/45 p-3 md:grid-cols-5">
                      <div className="space-y-1 md:col-span-2">
                        <Label>Номенклатура *</Label>
                        <Select value={form.productId} onValueChange={(v) => setForm((p) => ({ ...p, productId: v, quantityUom: inferProductUnit(productById.get(v)) }))}>
                          <SelectTrigger className="h-8"><SelectValue placeholder="Выберите товар" /></SelectTrigger>
                          <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label>{form.supplierReceiptMode === "direct" || supplierReceiptUsesMultipleLines ? "Количество *" : "Количество"}</Label>
                        <Input className="h-8" value={form.quantityKg} onChange={(e) => setForm((p) => ({ ...p, quantityKg: e.target.value }))} placeholder={form.supplierReceiptMode === "weighbridge" && !supplierReceiptUsesMultipleLines ? "опц." : ""} />
                      </div>
                      <div className="space-y-1">
                        <Label>Ед. *</Label>
                        <Select value={form.quantityUom} onValueChange={(v) => setForm((p) => ({ ...p, quantityUom: v }))}>
                          <SelectTrigger className="h-8"><SelectValue placeholder="Ед." /></SelectTrigger>
                          <SelectContent>{["kg", "g", "l", "m", "roll", "pcs", "pack"].map((unit) => <SelectItem key={unit} value={unit}>{unitLabel(unit)}</SelectItem>)}</SelectContent>
                        </Select>
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
                            onValueChange={(v) => setSupplierReceiptLines((prev) => prev.map((item) => item.localId === line.localId ? { ...item, productId: v, uom: inferProductUnit(productById.get(v)) } : item))}
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
                          <Label>Ед. *</Label>
                          <Select value={line.uom} onValueChange={(v) => setSupplierReceiptLines((prev) => prev.map((item) => item.localId === line.localId ? { ...item, uom: v } : item))}>
                            <SelectTrigger className="h-8"><SelectValue placeholder="Ед." /></SelectTrigger>
                            <SelectContent>{["kg", "g", "l", "m", "roll", "pcs", "pack"].map((unit) => <SelectItem key={unit} value={unit}>{unitLabel(unit)}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label>Склад строки *</Label>
                          <Select value={line.warehouseToId || form.warehouseToId} onValueChange={(v) => setSupplierReceiptLines((prev) => prev.map((item) => item.localId === line.localId ? { ...item, warehouseToId: v } : item))}>
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
                      <Button type="button" size="sm" variant="outline" className="h-9 border-slate-700 bg-slate-950 text-slate-100 hover:bg-slate-900" onClick={() => setSupplierReceiptLines((prev) => [...prev, createSupplierReceiptLineDraft(form.warehouseToId)])}>
                        + Добавить строку
                      </Button>
                      {supplierReceiptGenericLineDrafts.length > 1 ? <div className="text-xs text-slate-400">Итого по строкам: {supplierReceiptGenericLineTotal.toLocaleString("ru-RU", { maximumFractionDigits: 3 })}</div> : null}
                    </div>
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
              <div className={formSectionClass}>
                <div className="grid gap-2 md:grid-cols-2">
                  <Button type="button" size="sm" variant="outline" className={segmentClass(form.fieldIssueMode === "weighbridge")} onClick={() => setForm((p) => ({ ...p, fieldIssueMode: "weighbridge", quantityKg: "" }))}>Через весовую</Button>
                  <Button type="button" size="sm" variant="outline" className={segmentClass(form.fieldIssueMode === "direct")} onClick={() => setForm((p) => ({ ...p, fieldIssueMode: "direct", grossKg: "", driverId: "", vehicleId: "" }))}>Ручная выдача</Button>
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-5">
                  {(Object.keys(fieldMaterialCategoryLabels) as FieldMaterialCategory[]).map((type) => (
                    <Button key={type} type="button" size="sm" variant="outline" className={segmentClass(form.fieldMaterialCategory === type)} onClick={() => setForm((p) => ({ ...p, fieldMaterialCategory: type, stockIdentityKey: "", productId: "", varietyId: "", reproductionId: "", quantityKg: "" }))}>
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

            {form.operationType === "supplier_receipt" && form.supplierReceiptMode === "direct" ? null : (
              <div className={formSectionClass}>
                <div className="mb-3">
                  <Label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Транспорт</Label>
                </div>
              <div className="grid gap-3 md:grid-cols-2">
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
              </div>
            )}

            {isWeighbridgeForm ? (
              <div className={formSectionClass}>
                <Label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Вес</Label>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>Брутто / вес (кг) *</Label>
                  <Input className="h-8" value={form.grossKg} onChange={(e) => setForm((p) => ({ ...p, grossKg: e.target.value }))} />
                </div>
                <div className="rounded-md border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-xs text-slate-300">
                  Тара указывается при закрытии талона. Нетто = брутто - тара.
                </div>
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
              <div className="sticky bottom-0 z-10 -mx-4 border-t border-slate-800 bg-[#101724]/95 px-4 pt-3 backdrop-blur">
                <Button className="h-11 w-full text-base font-semibold" onClick={create} disabled={submitting}>
                  {submitting ? "Создание..." : "Создать талон"}
                </Button>
                {loading ? <div className="mt-1 text-xs text-amber-300">Данные ещё загружаются. Повторите через пару секунд.</div> : null}
                {!loading && !activeShift && !isSupplierDirect ? <div className="mt-1 text-xs text-amber-300">Смена закрыта: откройте смену сверху.</div> : null}
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
              {(form.operationType === "harvest_incoming" || form.operationType === "issue_to_field") && <div className="space-y-2"><Label>Поле *</Label><Select value={form.fieldId} onValueChange={(v) => setForm((p) => ({ ...p, fieldId: v, cropStructureAllocationId: "", cropId: "", varietyId: "", reproductionId: "", linkedOperationId: "", linkedOperationLineId: "" }))}><SelectTrigger><SelectValue placeholder="Выберите поле" /></SelectTrigger><SelectContent>{fields.map((f) => <SelectItem key={f.id} value={f.id}>{f.name} • {f.area.toFixed(2)} га</SelectItem>)}</SelectContent></Select></div>}
              {form.operationType !== "harvest_incoming" && form.operationType !== "supplier_receipt" && <div className="space-y-2"><Label>Склад-источник *</Label><Select value={form.warehouseFromId} onValueChange={(v) => setForm((p) => ({ ...p, warehouseFromId: v, stockIdentityKey: "", productId: "", varietyId: "", reproductionId: "", quantityKg: "" }))}><SelectTrigger><SelectValue placeholder="Выберите склад" /></SelectTrigger><SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select></div>}
              {(form.operationType === "harvest_incoming" || form.operationType === "supplier_receipt" || form.operationType === "transfer_between_warehouses" || form.operationType === "drying") && <div className="space-y-2"><Label>{form.operationType === "drying" ? "Склад после сушки *" : "Склад назначения *"}</Label><Select value={form.warehouseToId} onValueChange={(v) => setForm((p) => ({ ...p, warehouseToId: v }))}><SelectTrigger><SelectValue placeholder="Выберите склад" /></SelectTrigger><SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select></div>}
              {form.operationType === "drying" && <div className="space-y-2"><Label>Точка сушки *</Label><Select value={form.processingPointId} onValueChange={(v) => setForm((p) => ({ ...p, processingPointId: v }))}><SelectTrigger><SelectValue placeholder="Выберите точку" /></SelectTrigger><SelectContent>{processingPoints.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent></Select></div>}
            </div>

            {form.operationType === "harvest_incoming" ? <div className="space-y-1.5">{fieldHarvestOptions.length > 1 ? <div className="space-y-1"><Label>Посевная строка *</Label><Select value={form.cropStructureAllocationId} onValueChange={(v) => setForm((p) => ({ ...p, cropStructureAllocationId: v }))}><SelectTrigger className="h-8"><SelectValue placeholder="Выберите строку структуры посевов" /></SelectTrigger><SelectContent>{fieldHarvestOptions.map((x) => <SelectItem key={x.allocationId} value={x.allocationId}>{x.cropName} / {x.varietyName} / {x.reproductionName} • {x.areaHa.toFixed(2)} га</SelectItem>)}</SelectContent></Select></div> : null}<div className="grid gap-2 md:grid-cols-3"><div className="space-y-1"><Label>Культура *</Label><Input className="h-8" value={selectedHarvestAllocation?.cropName || crops.find((c) => c.id === form.cropId)?.name || ""} readOnly placeholder="Авто из структуры посевов" /></div><div className="space-y-1"><Label>Сорт *</Label><Input className="h-8" value={selectedHarvestAllocation?.varietyName || ""} readOnly placeholder="Авто из структуры посевов" /></div><div className="space-y-1"><Label>Репродукция *</Label><Input className="h-8" value={selectedHarvestAllocation?.reproductionName || ""} readOnly placeholder="Авто из структуры посевов" /></div></div><div className="rounded-md border bg-slate-50 px-2 py-1.5 text-xs"><div className="text-slate-700">Партия: {(selectedHarvestAllocation?.cropName || crops.find((c) => c.id === form.cropId)?.name || "—")} / {(selectedHarvestAllocation?.varietyName || "—")} / {(selectedHarvestAllocation?.reproductionName || "—")}</div><div className="text-slate-600">Поле: {fields.find((f) => f.id === form.fieldId)?.name || "—"} • Склад: {warehouses.find((w) => w.id === form.warehouseToId)?.name || "—"}</div></div>{form.fieldId && harvestIncompleteFields[form.fieldId] ? <div className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">В структуре посевов для этого поля не указан сорт/репродукция.</div> : null}{form.fieldId && fieldHarvestOptions.length === 0 && !harvestIncompleteFields[form.fieldId] ? <div className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">Для этого поля нет структуры посевов в активном сезоне.</div> : null}</div> : form.operationType === "supplier_receipt" ? (
              <div className="space-y-2">
                {form.supplierItemMode === "generic" ? (
                  <div className="space-y-2">
                    <div className="grid gap-2 md:grid-cols-5">
                      <div className="space-y-1"><Label>Номенклатура *</Label><Select value={form.productId} onValueChange={(v) => setForm((p) => ({ ...p, productId: v, quantityUom: inferProductUnit(productById.get(v)) }))}><SelectTrigger className="h-8"><SelectValue placeholder="Удобрения, СЗР, ГСМ..." /></SelectTrigger><SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></div>
                      <div className="space-y-1"><Label>{form.supplierReceiptMode === "direct" || supplierReceiptUsesMultipleLines ? "Количество *" : "Количество"}</Label><Input className="h-8" value={form.quantityKg} onChange={(e) => setForm((p) => ({ ...p, quantityKg: e.target.value }))} placeholder={form.supplierReceiptMode === "weighbridge" && !supplierReceiptUsesMultipleLines ? "опц. для нескольких строк" : ""} /></div>
                      <div className="space-y-1"><Label>Ед. *</Label><Select value={form.quantityUom} onValueChange={(v) => setForm((p) => ({ ...p, quantityUom: v }))}><SelectTrigger className="h-8"><SelectValue placeholder="Ед." /></SelectTrigger><SelectContent>{["kg","g","l","ml","pcs"].map((unit) => <SelectItem key={unit} value={unit}>{unitLabel(unit)}</SelectItem>)}</SelectContent></Select></div>
                      <div className="space-y-1"><Label>Склад строки *</Label><Select value={form.warehouseToId} onValueChange={(v) => setForm((p) => ({ ...p, warehouseToId: v }))}><SelectTrigger className="h-8"><SelectValue placeholder="Склад" /></SelectTrigger><SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select></div>
                    </div>
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-0 text-xs text-slate-300" onClick={() => setShowSupplierExtraFields((v) => !v)}>
                      {showSupplierExtraFields ? "Скрыть дополнительные данные" : "Показать номер партии / цену"}
                    </Button>
                    {showSupplierExtraFields ? <div className="grid gap-2 md:grid-cols-2"><div className="space-y-1"><Label>Партия / номер партии</Label><Input className="h-8" value={form.supplierLot} onChange={(e) => setForm((p) => ({ ...p, supplierLot: e.target.value }))} placeholder="необязательно" /></div><div className="space-y-1"><Label>Цена</Label><Input className="h-8" value={form.unitPrice} onChange={(e) => setForm((p) => ({ ...p, unitPrice: e.target.value }))} placeholder="необязательно" /></div></div> : null}
                    {supplierReceiptLines.map((line) => (
                      <div key={line.localId} className="grid gap-2 rounded-md border border-slate-700 bg-slate-950/40 p-2 md:grid-cols-[1fr_110px_90px_160px_auto]">
                        <div className="space-y-1">
                          <Label>Номенклатура *</Label>
                          <Select
                            value={line.productId}
                            onValueChange={(v) => setSupplierReceiptLines((prev) => prev.map((item) => item.localId === line.localId ? { ...item, productId: v, uom: inferProductUnit(productById.get(v)) } : item))}
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
                          <Label>Ед. *</Label>
                          <Select value={line.uom} onValueChange={(v) => setSupplierReceiptLines((prev) => prev.map((item) => item.localId === line.localId ? { ...item, uom: v } : item))}>
                            <SelectTrigger className="h-8"><SelectValue placeholder="Ед." /></SelectTrigger>
                            <SelectContent>{["kg","g","l","m","roll","pcs","pack"].map((unit) => <SelectItem key={unit} value={unit}>{unitLabel(unit)}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label>Склад *</Label>
                          <Select value={line.warehouseToId || form.warehouseToId} onValueChange={(v) => setSupplierReceiptLines((prev) => prev.map((item) => item.localId === line.localId ? { ...item, warehouseToId: v } : item))}>
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
                      <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => setSupplierReceiptLines((prev) => [...prev, createSupplierReceiptLineDraft(form.warehouseToId)])}>
                        + Добавить строку поставки
                      </Button>
                      {supplierReceiptGenericLineDrafts.length > 1 ? <div className="text-xs text-slate-400">Итого по строкам: {supplierReceiptGenericLineTotal.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} кг</div> : null}
                    </div>
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

                <div className="grid gap-2 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Связанная операция (опционально)</Label>
                    <Select
                      value={form.linkedOperationId}
                      onValueChange={(value) =>
                        setForm((prev) => ({
                          ...prev,
                          linkedOperationId: value,
                          linkedOperationLineId: "",
                        }))
                      }
                      disabled={!form.fieldId || linkedOperationsForField.length === 0}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue
                          placeholder={
                            !form.fieldId
                              ? "Сначала выберите поле"
                              : linkedOperationsForField.length === 0
                                ? "По полю нет открытых операций"
                                : "Выберите операцию"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {linkedOperationsForField.length === 0 ? (
                          <SelectItem value="__empty_operation" disabled>
                            Операции не найдены
                          </SelectItem>
                        ) : null}
                        {linkedOperationsForField.map((operation) => (
                          <SelectItem key={operation.id} value={operation.id}>
                            {operation.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {form.linkedOperationId ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-slate-600"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            linkedOperationId: "",
                            linkedOperationLineId: "",
                          }))
                        }
                      >
                        Сбросить связь с операцией
                      </Button>
                    ) : null}
                  </div>

                  <div className="space-y-1">
                    <Label>Строка операции (опционально)</Label>
                    <Select
                      value={form.linkedOperationLineId}
                      onValueChange={(value) =>
                        setForm((prev) => ({
                          ...prev,
                          linkedOperationLineId: value,
                        }))
                      }
                      disabled={!form.linkedOperationId || linkedOperationLinesLoading || linkedOperationLineOptions.length === 0}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue
                          placeholder={
                            !form.linkedOperationId
                              ? "Сначала выберите операцию"
                              : linkedOperationLinesLoading
                                ? "Загрузка строк операции..."
                                : linkedOperationLineOptions.length === 0
                                  ? "В операции нет строк"
                                  : "Выберите строку операции"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {linkedOperationLineOptions.length === 0 ? (
                          <SelectItem value="__empty_operation_line" disabled>
                            Строки операции не найдены
                          </SelectItem>
                        ) : null}
                        {linkedOperationLineOptions.map((line) => (
                          <SelectItem key={line.id} value={line.id}>
                            {line.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {form.linkedOperationLineId ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-slate-600"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            linkedOperationLineId: "",
                          }))
                        }
                      >
                        Сбросить строку операции
                      </Button>
                    ) : null}
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
                    <div className="rounded-md border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-xs text-slate-300">
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

            {form.operationType === "harvest_incoming" || (form.operationType === "supplier_receipt" && form.supplierReceiptMode === "weighbridge") || (form.operationType === "transfer_between_warehouses" && form.transferMode === "weighbridge") || (form.operationType === "issue_to_field" && form.fieldIssueMode === "weighbridge") ? <div className="grid gap-2 md:grid-cols-2"><div className="space-y-1"><Label>Брутто (кг) *</Label><Input className="h-8" value={form.grossKg} onChange={(e) => setForm((p) => ({ ...p, grossKg: e.target.value }))} /></div><div className="rounded-md border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-xs"><div className="font-medium text-slate-200">Тара указывается только при закрытии талона</div><div className="mt-1 text-slate-400">Формула: нетто = брутто - тара</div></div></div> : null}
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
                {!loading && !activeShift && !isSupplierDirect ? <div className="text-xs text-amber-700">Смена закрыта: откройте смену сверху, затем создайте талон.</div> : null}
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
            {loading ? <div className="text-sm text-slate-400">Загрузка...</div> : activeTickets.length === 0 ? <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/45 p-6 text-center text-sm text-slate-500">Открытых талонов нет</div> : [...activeTickets].sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()).map((t) => {
              const vehicleName = vehicles.find((v) => v.id === t.vehicle_id)?.name || "Транспорт";
              const driverName = drivers.find((d) => d.id === t.driver_id)?.name || "Без водителя";
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
                <SelectContent><SelectItem value="all">Все типы</SelectItem>{historyTypes.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 px-3 py-3 sm:px-4">
            {loading ? <div className="text-sm text-slate-400">Загрузка...</div> : null}
            {!loading && historyTickets.length === 0 ? <div className="rounded-lg border border-dashed border-slate-800 p-6 text-center text-sm text-slate-500">Закрытых талонов пока нет</div> : null}
            {!loading && historyTickets.slice(0, 80).map((t) => {
              const vehicleName = vehicles.find((v) => v.id === t.vehicle_id)?.name || "Транспорт";
              const driverName = drivers.find((d) => d.id === t.driver_id)?.name || "Без водителя";
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
              <SheetHeader>
                <SheetTitle>Талон {activeTicket.ticket_no}</SheetTitle>
                <SheetDescription>{operationUiLabel(activeTicket.op_type)}</SheetDescription>
              </SheetHeader>

              <div className="mx-auto w-full max-w-[540px] min-h-[960px] rounded-md border bg-[#f7f1e3] p-4 text-[#1f1b16]" style={{ boxShadow: "inset 0 0 40px rgba(80,56,30,0.08)" }}>
                <div className="mb-3 border-b border-[#b8a788] pb-2 text-center">
                  <div className="text-sm font-semibold tracking-wide">{ticketCompanyLabel(activeTicket)}</div>
                  <div className="mt-1 text-3xl font-black">ВЕСОВОЙ ТАЛОН</div>
                  <div className="mt-1 text-lg font-bold">№ {activeTicket.ticket_no}</div>
                </div>

                <div className="mb-3 grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-[#5d4f3d]">Тип операции:</span> <span className="font-bold">{operationUiLabel(activeTicket.op_type)}</span></div>
                  {isDirectSupplierTicket(activeTicket) ? <div><span className="text-[#5d4f3d]">Контрагент:</span> <span className="font-semibold">{supplierName(activeTicket)}</span></div> : <div><span className="text-[#5d4f3d]">{isHarvestTicket(activeTicket) ? "Поле:" : "Контекст:"}</span> <span className="font-semibold">{isHarvestTicket(activeTicket) ? fields.find((f) => f.id === activeTicket.field_id)?.name || "-" : ticketRouteSummary(activeTicket)}</span></div>}
                  {isDirectSupplierTicket(activeTicket) ? <div><span className="text-[#5d4f3d]">Склад назначения:</span> <span className="font-semibold">{warehouseName(activeTicket.warehouse_to_id)}</span></div> : <div><span className="text-[#5d4f3d]">Склад:</span> <span className="font-semibold">{warehouses.find((w) => w.id === activeTicket.warehouse_to_id)?.name || warehouses.find((w) => w.id === activeTicket.warehouse_from_id)?.name || "-"}</span></div>}
                  {isHarvestTicket(activeTicket) ? <div><span className="text-[#5d4f3d]">Культура:</span> <span className="font-semibold">{activeLine?.product_name || "-"}</span></div> : (activeTicket.lines || []).length === 0 ? <div><span className="text-[#5d4f3d]">Товары:</span> <span className="font-semibold">{productSummary(activeTicket)}</span></div> : null}
                  {isHarvestTicket(activeTicket) ? <div><span className="text-[#5d4f3d]">Сорт:</span> <span className="font-semibold">{activeLine?.variety_name || varieties.find((v) => v.id === activeLine?.variety_id)?.name || "-"}</span></div> : null}
                  {isHarvestTicket(activeTicket) ? <div><span className="text-[#5d4f3d]">Посевная строка:</span> <span className="font-semibold">{ticketAllocationLabel(activeTicket)}</span></div> : null}
                  {isHarvestTicket(activeTicket) ? <div><span className="text-[#5d4f3d]">Репродукция:</span> <span className="font-semibold">{activeLine?.reproduction_name || reproductions.find((r) => r.id === activeLine?.reproduction_id)?.name || "-"}</span></div> : null}
                </div>

                {!isDirectSupplierTicket(activeTicket) ? <div className="mb-3 rounded border border-[#b8a788] p-3 text-sm">
                  <div className="mb-2 text-center text-lg font-bold">ТРАНСПОРТ И ВОДИТЕЛЬ</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><span className="text-[#5d4f3d]">Машина:</span> <span className="font-bold">{activeVehicle?.name || "-"}</span></div>
                    <div><span className="text-[#5d4f3d]">Водитель:</span> <span className="font-bold">{activeDriver?.name || "-"}</span></div>
                    <div><span className="text-[#5d4f3d]">Госномер:</span> <span className="font-semibold">{activeVehicle?.plate || "-"}</span></div>
                    <div />
                  </div>
                </div> : null}

                {!isDirectSupplierTicket(activeTicket) ? <div className="mb-3 rounded border border-[#b8a788] p-3 text-sm">
                  <div className="mb-2 text-center text-lg font-bold">ВЕСОВЫЕ ДАННЫЕ</div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div><div className="text-xs text-[#5d4f3d]">Брутто</div><div className="text-xl font-bold">{activeTicket.gross_weight_kg ?? "-"} кг</div></div>
                    <div><div className="text-xs text-[#5d4f3d]">Тара</div><div className="text-xl font-bold">{activeTicket.tare_weight_kg ?? "-"} кг</div></div>
                    <div><div className="text-xs text-[#5d4f3d]">Нетто</div><div className="text-xl font-bold">{activeTicket.net_weight_kg ?? "-"} кг</div></div>
                  </div>
                </div> : null}

                {(activeTicket.lines || []).length > 0 ? (
                  <div className="mb-3 rounded border border-[#b8a788] p-2 text-xs">
                    <div className="mb-2 text-center text-base font-bold">Товары в документе</div>
                    <div className="space-y-1">
                      {(activeTicket.lines || []).map((line: any, index: number) => (
                        <div key={line.id || index} className="grid grid-cols-[22px_1fr_auto] gap-2 border-b border-[#c7b797] pb-1 last:border-0 last:pb-0">
                          <div className="font-bold">{index + 1}.</div>
                          <div>
                            <div className="font-semibold">{line.product_name || "-"}</div>
                            <div className="text-[#5d4f3d]">{lineWarehouseName(line, activeTicket)}{line.lot_id ? ` • партия ${lotLabel(line.lot_id)}` : ""}</div>
                          </div>
                          <div className="text-right font-bold">{formatQuantityWithUnit(line.quantity, line.uom)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="text-sm">
                  <div><span className="text-[#5d4f3d]">Статус:</span> <span className="font-semibold">{statusLabel(activeTicket.status)}</span></div>
                  <div><span className="text-[#5d4f3d]">{isDirectSupplierTicket(activeTicket) ? "Дата документа:" : "Время взвешивания:"}</span> <span className="font-semibold">{fmt(activeTicket.finalized_at || activeTicket.updated_at || activeTicket.created_at, lang)}</span></div>
                  <div><span className="text-[#5d4f3d]">Создан:</span> <span className="font-semibold">{fmt(activeTicket.created_at, lang)}</span></div>
                  <div><span className="text-[#5d4f3d]">Весовщик:</span> <span className="font-semibold">{profile?.full_name?.trim() || profile?.email || "-"}</span></div>
                  <div><span className="text-[#5d4f3d]">Примечание:</span> <span className="font-semibold">{activeTicket.notes || "-"}</span></div>
                  <div><span className="text-[#5d4f3d]">ID:</span> <span className="font-semibold">{activeTicket.id}</span></div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
                <div className="space-y-2">
                  <Label>Брутто (кг)</Label>
                  <Input value={gross} readOnly className="border-slate-700 bg-slate-950 font-semibold text-slate-100" />
                </div>
                <div className="mt-3 space-y-2">
                  <Label>Тара (кг)</Label>
                  <Input ref={tareInputRef} value={closingTare} onChange={(e) => setClosingTare(e.target.value)} />
                </div>
                <div className="mt-3 rounded-md border border-slate-700 bg-slate-950 p-3 text-sm text-slate-100">
                  <div className="flex items-center justify-between"><span>Брутто</span><span>{gross || "-"}</span></div>
                  <div className="flex items-center justify-between"><span>Тара</span><span>{closingTare || "-"}</span></div>
                  <div className="my-2 border-t border-slate-700" />
                  <div className="flex items-center justify-between font-semibold"><span>Чистый вес (нетто)</span><span>{pure == null ? "-" : pure.toFixed(3)}</span></div>
                  <div className="mt-2 text-xs text-slate-400">Формула: net = gross - tare</div>
                  {pure != null && pure <= 0 ? <div className="mt-2 text-xs text-red-300">Ошибка: тара не может быть больше или равна брутто</div> : null}
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
              <SheetHeader>
                <SheetTitle>Талон {historyPreviewTicket.ticket_no}</SheetTitle>
                <SheetDescription>{operationUiLabel(historyPreviewTicket.op_type)}</SheetDescription>
              </SheetHeader>
              <div className="mx-auto w-full max-w-[540px] min-h-[960px] rounded-md border bg-[#f7f1e3] p-4 text-[#1f1b16]" style={{ boxShadow: "inset 0 0 40px rgba(80,56,30,0.08)" }}>
                <div className="mb-3 border-b border-[#b8a788] pb-2 text-center">
                  <div className="text-sm font-semibold tracking-wide">{ticketCompanyLabel(historyPreviewTicket)}</div>
                  <div className="mt-1 text-3xl font-black">ВЕСОВОЙ ТАЛОН</div>
                  <div className="mt-1 text-lg font-bold">№ {historyPreviewTicket.ticket_no}</div>
                </div>
                <div className="mb-3 grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-[#5d4f3d]">Статус:</span> <span className="font-bold">{statusLabel(historyPreviewTicket.status).toUpperCase()}</span></div>
                  <div><span className="text-[#5d4f3d]">Тип операции:</span> <span className="font-bold">{operationUiLabel(historyPreviewTicket.op_type)}</span></div>
                  {isDirectSupplierTicket(historyPreviewTicket) ? <div><span className="text-[#5d4f3d]">Контрагент:</span> <span className="font-semibold">{supplierName(historyPreviewTicket)}</span></div> : <div><span className="text-[#5d4f3d]">{isHarvestTicket(historyPreviewTicket) ? "Поле:" : "Контекст:"}</span> <span className="font-semibold">{isHarvestTicket(historyPreviewTicket) ? fields.find((f) => f.id === historyPreviewTicket.field_id)?.name || "-" : ticketRouteSummary(historyPreviewTicket)}</span></div>}
                  {isDirectSupplierTicket(historyPreviewTicket) ? <div><span className="text-[#5d4f3d]">Склад назначения:</span> <span className="font-semibold">{warehouseName(historyPreviewTicket.warehouse_to_id)}</span></div> : <div><span className="text-[#5d4f3d]">Склад:</span> <span className="font-semibold">{warehouses.find((w) => w.id === historyPreviewTicket.warehouse_to_id)?.name || warehouses.find((w) => w.id === historyPreviewTicket.warehouse_from_id)?.name || "-"}</span></div>}
                  {isHarvestTicket(historyPreviewTicket) ? <div><span className="text-[#5d4f3d]">Культура:</span> <span className="font-semibold">{historyPreviewTicket.lines?.[0]?.product_name || "-"}</span></div> : (historyPreviewTicket.lines || []).length === 0 ? <div><span className="text-[#5d4f3d]">Товары:</span> <span className="font-semibold">{productSummary(historyPreviewTicket)}</span></div> : null}
                  {isHarvestTicket(historyPreviewTicket) ? <div><span className="text-[#5d4f3d]">Посевная строка:</span> <span className="font-semibold">{ticketAllocationLabel(historyPreviewTicket)}</span></div> : null}
                  {isHarvestTicket(historyPreviewTicket) ? <div><span className="text-[#5d4f3d]">Сорт:</span> <span className="font-semibold">{historyPreviewTicket.lines?.[0]?.variety_name || varieties.find((v) => v.id === historyPreviewTicket.lines?.[0]?.variety_id)?.name || "-"}</span></div> : null}
                  {isHarvestTicket(historyPreviewTicket) ? <div><span className="text-[#5d4f3d]">Репродукция:</span> <span className="font-semibold">{historyPreviewTicket.lines?.[0]?.reproduction_name || reproductions.find((r) => r.id === historyPreviewTicket.lines?.[0]?.reproduction_id)?.name || "-"}</span></div> : null}
                </div>
                {!isDirectSupplierTicket(historyPreviewTicket) ? <div className="mb-3 rounded border border-[#b8a788] p-3 text-sm">
                  <div className="mb-2 text-center text-lg font-bold">ТРАНСПОРТ И ВОДИТЕЛЬ</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><span className="text-[#5d4f3d]">Машина:</span> <span className="font-bold">{vehicles.find((v) => v.id === historyPreviewTicket.vehicle_id)?.name || "-"}</span></div>
                    <div><span className="text-[#5d4f3d]">Водитель:</span> <span className="font-bold">{drivers.find((d) => d.id === historyPreviewTicket.driver_id)?.name || "-"}</span></div>
                    <div><span className="text-[#5d4f3d]">Госномер:</span> <span className="font-semibold">{vehicles.find((v) => v.id === historyPreviewTicket.vehicle_id)?.plate || "-"}</span></div>
                    <div />
                  </div>
                </div> : null}
                {!isDirectSupplierTicket(historyPreviewTicket) ? <div className="mb-3 rounded border border-[#b8a788] p-2 text-sm">
                  <div className="mb-2 text-center text-lg font-bold">ВЕСОВЫЕ ДАННЫЕ</div>
                  <div className="grid grid-cols-3 gap-2">
                    <div><div className="text-xs text-[#5d4f3d]">Брутто</div><div className="text-xl font-bold">{historyPreviewTicket.gross_weight_kg ?? "-"} кг</div></div>
                    <div><div className="text-xs text-[#5d4f3d]">Тара</div><div className="text-xl font-bold">{historyPreviewTicket.tare_weight_kg ?? "-"} кг</div></div>
                    <div><div className="text-xs text-[#5d4f3d]">Нетто</div><div className="text-xl font-bold">{historyPreviewTicket.net_weight_kg ?? "-"} кг</div></div>
                  </div>
                </div> : null}
                {(historyPreviewTicket.lines || []).length > 0 ? (
                  <div className="mb-3 rounded border border-[#b8a788] p-2 text-xs">
                    <div className="mb-2 text-center text-base font-bold">Товары в документе</div>
                    <div className="space-y-1">
                      {(historyPreviewTicket.lines || []).map((line: any, index: number) => (
                        <div key={line.id || index} className="grid grid-cols-[22px_1fr_auto] gap-2 border-b border-[#c7b797] pb-1 last:border-0 last:pb-0">
                          <div className="font-bold">{index + 1}.</div>
                          <div>
                            <div className="font-semibold">{line.product_name || "-"}</div>
                            <div className="text-[#5d4f3d]">{lineWarehouseName(line, historyPreviewTicket)}{line.lot_id ? ` • партия ${lotLabel(line.lot_id)}` : ""}{line.unit_price ? ` • цена ${Number(line.unit_price).toLocaleString("ru-RU")}` : ""}</div>
                          </div>
                          <div className="text-right font-bold">{formatQuantityWithUnit(line.quantity, line.uom)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="text-sm">
                  <div><span className="text-[#5d4f3d]">{isDirectSupplierTicket(historyPreviewTicket) ? "Дата документа:" : "Время взвешивания:"}</span> <span className="font-semibold">{fmt(historyPreviewTicket.finalized_at || historyPreviewTicket.updated_at || historyPreviewTicket.created_at, lang)}</span></div>
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
