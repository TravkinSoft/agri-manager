"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { BookOpen } from "lucide-react";
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
import {
  addGlobalAgrochemicalToCompany,
  archiveCompanyPerson,
  createCompanyPerson,
  createEquipmentReference,
  createMachineReference,
  createVehicleReference,
  displayVehiclePlate,
  getAdditives,
  getCompanyAssetReferences,
  getCompanyPeople,
  getFertilizers,
  getPesticides,
  getSeasonAgronomyUsage,
  searchAgrochemicalMaster,
  updateCompanyPerson,
  type SeasonAgronomyUsageRow,
} from "@/lib/services/references";

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

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [linkingGlobalId, setLinkingGlobalId] = useState<string | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [pesticideCardOpen, setPesticideCardOpen] = useState(false);
  const [pesticideCardLoading, setPesticideCardLoading] = useState(false);
  const [pesticideCardError, setPesticideCardError] = useState<string | null>(null);
  const [pesticideCard, setPesticideCard] = useState<FullPesticideCardData | null>(null);
  const [selectedPesticideId, setSelectedPesticideId] = useState<string | null>(null);

  const [domainTab, setDomainTab] = useState<DomainTab>("agronomy");
  const [machineYardTab, setMachineYardTab] = useState<MachineYardTab>("machines");
  const [modalType, setModalType] = useState<ModalType | null>(null);
  const [editingWorkerId, setEditingWorkerId] = useState<string | null>(null);

  const [catalogSearch, setCatalogSearch] = useState("");
  const [workerSearch, setWorkerSearch] = useState("");
  const [workerRoleFilter, setWorkerRoleFilter] = useState("all");
  const [workerStatusFilter, setWorkerStatusFilter] = useState("active");

  const [seasonUsage, setSeasonUsage] = useState<SeasonAgronomyUsageRow[]>([]);
  const [pesticides, setPesticides] = useState<any[]>([]);
  const [fertilizers, setFertilizers] = useState<any[]>([]);
  const [additives, setAdditives] = useState<any[]>([]);
  const [catalogRows, setCatalogRows] = useState<any[]>([]);
  const [machines, setMachines] = useState<any[]>([]);
  const [equipment, setEquipment] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [workers, setWorkers] = useState<any[]>([]);

  const [form, setForm] = useState<Record<string, string>>({});

  const companyMaterials = useMemo(() => [...pesticides, ...fertilizers, ...additives], [pesticides, fertilizers, additives]);
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
    if (domainTab === "machine-yard" && machineYardTab === "machines") {
      return { label: "Добавить технику", modal: "machine" as const };
    }
    if (domainTab === "machine-yard" && machineYardTab === "equipment") {
      return { label: "Добавить оборудование", modal: "equipment" as const };
    }
    if (domainTab === "fleet") return { label: "Добавить транспорт", modal: "vehicle" as const };
    if (domainTab === "personnel") return { label: "Добавить сотрудника", modal: "worker" as const };
    return null;
  }, [domainTab, machineYardTab]);

  const loadAll = async () => {
    if (!profile?.company_id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [usageRows, pesticideRows, fertilizerRows, additiveRows, assetRows, workerRows] =
        await Promise.all([
          getSeasonAgronomyUsage(profile.company_id, "ru"),
          getPesticides(profile.company_id, false, "ru"),
          getFertilizers(profile.company_id, false, "ru"),
          getAdditives(profile.company_id, false, "ru"),
          getCompanyAssetReferences(profile.company_id, "ru"),
          getCompanyPeople(profile.company_id, true),
        ]);
      setSeasonUsage(usageRows);
      setPesticides(pesticideRows);
      setFertilizers(fertilizerRows);
      setAdditives(additiveRows);
      setMachines(assetRows.machines);
      setEquipment(assetRows.equipment);
      setVehicles(assetRows.vehicles);
      setWorkers(workerRows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, [profile?.company_id]);

  useEffect(() => {
    if (!profile?.company_id || !catalogOpen) return;
    const query = catalogSearch.trim();
    if (query.length < 2) {
      setCatalogRows([]);
      setCatalogLoading(false);
      return;
    }
    let cancelled = false;
    setCatalogLoading(true);
    (async () => {
      try {
        const [pRows, fRows, aRows] = await Promise.all([
          searchAgrochemicalMaster(profile.company_id!, "pesticide", query, "ru"),
          searchAgrochemicalMaster(profile.company_id!, "fertilizer", query, "ru"),
          searchAgrochemicalMaster(profile.company_id!, "additive", query, "ru"),
        ]);
        if (!cancelled) setCatalogRows([...pRows, ...fRows, ...aRows]);
      } catch (error) {
        if (!cancelled) {
          setCatalogRows([]);
          toast({
            title: "Ошибка",
            description: error instanceof Error ? error.message : "Не удалось найти материалы в каталоге TravkinFlow",
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [catalogOpen, catalogSearch, profile?.company_id, toast]);

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
  };

  const closeModal = () => {
    setModalType(null);
    setEditingWorkerId(null);
    setForm({});
  };

  const loadPesticideCard = async (productId: string) => {
    setSelectedPesticideId(productId);
    setCatalogOpen(false);
    setPesticideCardOpen(true);
    setPesticideCardLoading(true);
    setPesticideCardError(null);
    setPesticideCard(null);
    try {
      const response = await fetch(`/api/catalog/pesticide-card/${productId}`, {
        credentials: "include",
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

  const submitCreate = async () => {
    if (!profile?.company_id || !profile?.id || !modalType || saving) return;
    setSaving(true);
    try {
      if (modalType === "machine") {
        if (!form.name?.trim()) throw new Error("Укажите название техники");
        await createMachineReference(profile.company_id, profile.id, {
          name: form.name.trim(),
          type: (form.type || "other") as any,
          model: form.model || "",
          status: "free",
          is_active: true,
        });
      }
      if (modalType === "equipment") {
        if (!form.name?.trim()) throw new Error("Укажите название оборудования");
        await createEquipmentReference(profile.company_id, profile.id, {
          name: form.name.trim(),
          category: form.category || "other",
        });
      }
      if (modalType === "vehicle") {
        if (!form.name?.trim()) throw new Error("Укажите название транспорта");
        if (!form.plate_number?.trim()) throw new Error("Укажите госномер");
        await createVehicleReference(profile.company_id, profile.id, {
          name: form.name.trim(),
          global_brand_id: null,
          global_model_id: null,
          custom_name: form.custom_name || form.name.trim(),
          inventory_number: form.inventory_number || "",
          primary_responsible_personnel_id: null,
          vehicle_type: (form.vehicle_type || "truck") as any,
          plate_number: form.plate_number.trim(),
          capacity_kg: Number(form.capacity_kg || 0),
          body_volume_m3: null,
          status: "free",
          is_active: true,
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

  const addFromCatalog = async (productId: string) => {
    if (!profile?.company_id || !profile?.id || linkingGlobalId) return;
    setLinkingGlobalId(productId);
    try {
      await addGlobalAgrochemicalToCompany(profile.company_id, profile.id, productId);
      await loadAll();
      setCatalogSearch("");
      setCatalogRows([]);
      toast({ title: "Готово", description: "Материал добавлен в компанию. Складские остатки не создавались." });
    } catch (error) {
      toast({
        title: "Ошибка",
        description: error instanceof Error ? error.message : "Не удалось добавить материал в компанию",
        variant: "destructive",
      });
    } finally {
      setLinkingGlobalId(null);
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
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle>Материалы компании</CardTitle>
              <Button variant="outline" onClick={() => setCatalogOpen(true)}>
                Добавить из каталога TravkinFlow
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-500">
                Здесь отображаются только препараты, удобрения и добавки, уже подключённые к компании.
              </p>
              <DataTable
                headers={["Название", "Тип", "Категория/подтип", "Производитель", "ДВ/состав"]}
                rows={companyMaterials.map((x) => [
                  x.trade_name || x.name,
                  materialKind(x),
                  materialCategory(x),
                  x.manufacturer || "—",
                  x.active_ingredient || "—",
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
                            <Button variant="outline" size="sm" onClick={() => editWorker(worker)} disabled={saving}>
                              Изменить
                            </Button>
                            {worker.status !== "archived" ? (
                              <Button variant="outline" size="sm" onClick={() => archiveWorker(worker)} disabled={saving}>
                                Архив
                              </Button>
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

      <Dialog open={catalogOpen} onOpenChange={(open) => !linkingGlobalId && setCatalogOpen(open)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Добавить из каталога TravkinFlow</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Поиск материала</Label>
              <Input
                placeholder="Введите минимум 2 символа: название, производитель, ДВ..."
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
              />
              <p className="text-xs text-slate-500">
                Полный глобальный каталог не загружается. Сначала найдите нужный препарат, затем добавьте его в компанию.
              </p>
            </div>
            <div className="max-h-[420px] overflow-auto rounded-md border">
              <DataTable
                headers={["Название", "Тип", "Категория/подтип", "Производитель", "Статус"]}
                rows={catalogRows.map((x) => [
                  <div key={`${x.id}-name`}>
                    <div>{x.trade_name || x.name}</div>
                    {x.active_ingredient ? <div className="text-xs text-slate-500">{x.active_ingredient}</div> : null}
                  </div>,
                  materialKind(x),
                  materialCategory(x),
                  x.manufacturer || "—",
                  <div key={`${x.id}-actions`} className="flex items-center justify-end gap-2">
                    {materialKind(x) === "Пестицид" ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        title="Открыть полную карточку"
                        aria-label={`Открыть полную карточку ${x.trade_name || x.name}`}
                        onClick={() => void loadPesticideCard(x.id)}
                      >
                        <BookOpen className="h-4 w-4" />
                      </Button>
                    ) : null}
                    {x.source_scope === "company" ? (
                      <span className="text-sm text-slate-500">Уже добавлен</span>
                    ) : (
                      <Button size="sm" disabled={!!linkingGlobalId} onClick={() => addFromCatalog(x.id)}>
                        {linkingGlobalId === x.id ? "Добавление..." : "Добавить"}
                      </Button>
                    )}
                  </div>,
                ])}
                loading={catalogLoading}
                empty={catalogSearch.trim().length < 2 ? "Введите минимум 2 символа для поиска" : "Ничего не найдено"}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <FullPesticideCardDialog
        open={pesticideCardOpen}
        onOpenChange={setPesticideCardOpen}
        loading={pesticideCardLoading}
        error={pesticideCardError}
        card={pesticideCard}
        onRetry={() => selectedPesticideId && void loadPesticideCard(selectedPesticideId)}
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
              <div>
                <Label>Название</Label>
                <Input value={form.name || ""} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
              </div>
            ) : null}

            {modalType === "equipment" ? (
              <div>
                <Label>Категория</Label>
                <Input
                  value={form.category || ""}
                  placeholder="Например: сеялка, культиватор, транспортер"
                  onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                />
              </div>
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
