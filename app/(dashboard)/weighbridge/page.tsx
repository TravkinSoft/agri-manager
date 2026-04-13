"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Clock3, FileDown, History, Scale, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/lib/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/contexts/language-context";
import { localizedName } from "@/lib/i18n/helpers";
import { supabase } from "@/lib/supabase/client";
import { createTicket, downloadTicketPdf, finalizeTicket, listTickets, patchTicket, voidTicket } from "@/lib/services/weighbridge";
import type { TicketDirection, TicketInput, TicketLineInput, WeighbridgeTicket } from "@/lib/types/weighbridge";

type Lang = "ru" | "kz" | "en";
type OperationType = "harvest_incoming" | "issue_to_field" | "transfer_between_warehouses" | "disposal_writeoff" | "drying";
type Option = { id: string; name: string };

type FormState = {
  operationType: OperationType;
  fieldId: string;
  warehouseFromId: string;
  warehouseToId: string;
  processingPointId: string;
  cropId: string;
  varietyId: string;
  reproductionId: string;
  productId: string;
  quantityKg: string;
  dryingOutputKg: string;
  moistureIn: string;
  moistureOut: string;
  grossKg: string;
  vehicleId: string;
  driverId: string;
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
  productId: "",
  quantityKg: "",
  dryingOutputKg: "",
  moistureIn: "",
  moistureOut: "",
  grossKg: "",
  vehicleId: "",
  driverId: "",
  disposalReason: "",
  notes: "",
};

const opMeta = (type: OperationType) => {
  if (type === "harvest_incoming") return { title: "Урожай (приход)", ticketType: "harvest", opType: "harvest_incoming", direction: "incoming" as TicketDirection, sourceKind: "field", destinationKind: "warehouse" };
  if (type === "issue_to_field") return { title: "Со склада в поле", ticketType: "issue", opType: "issue_to_field", direction: "outgoing" as TicketDirection, sourceKind: "warehouse", destinationKind: "field" };
  if (type === "transfer_between_warehouses") return { title: "Межскладское перемещение", ticketType: "transfer", opType: "warehouse_transfer", direction: "transfer" as TicketDirection, sourceKind: "warehouse", destinationKind: "warehouse" };
  if (type === "disposal_writeoff") return { title: "Утилизация / списание", ticketType: "disposal", opType: "disposal", direction: "outgoing" as TicketDirection, sourceKind: "warehouse", destinationKind: "disposal" };
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

const statusClass = (status: string) => (status === "finalized" ? "bg-emerald-100 text-emerald-800" : status === "voided" ? "bg-slate-200 text-slate-700" : "bg-amber-100 text-amber-800");
const toNum = (value: string) => (value.trim() && Number.isFinite(Number(value)) ? Number(value) : null);
const net = (gross: string, tare: string) => {
  const g = toNum(gross);
  const t = toNum(tare);
  if (g == null || t == null) return null;
  return g - t;
};
const getLang = (language: string): Lang => (language === "kz" || language === "en" ? language : "ru");
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
  const [vehicles, setVehicles] = useState<{ id: string; name: string; plate: string }[]>([]);
  const [processingPoints, setProcessingPoints] = useState<Option[]>([]);
  const [products, setProducts] = useState<Option[]>([]);
  const [crops, setCrops] = useState<Option[]>([]);
  const [varieties, setVarieties] = useState<{ id: string; name: string; cropId: string }[]>([]);
  const [reproductions, setReproductions] = useState<Option[]>([]);
  const [drivers, setDrivers] = useState<{ id: string; name: string; machineId: string | null }[]>([]);
  const [activeTicket, setActiveTicket] = useState<WeighbridgeTicket | null>(null);
  const [closingTare, setClosingTare] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [historyTypeFilter, setHistoryTypeFilter] = useState("all");
  const historyRef = useRef<HTMLDivElement | null>(null);

  const canOperate =
    profile?.role === "admin" ||
    profile?.role === "company_admin" ||
    profile?.role === "global_admin" ||
    profile?.role === "warehouse" ||
    profile?.role === "weighman";
  const canView = canOperate || profile?.role === "agronomist";
  const canVoid = profile?.role === "admin" || profile?.role === "company_admin" || profile?.role === "global_admin";

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

  const load = async () => {
    if (!profile?.company_id || !profile?.id || !canView) return;
    setLoading(true);
    try {
      const [fieldsRes, warehousesRes, vehiclesRes, processingRes, productsRes, cropsRes, varietiesRes, reprRes, driverRows, ticketRows] = await Promise.all([
        supabase.from("fields").select("id,name,area").eq("company_id", profile.company_id).eq("archived", false).order("name"),
        supabase.from("warehouses").select("id,name,name_ru,name_kz,name_en").eq("company_id", profile.company_id).eq("archived", false).order("name"),
        supabase.from("reference_vehicles").select("id,name,plate_number,is_active,archived").eq("company_id", profile.company_id).eq("is_active", true).eq("archived", false).order("name"),
        supabase.from("processing_points").select("id,name").eq("company_id", profile.company_id).eq("archived", false).order("name"),
        supabase.from("products").select("id,name,name_ru,name_kz,name_en").eq("company_id", profile.company_id).eq("archived", false).order("name"),
        supabase.from("crops").select("id,name,name_ru,name_kz,name_en").eq("company_id", profile.company_id).eq("archived", false).order("name"),
        supabase.from("varieties").select("id,name,crop_id").eq("company_id", profile.company_id).eq("archived", false).order("name"),
        supabase.from("seed_reproductions").select("id,name").eq("company_id", profile.company_id).eq("archived", false).order("name"),
        loadDrivers(profile.company_id),
        listTickets(profile.company_id, profile.id),
      ]);
      if (fieldsRes.error || warehousesRes.error || vehiclesRes.error || processingRes.error || productsRes.error || cropsRes.error || varietiesRes.error || reprRes.error) {
        throw new Error(fieldsRes.error?.message || warehousesRes.error?.message || vehiclesRes.error?.message || processingRes.error?.message || productsRes.error?.message || cropsRes.error?.message || varietiesRes.error?.message || reprRes.error?.message || "Не удалось загрузить данные");
      }
      setFields((fieldsRes.data || []).map((r: any) => ({ id: String(r.id), name: String(r.name || "Поле"), area: Number(r.area || 0) })));
      setWarehouses((warehousesRes.data || []).map((r: any) => ({ id: String(r.id), name: localizedName(r, lang, ["name"]) || String(r.name || "Склад") })));
      setVehicles((vehiclesRes.data || []).map((r: any) => ({ id: String(r.id), name: String(r.name || "Машина"), plate: String(r.plate_number || "") })));
      setProcessingPoints((processingRes.data || []).map((r: any) => ({ id: String(r.id), name: String(r.name || "Точка") })));
      setProducts((productsRes.data || []).map((r: any) => ({ id: String(r.id), name: localizedName(r, lang, ["name"]) || String(r.name || "Номенклатура") })));
      setCrops((cropsRes.data || []).map((r: any) => ({ id: String(r.id), name: localizedName(r, lang, ["name"]) || String(r.name || "Культура") })));
      setVarieties((varietiesRes.data || []).map((r: any) => ({ id: String(r.id), name: String(r.name || "Сорт"), cropId: String(r.crop_id || "") })));
      setReproductions((reprRes.data || []).map((r: any) => ({ id: String(r.id), name: String(r.name || "Репродукция") })));
      setDrivers(driverRows);
      setTickets(ticketRows || []);
    } catch (e: any) {
      toast({ title: "Ошибка", description: e?.message || "Не удалось загрузить весовую", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [profile?.company_id, profile?.id, profile?.role, language]);

  useEffect(() => {
    if (!activeTicket) return;
    setClosingTare(activeTicket.tare_weight_kg != null ? String(activeTicket.tare_weight_kg) : "");
    setVoidReason("");
  }, [activeTicket?.id]);

  useEffect(() => {
    if (!form.driverId) return;
    const driver = drivers.find((d) => d.id === form.driverId);
    if (driver?.machineId && vehicles.some((v) => v.id === driver.machineId)) {
      setForm((prev) => ({ ...prev, vehicleId: driver.machineId || prev.vehicleId }));
    }
  }, [form.driverId, drivers, vehicles]);

  const activeTickets = useMemo(() => tickets.filter((t) => ["draft", "active", "ready_to_close"].includes(t.status)), [tickets]);
  const historyTypes = useMemo(() => Array.from(new Set(tickets.map((t) => t.op_type).filter(Boolean))), [tickets]);
  const historyTickets = useMemo(() => tickets.filter((t) => ["finalized", "voided"].includes(t.status) && (historyTypeFilter === "all" || t.op_type === historyTypeFilter)), [tickets, historyTypeFilter]);
  const filteredVarieties = useMemo(() => (form.cropId ? varieties.filter((v) => v.cropId === form.cropId) : []), [varieties, form.cropId]);
  const gross = activeTicket?.gross_weight_kg != null ? String(activeTicket.gross_weight_kg) : "";
  const pure = net(gross, closingTare);

  const validate = () => {
    if (!profile?.company_id || !profile?.id) return "Нет профиля пользователя";
    if (!form.driverId) return "Выберите водителя";
    if (!form.vehicleId) return "Выберите машину";
    if (form.operationType === "harvest_incoming") {
      if (!form.fieldId || !form.warehouseToId || !form.cropId) return "Заполните поле, культуру и склад назначения";
      if (!toNum(form.grossKg) || Number(form.grossKg) <= 0) return "Укажите брутто";
    } else {
      if (!form.productId || !toNum(form.quantityKg) || Number(form.quantityKg) <= 0) return "Заполните номенклатуру и количество";
    }
    if (form.operationType === "issue_to_field" && (!form.warehouseFromId || !form.fieldId)) return "Для отпуска нужны склад-источник и поле";
    if (form.operationType === "transfer_between_warehouses" && (!form.warehouseFromId || !form.warehouseToId || form.warehouseFromId === form.warehouseToId)) return "Проверьте склады перемещения";
    if (form.operationType === "disposal_writeoff" && (!form.warehouseFromId || !form.disposalReason.trim())) return "Для списания укажите склад и причину";
    if (form.operationType === "drying" && (!form.warehouseFromId || !form.warehouseToId || !form.processingPointId || !toNum(form.dryingOutputKg))) return "Для сушки заполните все обязательные поля";
    return null;
  };

  const create = async () => {
    if (!canOperate || submitting) return;
    const validationError = validate();
    if (validationError) {
      toast({ title: "Проверьте форму", description: validationError, variant: "destructive" });
      return;
    }
    if (!window.confirm("Создать талон?")) return;
    if (!profile?.company_id || !profile?.id) return;

    const meta = opMeta(form.operationType);
    const cropName = crops.find((c) => c.id === form.cropId)?.name?.toLowerCase().trim() || "";
    const harvestProduct = products.find((p) => p.name.toLowerCase().trim() === cropName) || products.find((p) => p.name.toLowerCase().includes(cropName));
    const productId = form.operationType === "harvest_incoming" ? harvestProduct?.id : form.productId;
    if (!productId) {
      toast({ title: "Ошибка", description: "Не найдена номенклатура для выбранной культуры", variant: "destructive" });
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
      source_id: form.operationType === "harvest_incoming" ? form.fieldId : form.warehouseFromId || null,
      destination_id: form.operationType === "harvest_incoming" ? form.warehouseToId : form.operationType === "issue_to_field" ? form.fieldId : form.operationType === "drying" ? form.processingPointId : form.warehouseToId || null,
      field_id: form.fieldId || null,
      warehouse_from_id: form.warehouseFromId || null,
      warehouse_to_id: form.warehouseToId || null,
      processing_point_from_id: form.operationType === "drying" ? form.processingPointId || null : null,
      vehicle_id: form.vehicleId,
      driver_id: form.driverId || null,
      gross_weight_kg: toNum(form.grossKg),
      tare_weight_kg: null,
      weigh_method: "preset_tare",
      notes: [form.operationType === "disposal_writeoff" && form.disposalReason.trim() ? `Причина списания: ${form.disposalReason.trim()}` : "", form.notes.trim()].filter(Boolean).join("\n") || null,
    };

    const line: TicketLineInput = {
      product_id: productId,
      quantity: form.operationType === "harvest_incoming" ? Number(form.grossKg) : Number(form.quantityKg),
      uom: "kg",
      notes: form.operationType === "harvest_incoming" ? "Приемка урожая" : undefined,
      variety_id: form.varietyId || null,
      reproduction_id: form.reproductionId || null,
      moisture_percent: form.operationType === "drying" ? toNum(form.moistureIn) : null,
      net_line_weight_kg: form.operationType === "drying" ? toNum(form.dryingOutputKg) : null,
    };

    setSubmitting(true);
    try {
      await createTicket(ticket, [line], []);
      toast({ title: "Талон создан", description: "Талон добавлен в активные" });
      setForm(INITIAL_FORM);
      await load();
    } catch (e: any) {
      toast({ title: "Ошибка создания", description: e?.message || "Не удалось создать талон", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const closeTicket = async () => {
    if (!activeTicket || !profile?.id || !canOperate || finalizing) return;
    const g = Number(activeTicket.gross_weight_kg || 0);
    const t = Number(closingTare || 0);
    if (!Number.isFinite(g) || g <= 0) return toast({ title: "Ошибка", description: "Брутто не заполнено", variant: "destructive" });
    if (!Number.isFinite(t) || t < 0) return toast({ title: "Ошибка", description: "Некорректная тара", variant: "destructive" });
    if (t > g) return toast({ title: "Ошибка", description: "Тара больше брутто", variant: "destructive" });
    if (!window.confirm("Закрыть талон?")) return;

    setFinalizing(true);
    try {
      await patchTicket(activeTicket.id, profile.id, { tare_weight_kg: toNum(closingTare) ?? undefined, status: "ready_to_close" });
      await finalizeTicket(activeTicket.id, profile.id);
      toast({ title: "Талон закрыт", description: "Движение зафиксировано" });
      setActiveTicket(null);
      await load();
    } catch (e: any) {
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
      await load();
    } catch (e: any) {
      toast({ title: "Ошибка", description: e?.message || "Не удалось аннулировать талон", variant: "destructive" });
    } finally {
      setVoiding(false);
    }
  };

  if (!canView) return <PageHeader title="Весовая и движения" description="Доступ ограничен по роли" />;

  const activeDriver = activeTicket ? drivers.find((d) => d.id === activeTicket.driver_id) : null;
  const activeVehicle = activeTicket ? vehicles.find((v) => v.id === activeTicket.vehicle_id) : null;
  const from = activeTicket ? (activeTicket.direction === "incoming" ? fields.find((f) => f.id === activeTicket.field_id)?.name : warehouses.find((w) => w.id === activeTicket.warehouse_from_id)?.name) || "-" : "-";
  const to = activeTicket ? (activeTicket.direction === "incoming" ? warehouses.find((w) => w.id === activeTicket.warehouse_to_id)?.name : activeTicket.direction === "outgoing" ? fields.find((f) => f.id === activeTicket.field_id)?.name : warehouses.find((w) => w.id === activeTicket.warehouse_to_id)?.name) || "-" : "-";

  return (
    <div className="mx-auto max-w-[1360px] space-y-6 px-2 pb-6">
      <PageHeader title="Весовая и движения" description="Создание, активные талоны, закрытие и история">
        <Button variant="outline" onClick={() => historyRef.current?.scrollIntoView({ behavior: "smooth" })}><History className="mr-2 h-4 w-4" />История</Button>
      </PageHeader>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_360px]">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Scale className="h-5 w-5 text-blue-600" />Создание талона</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {!canOperate ? <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Режим наблюдения: доступен только просмотр.</div> : null}
            <div className="space-y-2">
              <Label>Тип операции</Label>
              <div className="grid gap-2 md:grid-cols-2">{(["harvest_incoming", "issue_to_field", "transfer_between_warehouses", "disposal_writeoff", "drying"] as OperationType[]).map((type) => <Button key={type} type="button" variant={form.operationType === type ? "default" : "outline"} className={form.operationType === type ? "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700" : ""} onClick={() => setForm((p) => ({ ...INITIAL_FORM, operationType: type }))}>{opMeta(type).title}</Button>)}</div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {(form.operationType === "harvest_incoming" || form.operationType === "issue_to_field") && <div className="space-y-2"><Label>Поле *</Label><Select value={form.fieldId} onValueChange={(v) => setForm((p) => ({ ...p, fieldId: v }))}><SelectTrigger><SelectValue placeholder="Выберите поле" /></SelectTrigger><SelectContent>{fields.map((f) => <SelectItem key={f.id} value={f.id}>{f.name} • {f.area.toFixed(2)} га</SelectItem>)}</SelectContent></Select></div>}
              {form.operationType !== "harvest_incoming" && <div className="space-y-2"><Label>Склад-источник *</Label><Select value={form.warehouseFromId} onValueChange={(v) => setForm((p) => ({ ...p, warehouseFromId: v }))}><SelectTrigger><SelectValue placeholder="Выберите склад" /></SelectTrigger><SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select></div>}
              {(form.operationType === "harvest_incoming" || form.operationType === "transfer_between_warehouses" || form.operationType === "drying") && <div className="space-y-2"><Label>{form.operationType === "drying" ? "Склад после сушки *" : "Склад назначения *"}</Label><Select value={form.warehouseToId} onValueChange={(v) => setForm((p) => ({ ...p, warehouseToId: v }))}><SelectTrigger><SelectValue placeholder="Выберите склад" /></SelectTrigger><SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select></div>}
              {form.operationType === "drying" && <div className="space-y-2"><Label>Точка сушки *</Label><Select value={form.processingPointId} onValueChange={(v) => setForm((p) => ({ ...p, processingPointId: v }))}><SelectTrigger><SelectValue placeholder="Выберите точку" /></SelectTrigger><SelectContent>{processingPoints.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent></Select></div>}
            </div>

            {form.operationType === "harvest_incoming" ? <div className="grid gap-3 md:grid-cols-3"><div className="space-y-2"><Label>Культура *</Label><Select value={form.cropId} onValueChange={(v) => setForm((p) => ({ ...p, cropId: v, varietyId: "" }))}><SelectTrigger><SelectValue placeholder="Выберите культуру" /></SelectTrigger><SelectContent>{crops.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Сорт</Label><Select value={form.varietyId} onValueChange={(v) => setForm((p) => ({ ...p, varietyId: v }))}><SelectTrigger><SelectValue placeholder="Выберите сорт" /></SelectTrigger><SelectContent>{filteredVarieties.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Репродукция</Label><Select value={form.reproductionId} onValueChange={(v) => setForm((p) => ({ ...p, reproductionId: v }))}><SelectTrigger><SelectValue placeholder="Выберите репродукцию" /></SelectTrigger><SelectContent>{reproductions.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent></Select></div></div> : <div className="grid gap-3 md:grid-cols-2"><div className="space-y-2"><Label>Номенклатура *</Label><Select value={form.productId} onValueChange={(v) => setForm((p) => ({ ...p, productId: v }))}><SelectTrigger><SelectValue placeholder="Выберите номенклатуру" /></SelectTrigger><SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Количество (кг) *</Label><Input value={form.quantityKg} onChange={(e) => setForm((p) => ({ ...p, quantityKg: e.target.value }))} /></div></div>}

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2"><Label>Водитель (специалист) *</Label><Select value={form.driverId} onValueChange={(v) => setForm((p) => ({ ...p, driverId: v }))}><SelectTrigger><SelectValue placeholder="Выберите водителя" /></SelectTrigger><SelectContent>{drivers.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Машина *</Label><Select value={form.vehicleId} onValueChange={(v) => setForm((p) => ({ ...p, vehicleId: v }))}><SelectTrigger><SelectValue placeholder="Выберите машину" /></SelectTrigger><SelectContent>{vehicles.map((v) => <SelectItem key={v.id} value={v.id}>{v.name} ({v.plate})</SelectItem>)}</SelectContent></Select></div>
            </div>

            {form.operationType === "harvest_incoming" ? <div className="grid gap-3 md:grid-cols-2"><div className="space-y-2"><Label>Брутто (кг) *</Label><Input value={form.grossKg} onChange={(e) => setForm((p) => ({ ...p, grossKg: e.target.value }))} /></div><div className="rounded-md border bg-slate-50 p-3 text-sm"><div className="font-medium text-slate-700">Тара указывается только при закрытии талона</div><div className="mt-1 text-slate-500">Формула: нетто = брутто - тара</div></div></div> : null}
            {form.operationType === "drying" ? <div className="grid gap-3 md:grid-cols-3"><div className="space-y-2"><Label>Масса после сушки (кг) *</Label><Input value={form.dryingOutputKg} onChange={(e) => setForm((p) => ({ ...p, dryingOutputKg: e.target.value }))} /></div><div className="space-y-2"><Label>Влажность до (%)</Label><Input value={form.moistureIn} onChange={(e) => setForm((p) => ({ ...p, moistureIn: e.target.value }))} /></div><div className="space-y-2"><Label>Влажность после (%)</Label><Input value={form.moistureOut} onChange={(e) => setForm((p) => ({ ...p, moistureOut: e.target.value }))} /></div></div> : null}
            {form.operationType === "disposal_writeoff" ? <div className="space-y-2"><Label>Причина списания *</Label><Input value={form.disposalReason} onChange={(e) => setForm((p) => ({ ...p, disposalReason: e.target.value }))} /></div> : null}
            <div className="space-y-2"><Label>Комментарий</Label><Textarea value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} rows={3} /></div>
            {canOperate ? <Button className="w-full" onClick={create} disabled={submitting || loading}>{submitting ? "Создание..." : "Создать талон"}</Button> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Clock3 className="h-5 w-5 text-slate-700" />Активные талоны</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {loading ? <div className="text-sm text-slate-500">Загрузка...</div> : activeTickets.length === 0 ? <div className="rounded-md border border-dashed p-5 text-center text-sm text-slate-500">Активных талонов нет</div> : activeTickets.map((t) => <button key={t.id} type="button" onClick={() => setActiveTicket(t)} className="w-full rounded-lg border border-slate-200 p-3 text-left transition hover:border-blue-300 hover:bg-slate-50"><div className="flex items-center justify-between gap-2"><div className="truncate text-sm font-semibold">{t.ticket_no}</div><Badge className={statusClass(t.status)}>{statusLabel(t.status)}</Badge></div><div className="mt-1 text-xs text-slate-600">{t.op_type}</div><div className="mt-1 text-xs text-slate-600">Этап: <span className="font-medium">{t.tare_weight_kg == null ? "ожидает тару" : "создан"}</span></div><div className="mt-1 text-xs text-slate-500">Брутто: {t.gross_weight_kg ?? "-"} • Машина: {vehicles.find((v) => v.id === t.vehicle_id)?.name || "-"}</div><div className="mt-1 text-xs text-slate-500">{fmt(t.created_at, lang)}</div></button>)}
          </CardContent>
        </Card>
      </div>

      <div ref={historyRef}>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0"><CardTitle>История талонов</CardTitle><div className="w-[260px]"><Select value={historyTypeFilter} onValueChange={setHistoryTypeFilter}><SelectTrigger><SelectValue placeholder="Фильтр по типу" /></SelectTrigger><SelectContent><SelectItem value="all">Все типы</SelectItem>{historyTypes.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select></div></CardHeader>
          <CardContent className="space-y-2">{loading ? <div className="text-sm text-slate-500">Загрузка...</div> : historyTickets.length === 0 ? <div className="text-sm text-slate-500">Закрытых талонов пока нет</div> : historyTickets.slice(0, 80).map((t) => <div key={t.id} className="rounded-md border p-3"><div className="flex items-center justify-between gap-2"><div className="font-medium">{t.ticket_no}</div><div className="flex items-center gap-2"><Badge className={statusClass(t.status)}>{statusLabel(t.status)}</Badge><Button variant="outline" size="sm" onClick={async () => { if (!profile?.id) return; try { await downloadTicketPdf(t.id, profile.id); } catch (error: any) { toast({ title: "Ошибка PDF", description: error?.message || "Не удалось скачать PDF", variant: "destructive" }); } }}><FileDown className="mr-1 h-4 w-4" />Скачать PDF</Button></div></div><div className="mt-1 text-sm text-slate-600">{t.op_type} • {t.direction}</div><div className="mt-1 text-xs text-slate-500">{fmt(t.finalized_at || t.updated_at || t.created_at, lang)}</div></div>)}</CardContent>
        </Card>
      </div>

      <Sheet open={Boolean(activeTicket)} onOpenChange={(open) => !open && setActiveTicket(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          {activeTicket ? <div className="space-y-5"><SheetHeader><SheetTitle>{activeTicket.ticket_no}</SheetTitle><SheetDescription>{activeTicket.op_type}</SheetDescription></SheetHeader><div className="rounded-md border bg-slate-50 p-3 text-sm"><div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Инфо по талону</div><div className="grid grid-cols-2 gap-2"><div className="text-slate-500">Откуда</div><div>{from}</div><div className="text-slate-500">Куда</div><div>{to}</div><div className="text-slate-500">Водитель</div><div>{activeDriver?.name || "-"}</div><div className="text-slate-500">Машина</div><div>{activeVehicle?.name || "-"}</div><div className="text-slate-500">Кассир</div><div>{profile?.full_name?.trim() || profile?.email || "-"}</div><div className="text-slate-500">Создан</div><div>{fmt(activeTicket.created_at, lang)}</div></div></div><div className="rounded-md border p-3"><div className="space-y-2"><Label>Брутто (кг)</Label><Input value={gross} readOnly className="bg-slate-50" /></div><div className="mt-3 space-y-2"><Label>Тара (кг)</Label><Input value={closingTare} onChange={(e) => setClosingTare(e.target.value)} /></div><div className="mt-3 rounded-md border bg-slate-50 p-3 text-sm"><div className="flex items-center justify-between"><span>Брутто</span><span>{gross || "-"}</span></div><div className="flex items-center justify-between"><span>Тара</span><span>{closingTare || "-"}</span></div><div className="my-2 border-t" /><div className="flex items-center justify-between font-semibold"><span>Чистый вес (нетто)</span><span>{pure == null ? "-" : pure.toFixed(3)}</span></div><div className="mt-2 text-xs text-slate-500">Формула: net = gross - tare</div>{pure != null && pure <= 0 ? <div className="mt-2 text-xs text-red-600">Ошибка: тара не может быть больше или равна брутто</div> : null}</div></div>{canOperate ? <div className="space-y-2"><div className="grid grid-cols-2 gap-2"><Button variant="outline" onClick={async () => { if (!profile?.id) return; try { await downloadTicketPdf(activeTicket.id, profile.id); } catch (error: any) { toast({ title: "Ошибка PDF", description: error?.message || "Не удалось скачать PDF", variant: "destructive" }); } }}><FileDown className="mr-2 h-4 w-4" />Скачать PDF</Button><Button className="bg-emerald-600 hover:bg-emerald-700" onClick={closeTicket} disabled={finalizing || (pure != null && pure <= 0)}><CheckCircle2 className="mr-2 h-4 w-4" />{finalizing ? "Закрытие..." : "Закрыть талон"}</Button></div>{canVoid ? <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3"><Label>Причина аннулирования</Label><Textarea value={voidReason} onChange={(e) => setVoidReason(e.target.value)} rows={2} /><Button variant="destructive" className="w-full" onClick={handleVoid} disabled={voiding}><Trash2 className="mr-2 h-4 w-4" />{voiding ? "Аннулирование..." : "Аннулировать талон"}</Button></div> : null}</div> : null}</div> : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
