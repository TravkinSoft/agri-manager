"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import {
  FullPesticideCardDialog,
  type FullPesticideCardData,
} from "@/components/platform/full-pesticide-card-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/contexts/auth-context";
import { buildClientAuthHeaders } from "@/lib/supabase/client-auth";
import {
  archiveCompanyPerson,
  createCompanyPerson,
  createEquipmentReference,
  createMachineReference,
  createVehicleReference,
  displayVehiclePlate,
  getAdditives,
  getCompanyAssetReferences,
  getCompanyPeople,
  getGlobalEquipmentModels,
  getGlobalMachineModels,
  getGlobalTransportModels,
  getFertilizers,
  getPesticides,
  getSeasonAgronomyUsage,
  updateCompanyPerson,
  type SeasonAgronomyUsageRow,
} from "@/lib/services/references";
import type {
  GlobalEquipmentModel,
  GlobalMachineModel,
  GlobalTransportModel,
} from "@/lib/types/references";

type DomainTab = "agronomy" | "agrochemistry" | "machine-yard" | "fleet" | "personnel";
type MachineYardTab = "machines" | "equipment";
type ModalType = "machine" | "equipment" | "vehicle" | "worker";

const pesticideCategoryLabels: Record<string, string> = {
  herbicide: "Гербицид",
  fungicide: "Фунгицид",
  insecticide: "Инсектицид",
  seed_treatment: "Протравитель",
  desiccant: "Десикант",
  growth_regulator: "Регулятор роста",
  adjuvant: "Адъювант",
  biological: "Биопрепарат",
  surfactant: "ПАВ",
  water_conditioner: "Кондиционер воды",
  pH_regulator: "pH-регулятор",
  drift_reduction_agent: "Антидрифтовый агент",
  anti_foam: "Антивспениватель",
};

const fertilizerTypeLabels: Record<string, string> = {
  nitrogen: "Азотное",
  phosphorus: "Фосфорное",
  potassium: "Калийное",
  npk: "NPK",
  micronutrient: "Микроэлементное",
  foliar: "Листовое",
  organic: "Органическое",
};

const workerRoleOptions = [
  { value: "agronomist", label: "Агроном" },
  { value: "mechanic_operator", label: "Механизатор" },
  { value: "driver", label: "Водитель" },
  { value: "warehouse_manager", label: "Кладовщик" },
  { value: "weighbridge_operator", label: "Весовщик" },
  { value: "worker", label: "Рабочий" },
  { value: "manager", label: "Руководитель" },
  { value: "admin", label: "Администратор" },
  { value: "other", label: "Другое" },
] as const;

const workerRoleLabels: Record<string, string> = Object.fromEntries(
  workerRoleOptions.map((option) => [option.value, option.label])
);

const employmentTypeLabels: Record<string, string> = {
  permanent: "Постоянный",
  temporary: "Временный",
  seasonal: "Сезонный",
  contractor: "Подрядчик",
  unknown: "Не указано",
};

const workerStatusLabels: Record<string, string> = {
  active: "Активен",
  inactive: "Неактивен",
  archived: "Архив",
};

const formatHa = (value: number) =>
  `${Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} га`;

const emptyCell = "—";

function assetBrand(row: any): string {
  return row.global_model?.brand || row.transport_model?.brand || row.brand || row.global_vehicle_brands?.name || emptyCell;
}

function assetModel(row: any): string {
  return row.global_model?.model || row.transport_model?.model || row.model || row.global_vehicle_models?.name || emptyCell;
}

function assetIdentifier(row: any): string {
  const plate = row.plate_number || row.license_plate;
  if (plate) {
    const display = displayVehiclePlate(plate);
    if (display !== "Госномер не указан") return display;
  }
  const inventory = String(row.inventory_number || "").trim();
  if (/^(авто|комбайн|трактор|прицеп|гусеничный|сеялка)$/i.test(inventory)) return emptyCell;
  return inventory || emptyCell;
}

function assetYear(row: any): string {
  const year = Number(row.manufacture_year || 0);
  return year > 1900 ? String(year) : emptyCell;
}

function activeStatus(row: any): string {
  return row.is_active === false ? "Неактивен" : "Активен";
}

function machineTypeFromCatalog(category: string | null | undefined) {
  const value = String(category || "").toLowerCase();
  if (value.includes("combine") || value.includes("harvester")) return "combine" as const;
  if (value.includes("sprayer")) return "sprayer" as const;
  if (value.includes("cultivator")) return "cultivator" as const;
  if (value.includes("seeder") || value.includes("planter")) return "seeder" as const;
  if (value === "tractor") return "tractor" as const;
  return "other" as const;
}

function vehicleTypeFromCatalog(category: string | null | undefined) {
  const value = String(category || "").toLowerCase();
  if (value === "trailer") return "trailer" as const;
  if (value === "truck" || value === "tractor_unit") return "truck" as const;
  return "other" as const;
}

function catalogModelLabel(row: { full_name?: string | null; name?: string | null; brand?: string | null; model?: string | null }) {
  return row.full_name || row.name || [row.brand, row.model].filter(Boolean).join(" ") || "Без названия";
}

function DataTable(props: { headers: string[]; rows: ReactNode[][]; loading: boolean; empty: string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {props.headers.map((header) => (
            <TableHead key={header}>{header}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.loading ? (
          <TableRow>
            <TableCell colSpan={props.headers.length} className="text-center text-slate-500">
              Загрузка...
            </TableCell>
          </TableRow>
        ) : props.rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={props.headers.length} className="text-center text-slate-500">
              {props.empty}
            </TableCell>
          </TableRow>
        ) : (
          props.rows.map((row, rowIdx) => (
            <TableRow key={rowIdx}>
              {row.map((cell, cellIdx) => (
                <TableCell key={`${rowIdx}-${cellIdx}`} className={cellIdx === 0 ? "font-medium" : ""}>
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function pluralRu(value: number, one: string, few: string, many: string) {
  const abs = Math.abs(value);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function TabLabel({ label, count }: { label: string; count: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span>{label}</span>
      <span className="rounded-full border border-slate-700/70 bg-slate-950/70 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-slate-300">
        {count}
      </span>
    </span>
  );
}

function reproductionDisplay(value?: string | null) {
  const text = String(value || "").trim();
  if (!text) return "—";
  const normalized = text.toLowerCase();
  const display = (code: string, description: string) => (
    <div>
      <div className="font-medium">{code}</div>
      <div className="text-xs text-slate-500">{description}</div>
    </div>
  );
  if (/(ориг|original|^os$|^oc$)/i.test(normalized)) return display("ОС", "Оригинальные семена");
  if (/(супер|super|^se$|^сэ$)/i.test(normalized)) return display("СЭ", "Суперэлита");
  if (/(элит|elite|^es$|^эс$)/i.test(normalized)) return display("ЭС?", "Элита, проверьте категорию");
  if (/(рс1|rs1|r1|1 репр|первая)/i.test(normalized)) return display("РС1", "1-я репродукция");
  if (/(рс2|rs2|r2|2 репр|вторая)/i.test(normalized)) return display("РС2", "2-я репродукция");
  if (/(рс3|rs3|r3|3 репр|третья)/i.test(normalized)) return display("РС3", "3-я репродукция");
  if (/(рс4|rs4|r4|4 репр|четвертая|четвёртая)/i.test(normalized)) return display("РС4", "4-я репродукция");
  if (/f1/i.test(normalized)) return display("F1", "Гибрид 1-го поколения");
  return text;
}

function materialKind(row: any) {
  const haystack = [row.product_type, row.type, row.category, row.subcategory].join(" ").toLowerCase();
  if (haystack.includes("fertilizer")) return "Удобрение";
  if (haystack.includes("additive") || haystack.includes("adjuvant")) return "Добавка";
  return "Пестицид";
}

function materialCategory(row: any) {
  const key = String(row.subcategory || row.pesticide_category || row.fertilizer_type || row.category || "");
  return pesticideCategoryLabels[key] || fertilizerTypeLabels[key] || key || "—";
}

export default function ReferencesPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const directCardHandled = useRef(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pesticideCardOpen, setPesticideCardOpen] = useState(false);
  const [pesticideCardLoading, setPesticideCardLoading] = useState(false);
  const [pesticideCardError, setPesticideCardError] = useState<string | null>(null);
  const [pesticideCard, setPesticideCard] = useState<FullPesticideCardData | null>(null);
  const [selectedPesticideId, setSelectedPesticideId] = useState<string | null>(null);

  const [domainTab, setDomainTab] = useState<DomainTab>("agronomy");
  const [machineYardTab, setMachineYardTab] = useState<MachineYardTab>("machines");
  const [modalType, setModalType] = useState<ModalType | null>(null);
  const [editingWorkerId, setEditingWorkerId] = useState<string | null>(null);

  const [modelSearch, setModelSearch] = useState("");
  const [workerSearch, setWorkerSearch] = useState("");
  const [workerRoleFilter, setWorkerRoleFilter] = useState("all");
  const [workerStatusFilter, setWorkerStatusFilter] = useState("active");

  const [seasonUsage, setSeasonUsage] = useState<SeasonAgronomyUsageRow[]>([]);
  const [pesticides, setPesticides] = useState<any[]>([]);
  const [fertilizers, setFertilizers] = useState<any[]>([]);
  const [additives, setAdditives] = useState<any[]>([]);
  const [machines, setMachines] = useState<any[]>([]);
  const [equipment, setEquipment] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [workers, setWorkers] = useState<any[]>([]);
  const [machineModels, setMachineModels] = useState<GlobalMachineModel[]>([]);
  const [equipmentModels, setEquipmentModels] = useState<GlobalEquipmentModel[]>([]);
  const [transportModels, setTransportModels] = useState<GlobalTransportModel[]>([]);

  const [form, setForm] = useState<Record<string, string>>({});
  const canManageCompanyReferences = profile?.role === "company_admin" || profile?.role === "global_admin";

  const companyMaterials = useMemo(() => [...pesticides, ...fertilizers, ...additives], [pesticides, fertilizers, additives]);
  const filteredAssetModels = useMemo(() => {
    const query = modelSearch.trim().toLocaleLowerCase("ru");
    const rows = modalType === "machine"
      ? machineModels
      : modalType === "equipment"
        ? equipmentModels
        : modalType === "vehicle"
          ? transportModels
          : [];
    return rows
      .filter((row) => !query || catalogModelLabel(row).toLocaleLowerCase("ru").includes(query))
      .slice(0, 100);
  }, [equipmentModels, machineModels, modalType, modelSearch, transportModels]);
  const seasonCropCount = useMemo(() => {
    const keys = new Set(
      seasonUsage
        .map((row) => String(row.crop_id || row.crop_name || "").trim())
        .filter(Boolean)
    );
    return keys.size;
  }, [seasonUsage]);
  const countText = (value: number) => (loading ? "..." : String(value));
  const agronomyCountText = loading
    ? "..."
    : `${seasonCropCount} ${pluralRu(seasonCropCount, "культура", "культуры", "культур")}`;

  const currentAction = useMemo(() => {
    if (!canManageCompanyReferences) return null;
    if (domainTab === "machine-yard" && machineYardTab === "machines") {
      return { label: "Добавить технику", modal: "machine" as const };
    }
    if (domainTab === "machine-yard" && machineYardTab === "equipment") {
      return { label: "Добавить оборудование", modal: "equipment" as const };
    }
    if (domainTab === "fleet") return { label: "Добавить транспорт", modal: "vehicle" as const };
    if (domainTab === "personnel") return { label: "Добавить сотрудника", modal: "worker" as const };
    return null;
  }, [canManageCompanyReferences, domainTab, machineYardTab]);

  const loadAll = async () => {
    if (!profile?.company_id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [usageRows, pesticideRows, fertilizerRows, additiveRows, assetRows, workerRows, machineModelRows, equipmentModelRows, transportModelRows] =
        await Promise.all([
          getSeasonAgronomyUsage(profile.company_id, "ru"),
          getPesticides(profile.company_id, false, "ru"),
          getFertilizers(profile.company_id, false, "ru"),
          getAdditives(profile.company_id, false, "ru"),
          getCompanyAssetReferences(profile.company_id, "ru"),
          getCompanyPeople(profile.company_id, true),
          getGlobalMachineModels(),
          getGlobalEquipmentModels(),
          getGlobalTransportModels(),
        ]);
      setSeasonUsage(usageRows);
      setPesticides(pesticideRows);
      setFertilizers(fertilizerRows);
      setAdditives(additiveRows);
      setMachines(assetRows.machines);
      setEquipment(assetRows.equipment);
      setVehicles(assetRows.vehicles);
      setWorkers(workerRows);
      setMachineModels(machineModelRows);
      setEquipmentModels(equipmentModelRows);
      setTransportModels(transportModelRows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, [profile?.company_id]);

  const filteredWorkers = useMemo(() => {
    const query = workerSearch.trim().toLowerCase();
    return workers.filter((worker) => {
      const matchesSearch =
        !query ||
        [worker.full_name, worker.short_name, worker.phone, worker.notes].some((value) =>
          String(value || "").toLowerCase().includes(query)
        );
      const matchesRole = workerRoleFilter === "all" || worker.role_type === workerRoleFilter;
      const matchesStatus = workerStatusFilter === "all" || worker.status === workerStatusFilter;
      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [workers, workerSearch, workerRoleFilter, workerStatusFilter]);

  const openModal = (type: ModalType, initialForm: Record<string, string> = {}) => {
    setModalType(type);
    setEditingWorkerId(type === "worker" && initialForm.id ? initialForm.id : null);
    setForm(initialForm);
    setModelSearch("");
  };

  const closeModal = () => {
    setModalType(null);
    setEditingWorkerId(null);
    setForm({});
  };

  const loadPesticideCard = async (productId: string) => {
    setSelectedPesticideId(productId);
    setPesticideCardOpen(true);
    setPesticideCardLoading(true);
    setPesticideCardError(null);
    setPesticideCard(null);
    try {
      const headers = await buildClientAuthHeaders();
      const response = await fetch(`/api/catalog/pesticide-card/${productId}`, {
        headers,
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Не удалось загрузить полную карточку");
      setPesticideCard(payload as FullPesticideCardData);
    } catch (error) {
      setPesticideCardError(error instanceof Error ? error.message : "Не удалось загрузить полную карточку");
    } finally {
      setPesticideCardLoading(false);
    }
  };

  useEffect(() => {
    if (!profile?.id || directCardHandled.current) return;
    const productId = new URLSearchParams(window.location.search).get("pesticide");
    if (!productId) return;
    directCardHandled.current = true;
    setDomainTab("agrochemistry");
    void loadPesticideCard(productId);
  }, [profile?.id]);

  const submitCreate = async () => {
    if (!profile?.company_id || !profile?.id || !modalType || saving) return;
    setSaving(true);
    try {
      if (modalType === "machine") {
        const model = machineModels.find((row) => row.id === form.model_id);
        if (!model) throw new Error("Выберите модель техники из ГЛБД");
        const type = machineTypeFromCatalog(model.category);
        const canonicalName = catalogModelLabel(model);
        const instanceIdentifier = String(form.inventory_number || form.plate_number || "").trim();
        await createMachineReference(profile.company_id, profile.id, {
          name: instanceIdentifier ? `${canonicalName} • ${instanceIdentifier}` : canonicalName,
          type,
          model: model.model || "",
          status: (form.status || "free") as any,
          is_active: form.status !== "inactive",
          global_machine_model_id: model.id,
          full_name: canonicalName,
          brand: model.brand,
          series: model.series,
          category: type,
          machinery_type: model.category,
          inventory_number: form.inventory_number || null,
          license_plate: form.plate_number || null,
          manufacture_year: form.manufacture_year ? Number(form.manufacture_year) : null,
        });
      }
      if (modalType === "equipment") {
        const model = equipmentModels.find((row) => row.id === form.model_id);
        if (!model) throw new Error("Выберите модель оборудования из ГЛБД");
        await createEquipmentReference(profile.company_id, profile.id, {
          name: catalogModelLabel(model),
          category: model.category || "other",
          global_equipment_model_id: model.id,
          full_name: catalogModelLabel(model),
          brand: model.brand,
          series: model.series,
          model: model.model,
          equipment_category: model.category || model.equipment_type,
          inventory_number: form.inventory_number || null,
          manufacture_year: form.manufacture_year ? Number(form.manufacture_year) : null,
          is_active: form.status !== "inactive",
        });
      }
      if (modalType === "vehicle") {
        const model = transportModels.find((row) => row.id === form.model_id);
        if (!model) throw new Error("Выберите модель транспорта из ГЛБД");
        if (!form.plate_number?.trim()) throw new Error("Укажите госномер");
        await createVehicleReference(profile.company_id, profile.id, {
          name: catalogModelLabel(model),
          global_brand_id: null,
          global_model_id: null,
          transport_model_id: model.id,
          custom_name: "",
          inventory_number: form.inventory_number || "",
          primary_responsible_personnel_id: null,
          type: vehicleTypeFromCatalog(model.category),
          full_name: catalogModelLabel(model),
          brand: model.brand,
          series: model.series,
          model: model.model,
          plate_number: form.plate_number.trim(),
          capacity_kg: Number(form.capacity_kg || 0),
          body_volume_m3: null,
          manufacture_year: form.manufacture_year ? Number(form.manufacture_year) : null,
          status: (form.status || "free") as any,
          is_active: form.status !== "inactive",
        });
      }
      if (modalType === "worker") {
        if (!form.full_name?.trim()) throw new Error("Укажите ФИО");
        const payload = {
          full_name: form.full_name.trim(),
          short_name: form.short_name || "",
          role_type: (form.role_type || "worker") as any,
          employment_type: (form.employment_type || "unknown") as any,
          phone: form.phone || "",
          iin: form.iin || "",
          status: (form.status || "active") as any,
          notes: form.notes || "",
          user_id: null,
        };
        if (editingWorkerId) {
          await updateCompanyPerson(profile.company_id, editingWorkerId, profile.id, payload);
        } else {
          await createCompanyPerson(profile.company_id, profile.id, payload);
        }
      }
      closeModal();
      await loadAll();
      toast({ title: "Готово", description: editingWorkerId ? "Запись обновлена" : "Запись успешно создана" });
    } catch (error) {
      toast({
        title: "Ошибка",
        description: error instanceof Error ? error.message : "Не удалось сохранить запись",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const editWorker = (worker: any) => {
    openModal("worker", {
      id: worker.id,
      full_name: worker.full_name || "",
      short_name: worker.short_name || "",
      role_type: worker.role_type || "worker",
      employment_type: worker.employment_type || "unknown",
      phone: worker.phone || "",
      iin: worker.iin || "",
      status: worker.status || "active",
      notes: worker.notes || "",
    });
  };

  const archiveWorker = async (worker: any) => {
    if (!profile?.company_id || !profile?.id || saving) return;
    setSaving(true);
    try {
      await archiveCompanyPerson(profile.company_id, worker.id, profile.id);
      await loadAll();
      toast({ title: "Готово", description: "Сотрудник перенесён в архив" });
    } catch (error) {
      toast({
        title: "Ошибка",
        description: error instanceof Error ? error.message : "Не удалось архивировать сотрудника",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Справочники"
        description="Company-scoped справочники: структура сезона, материалы компании, техника, автопарк и персонал."
      />

      <Tabs value={domainTab} onValueChange={(value) => setDomainTab(value as DomainTab)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList className="w-full justify-start overflow-auto md:w-auto">
            <TabsTrigger value="agronomy"><TabLabel label="Агрономия" count={agronomyCountText} /></TabsTrigger>
            <TabsTrigger value="agrochemistry"><TabLabel label="Агрохимия" count={countText(companyMaterials.length)} /></TabsTrigger>
            <TabsTrigger value="machine-yard"><TabLabel label="Техника / оборудование" count={countText(machines.length + equipment.length)} /></TabsTrigger>
            <TabsTrigger value="fleet"><TabLabel label="Автопарк" count={countText(vehicles.length)} /></TabsTrigger>
            <TabsTrigger value="personnel"><TabLabel label="Персонал" count={countText(workers.length)} /></TabsTrigger>
          </TabsList>
          {currentAction ? (
            <Button onClick={() => openModal(currentAction.modal)} disabled={saving}>
              {saving ? "Сохранение..." : currentAction.label}
            </Button>
          ) : null}
        </div>

        <TabsContent value="agronomy">
          <Card>
            <CardHeader>
              <CardTitle>
                Культуры в текущем сезоне
                {seasonUsage[0]?.season_year ? ` ${seasonUsage[0].season_year}` : ""}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-500">
                Это read-only срез из структуры посевов компании. Глобальные культуры и демо-справочник здесь не показываются.
              </p>
              <DataTable
                headers={["Культура", "Площадь", "Полей/участков", "Сорт", "Репродукция"]}
                rows={seasonUsage.map((row) => [
                  row.crop_name,
                  formatHa(row.area_ha),
                  String(row.field_count),
                  row.variety_name || "—",
                  reproductionDisplay(row.reproduction_name),
                ])}
                loading={loading}
                empty="Структура сезона ещё не заполнена"
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="agrochemistry" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Материалы компании</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-500">
                Здесь отображаются только препараты, удобрения и добавки, уже подключённые к компании.
              </p>
              <DataTable
                headers={["Название", "Тип", "Категория/подтип", "Производитель", "ДВ/состав", "Статусы"]}
                rows={companyMaterials.map((x) => [
                  x.trade_name || x.name,
                  materialKind(x),
                  materialCategory(x),
                  x.manufacturer || "—",
                  x.active_ingredient || "—",
                  Array.isArray(x.reference_statuses) && x.reference_statuses.length > 0
                    ? x.reference_statuses.join(" · ")
                    : "Добавлен компанией",
                ])}
                loading={loading}
                empty="Материалы компании не добавлены"
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="machine-yard">
          <Tabs value={machineYardTab} onValueChange={(value) => setMachineYardTab(value as MachineYardTab)}>
            <TabsList>
              <TabsTrigger value="machines"><TabLabel label="Техника" count={countText(machines.length)} /></TabsTrigger>
              <TabsTrigger value="equipment"><TabLabel label="Оборудование" count={countText(equipment.length)} /></TabsTrigger>
            </TabsList>
            <TabsContent value="machines">
              <Card>
                <CardHeader>
                  <CardTitle>Техника компании</CardTitle>
                </CardHeader>
                <CardContent>
                  <DataTable
                    headers={["Название", "Тип", "Бренд", "Модель", "Госномер / Инв. №", "Год", "Статус"]}
                    rows={machines.map((x) => [
                      x.display_name || x.full_name || x.name,
                      x.display_type || emptyCell,
                      assetBrand(x),
                      assetModel(x),
                      assetIdentifier(x),
                      assetYear(x),
                      activeStatus(x),
                    ])}
                    loading={loading}
                    empty="Техника компании не добавлена"
                  />
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="equipment">
              <Card>
                <CardHeader>
                  <CardTitle>Оборудование компании</CardTitle>
                </CardHeader>
                <CardContent>
                  <DataTable
                    headers={["Название", "Категория", "Бренд", "Модель", "Инв. №", "Статус"]}
                    rows={equipment.map((x) => [
                      x.display_name || x.full_name || x.name,
                      x.display_type || emptyCell,
                      assetBrand(x),
                      assetModel(x),
                      x.inventory_number || emptyCell,
                      activeStatus(x),
                    ])}
                    loading={loading}
                    empty="Оборудование компании не добавлено"
                  />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="fleet">
          <Card>
            <CardHeader>
              <CardTitle>Автопарк</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                headers={["Название", "Категория", "Бренд", "Модель", "Госномер", "VIN", "Статус"]}
                rows={vehicles.map((x) => [
                  x.display_name || x.full_name || x.name,
                  x.display_type || emptyCell,
                  assetBrand(x),
                  assetModel(x),
                  displayVehiclePlate(x.plate_number),
                  x.vin || emptyCell,
                  activeStatus(x),
                ])}
                loading={loading}
                empty="Транспорт компании не добавлен"
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="personnel">
          <Card>
            <CardHeader>
              <CardTitle>Персонал компании</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_180px_160px]">
                <Input
                  placeholder="Поиск по ФИО, телефону или заметке..."
                  value={workerSearch}
                  onChange={(e) => setWorkerSearch(e.target.value)}
                />
                <Select value={workerRoleFilter} onValueChange={setWorkerRoleFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Роль" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все роли</SelectItem>
                    {workerRoleOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={workerStatusFilter} onValueChange={setWorkerStatusFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Статус" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все статусы</SelectItem>
                    {Object.entries(workerStatusLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ФИО</TableHead>
                    <TableHead>Роль</TableHead>
                    <TableHead>Занятость</TableHead>
                    <TableHead>Телефон</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Заметка</TableHead>
                    <TableHead className="text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-slate-500">
                        Загрузка...
                      </TableCell>
                    </TableRow>
                  ) : filteredWorkers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-slate-500">
                        Сотрудники не найдены
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredWorkers.map((worker) => (
                      <TableRow key={worker.id}>
                        <TableCell className="font-medium">
                          <div>{worker.full_name}</div>
                          {worker.short_name ? <div className="text-xs text-slate-500">{worker.short_name}</div> : null}
                        </TableCell>
                        <TableCell>{workerRoleLabels[worker.role_type] || worker.role_type}</TableCell>
                        <TableCell>{employmentTypeLabels[worker.employment_type] || worker.employment_type}</TableCell>
                        <TableCell>{worker.phone || "—"}</TableCell>
                        <TableCell>{workerStatusLabels[worker.status] || worker.status}</TableCell>
                        <TableCell className="max-w-[260px] truncate">{worker.notes || "—"}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {canManageCompanyReferences ? (
                              <>
                                <Button variant="outline" size="sm" onClick={() => editWorker(worker)} disabled={saving}>
                                  Изменить
                                </Button>
                                {worker.status !== "archived" ? (
                                  <Button variant="outline" size="sm" onClick={() => archiveWorker(worker)} disabled={saving}>
                                    Архив
                                  </Button>
                                ) : null}
                              </>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <FullPesticideCardDialog
        open={pesticideCardOpen}
        onOpenChange={setPesticideCardOpen}
        loading={pesticideCardLoading}
        error={pesticideCardError}
        card={pesticideCard}
        onRetry={() => selectedPesticideId && void loadPesticideCard(selectedPesticideId)}
        adminMode={profile?.role === "global_admin"}
      />

      <Dialog open={!!modalType} onOpenChange={(open) => !open && !saving && closeModal()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {modalType === "machine" ? "Добавить технику" : null}
              {modalType === "equipment" ? "Добавить оборудование" : null}
              {modalType === "vehicle" ? "Добавить транспорт" : null}
              {modalType === "worker" ? (editingWorkerId ? "Изменить сотрудника" : "Добавить сотрудника") : null}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {modalType === "machine" || modalType === "equipment" || modalType === "vehicle" ? (
              <>
                <div className="space-y-2">
                  <Label>Поиск модели в ГЛБД</Label>
                  <Input
                    value={modelSearch}
                    placeholder="Бренд, серия или модель"
                    onChange={(event) => setModelSearch(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Модель *</Label>
                  <Select value={form.model_id || ""} onValueChange={(value) => setForm((prev) => ({ ...prev, model_id: value }))}>
                    <SelectTrigger><SelectValue placeholder="Выберите модель из ГЛБД" /></SelectTrigger>
                    <SelectContent>
                      {filteredAssetModels.map((row) => (
                        <SelectItem key={row.id} value={row.id}>{catalogModelLabel(row)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {filteredAssetModels.length === 0 ? (
                    <p className="text-sm text-amber-300">Модель отсутствует в ГЛБД. Обратитесь к Global Admin.</p>
                  ) : null}
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <Label>Инвентарный номер</Label>
                    <Input value={form.inventory_number || ""} onChange={(event) => setForm((prev) => ({ ...prev, inventory_number: event.target.value }))} />
                  </div>
                  <div>
                    <Label>Год выпуска</Label>
                    <Input type="number" min="1900" max="2100" value={form.manufacture_year || ""} onChange={(event) => setForm((prev) => ({ ...prev, manufacture_year: event.target.value }))} />
                  </div>
                </div>
              </>
            ) : null}

            {modalType === "worker" ? (
              <>
                <div>
                  <Label>ФИО</Label>
                  <Input value={form.full_name || ""} onChange={(e) => setForm((prev) => ({ ...prev, full_name: e.target.value }))} />
                </div>
                <div>
                  <Label>Короткое имя</Label>
                  <Input value={form.short_name || ""} onChange={(e) => setForm((prev) => ({ ...prev, short_name: e.target.value }))} />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <Label>Роль</Label>
                    <Select value={form.role_type || "worker"} onValueChange={(value) => setForm((prev) => ({ ...prev, role_type: value }))}>
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите роль" />
                      </SelectTrigger>
                      <SelectContent>
                        {workerRoleOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Тип занятости</Label>
                    <Select
                      value={form.employment_type || "unknown"}
                      onValueChange={(value) => setForm((prev) => ({ ...prev, employment_type: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите тип" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(employmentTypeLabels).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <Label>Телефон</Label>
                    <Input value={form.phone || ""} onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Статус</Label>
                    <Select value={form.status || "active"} onValueChange={(value) => setForm((prev) => ({ ...prev, status: value }))}>
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите статус" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(workerStatusLabels).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Заметка</Label>
                  <Textarea value={form.notes || ""} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} />
                </div>
              </>
            ) : null}

            {modalType === "vehicle" ? (
              <>
                <div>
                  <Label>Госномер</Label>
                  <Input value={form.plate_number || ""} onChange={(e) => setForm((prev) => ({ ...prev, plate_number: e.target.value }))} />
                </div>
                <div>
                  <Label>Грузоподъёмность (кг)</Label>
                  <Input
                    type="number"
                    value={form.capacity_kg || ""}
                    onChange={(e) => setForm((prev) => ({ ...prev, capacity_kg: e.target.value }))}
                  />
                </div>
              </>
            ) : null}

            {modalType === "machine" ? (
              <div>
                <Label>Статус</Label>
                <Select value={form.status || "free"} onValueChange={(value) => setForm((prev) => ({ ...prev, status: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">Свободна</SelectItem>
                    <SelectItem value="working">В работе</SelectItem>
                    <SelectItem value="maintenance">На обслуживании</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {modalType === "equipment" ? (
              <div>
                <Label>Статус</Label>
                <Select value={form.status || "active"} onValueChange={(value) => setForm((prev) => ({ ...prev, status: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Активно</SelectItem>
                    <SelectItem value="inactive">Неактивно</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {modalType === "vehicle" ? (
              <div>
                <Label>Статус</Label>
                <Select value={form.status || "free"} onValueChange={(value) => setForm((prev) => ({ ...prev, status: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">Свободен</SelectItem>
                    <SelectItem value="in_trip">В рейсе</SelectItem>
                    <SelectItem value="loading">Погрузка</SelectItem>
                    <SelectItem value="unloading">Разгрузка</SelectItem>
                    <SelectItem value="drying">На сушке</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => !saving && closeModal()} disabled={saving}>
              Отмена
            </Button>
            <Button onClick={submitCreate} disabled={saving}>
              {saving ? "Сохранение..." : editingWorkerId ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
