"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
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
  createCrop,
  createCompanyPerson,
  createMachineReference,
  createSeedReproduction,
  createSpecialistReference,
  createVariety,
  createVehicleReference,
  getGlobalVehicleBrands,
  getGlobalVehicleModels,
  getCompanyPeople,
  getCrops,
  getEquipmentReferences,
  getFertilizers,
  getMachineReferences,
  getPesticides,
  getSeedReproductions,
  getSpecialistReferences,
  getVarieties,
  getVehicleReferences,
  updateCompanyPerson,
  updateSpecialistReference,
  searchAgrochemicalMaster,
} from "@/lib/services/references";

type DomainTab = "agronomy" | "agrochemistry" | "machine-yard" | "fleet" | "personnel";
type AgronomyTab = "crops" | "varieties" | "reproductions";
type AgrochemTab = "master" | "company";
type MachineYardTab = "machines" | "equipment";
type FleetTab = "vehicles";
type PersonnelTab = "workers" | "specialists";
type ModalType = "crop" | "variety" | "reproduction" | "machine" | "vehicle" | "specialist" | "worker";

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

const vehicleTypeLabels: Record<string, string> = {
  truck: "Грузовик",
  grain_truck: "Зерновоз",
  dump_truck: "Самосвал",
  tractor_trailer: "Трактор с прицепом",
};

const personnelTypeLabels: Record<string, string> = {
  driver: "Водитель",
  machine_operator: "Механизатор",
};

const workerRoleLabels: Record<string, string> = {
  driver: "Водитель",
  machine_operator: "Механизатор",
  worker: "Рабочий",
  cook: "Повар",
  office: "Офис",
  guard: "Охрана",
  manager: "Руководитель",
  other: "Другое",
};

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

function DataTable(props: { headers: string[]; rows: string[][]; loading: boolean; empty: string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>{props.headers.map((header) => <TableHead key={header}>{header}</TableHead>)}</TableRow>
      </TableHeader>
      <TableBody>
        {props.loading ? (
          <TableRow><TableCell colSpan={props.headers.length} className="text-center text-slate-500">Загрузка...</TableCell></TableRow>
        ) : props.rows.length === 0 ? (
          <TableRow><TableCell colSpan={props.headers.length} className="text-center text-slate-500">{props.empty}</TableCell></TableRow>
        ) : (
          props.rows.map((row, rowIdx) => (
            <TableRow key={rowIdx}>
              {row.map((cell, cellIdx) => <TableCell key={`${rowIdx}-${cellIdx}`} className={cellIdx === 0 ? "font-medium" : ""}>{cell}</TableCell>)}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

export default function ReferencesPage() {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [linkingGlobalId, setLinkingGlobalId] = useState<string | null>(null);

  const [domainTab, setDomainTab] = useState<DomainTab>("agronomy");
  const [agronomyTab, setAgronomyTab] = useState<AgronomyTab>("crops");
  const [agrochemTab, setAgrochemTab] = useState<AgrochemTab>("master");
  const [machineYardTab, setMachineYardTab] = useState<MachineYardTab>("machines");
  const [fleetTab, setFleetTab] = useState<FleetTab>("vehicles");
  const [personnelTab, setPersonnelTab] = useState<PersonnelTab>("workers");
  const [modalType, setModalType] = useState<ModalType | null>(null);
  const [editingWorkerId, setEditingWorkerId] = useState<string | null>(null);

  const [searchMaster, setSearchMaster] = useState("");
  const [workerSearch, setWorkerSearch] = useState("");
  const [workerRoleFilter, setWorkerRoleFilter] = useState("all");
  const [workerStatusFilter, setWorkerStatusFilter] = useState("active");

  const [crops, setCrops] = useState<any[]>([]);
  const [varieties, setVarieties] = useState<any[]>([]);
  const [reproductions, setReproductions] = useState<any[]>([]);
  const [pesticides, setPesticides] = useState<any[]>([]);
  const [fertilizers, setFertilizers] = useState<any[]>([]);
  const [agroMasterRows, setAgroMasterRows] = useState<any[]>([]);
  const [machines, setMachines] = useState<any[]>([]);
  const [equipment, setEquipment] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [workers, setWorkers] = useState<any[]>([]);
  const [specialists, setSpecialists] = useState<any[]>([]);
  const [globalBrands, setGlobalBrands] = useState<any[]>([]);
  const [globalModels, setGlobalModels] = useState<any[]>([]);

  const [form, setForm] = useState<Record<string, string>>({});

  const currentAction = useMemo(() => {
    if (domainTab === "agronomy") {
      if (agronomyTab === "crops") return { label: "Добавить культуру", modal: "crop" as const };
      if (agronomyTab === "varieties") return { label: "Добавить сорт", modal: "variety" as const };
      return { label: "Добавить репродукцию", modal: "reproduction" as const };
    }
    if (domainTab === "machine-yard") {
      if (machineYardTab === "machines") return { label: "Добавить технику", modal: "machine" as const };
      return null;
    }
    if (domainTab === "fleet" && fleetTab === "vehicles") return { label: "Добавить машину", modal: "vehicle" as const };
    if (domainTab === "personnel" && personnelTab === "workers") return { label: "Добавить работника", modal: "worker" as const };
    if (domainTab === "personnel" && personnelTab === "specialists") return { label: "Добавить водителя/механизатора", modal: "specialist" as const };
    return null;
  }, [domainTab, agronomyTab, machineYardTab, fleetTab, personnelTab]);

  const loadAll = async () => {
    if (!profile?.company_id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [cropRows, varietyRows, reprRows, pesticideRows, fertilizerRows, machineRows, equipmentRows, vehicleRows, workerRows, specialistRows, brandRows, modelRows] = await Promise.all([
        getCrops(profile.company_id, false, "ru"),
        getVarieties(profile.company_id, false, "ru"),
        getSeedReproductions(profile.company_id, false, "ru"),
        getPesticides(profile.company_id, false, "ru"),
        getFertilizers(profile.company_id, false, "ru"),
        getMachineReferences(profile.company_id, false, "ru"),
        getEquipmentReferences(profile.company_id, false, "ru"),
        getVehicleReferences(profile.company_id, false),
        getCompanyPeople(profile.company_id, true),
        getSpecialistReferences(profile.company_id, false),
        getGlobalVehicleBrands(),
        getGlobalVehicleModels(),
      ]);
      setCrops(cropRows);
      setVarieties(varietyRows);
      setReproductions(reprRows);
      setPesticides(pesticideRows);
      setFertilizers(fertilizerRows);
      setMachines(machineRows);
      setEquipment(equipmentRows);
      setVehicles(vehicleRows);
      setWorkers(workerRows);
      setSpecialists(specialistRows);
      setGlobalBrands(brandRows);
      setGlobalModels(modelRows);
    } finally {
      setLoading(false);
    }
  };

  const loadMasterCatalog = async () => {
    if (!profile?.company_id) return;
    const [pRows, fRows] = await Promise.all([
      searchAgrochemicalMaster(profile.company_id, "pesticide", searchMaster, "ru"),
      searchAgrochemicalMaster(profile.company_id, "fertilizer", searchMaster, "ru"),
    ]);
    setAgroMasterRows([...pRows, ...fRows].filter((row) => row.source_scope === "global"));
  };

  useEffect(() => {
    void loadAll();
  }, [profile?.company_id]);

  useEffect(() => {
    void loadMasterCatalog();
  }, [profile?.company_id, searchMaster]);

  const filteredWorkers = useMemo(() => {
    const query = workerSearch.trim().toLowerCase();
    return workers.filter((worker) => {
      const matchesSearch = !query || [
        worker.full_name,
        worker.short_name,
        worker.phone,
        worker.notes,
      ].some((value) => String(value || "").toLowerCase().includes(query));
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

  const submitCreate = async () => {
    if (!profile?.company_id || !profile?.id || !modalType || saving) return;
    setSaving(true);
    try {
      if (modalType === "crop") {
        if (!form.name?.trim()) throw new Error("Укажите название культуры");
        await createCrop(profile.company_id, { name: form.name.trim() });
      }
      if (modalType === "variety") {
        if (!form.name?.trim()) throw new Error("Укажите название сорта");
        if (!form.crop_id) throw new Error("Сорт должен быть привязан к культуре");
        await createVariety(profile.company_id, { name: form.name.trim(), crop_id: form.crop_id });
      }
      if (modalType === "reproduction") {
        if (!form.name?.trim()) throw new Error("Укажите название репродукции");
        await createSeedReproduction(profile.company_id, { name: form.name.trim() });
      }
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
      if (modalType === "vehicle") {
        if (!form.name?.trim()) throw new Error("Укажите название машины");
        if (!form.plate_number?.trim()) throw new Error("Укажите госномер");
        await createVehicleReference(profile.company_id, profile.id, {
          name: form.name.trim(),
          global_brand_id: form.global_brand_id || null,
          global_model_id: form.global_model_id || null,
          custom_name: form.custom_name || form.name.trim(),
          inventory_number: form.inventory_number || "",
          primary_responsible_personnel_id: form.primary_responsible_personnel_id || null,
          vehicle_type: (form.vehicle_type || "truck") as any,
          plate_number: form.plate_number.trim(),
          capacity_kg: Number(form.capacity_kg || 0),
          body_volume_m3: null,
          status: "free",
          is_active: true,
        });
      }
      if (modalType === "specialist") {
        if (!form.full_name?.trim()) throw new Error("Укажите ФИО");
        const created = await createSpecialistReference(profile.company_id, profile.id, {
          full_name: form.full_name.trim(),
          role: form.role || "",
          personnel_type: (form.personnel_type || "driver") as any,
          phone: form.phone || "",
          status: (form.status || "active") as any,
          note: form.note || "",
          assigned_vehicle_ids: [],
          machine_id: "",
          equipment_id: "",
        });
        const assignedVehicleIds = String(form.assigned_vehicle_ids || "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
        if (assignedVehicleIds.length > 0) {
          await updateSpecialistReference(created.id, {
            full_name: created.full_name,
            role: created.role || "",
            personnel_type: (created.personnel_type || "driver") as any,
            phone: created.phone || "",
            status: (created.status || "active") as any,
            note: created.note || "",
            assigned_vehicle_ids: assignedVehicleIds,
            machine_id: "",
            equipment_id: "",
          });
        }
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
        description: error instanceof Error ? error.message : "Не удалось создать запись",
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
      toast({ title: "Готово", description: "Работник перенесён в архив" });
    } catch (error) {
      toast({ title: "Ошибка", description: error instanceof Error ? error.message : "Не удалось архивировать работника", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const addFromMaster = async (productId: string) => {
    if (!profile?.company_id || !profile?.id || linkingGlobalId) return;
    setLinkingGlobalId(productId);
    try {
      await addGlobalAgrochemicalToCompany(profile.company_id, profile.id, productId);
      await loadAll();
      toast({ title: "Готово", description: "Препарат добавлен в каталог компании" });
    } catch (error) {
      toast({ title: "Ошибка", description: error instanceof Error ? error.message : "Не удалось добавить в компанию", variant: "destructive" });
    } finally {
      setLinkingGlobalId(null);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Справочники" description="Управление доменами: Агрономия, Агрохимия, Машинный двор, Автопарк, Персонал" />

      <Tabs value={domainTab} onValueChange={(value) => setDomainTab(value as DomainTab)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList className="w-full justify-start overflow-auto md:w-auto">
            <TabsTrigger value="agronomy">Агрономия</TabsTrigger>
            <TabsTrigger value="agrochemistry">Агрохимия</TabsTrigger>
            <TabsTrigger value="machine-yard">Машинный двор</TabsTrigger>
            <TabsTrigger value="fleet">Автопарк</TabsTrigger>
            <TabsTrigger value="personnel">Персонал</TabsTrigger>
          </TabsList>
          {currentAction ? (
            <Button onClick={() => openModal(currentAction.modal)} disabled={saving}>
              {saving ? "Сохранение..." : currentAction.label}
            </Button>
          ) : null}
        </div>

        <TabsContent value="agronomy" className="space-y-4">
          <Tabs value={agronomyTab} onValueChange={(value) => setAgronomyTab(value as AgronomyTab)}>
            <TabsList>
              <TabsTrigger value="crops">Культуры</TabsTrigger>
              <TabsTrigger value="varieties">Сорта</TabsTrigger>
              <TabsTrigger value="reproductions">Репродукции</TabsTrigger>
            </TabsList>
            <TabsContent value="crops">
              <Card>
                <CardHeader><CardTitle>Культуры компании</CardTitle></CardHeader>
                <CardContent><DataTable headers={["Название"]} rows={crops.map((x) => [x.name])} loading={loading} empty="Культуры не добавлены" /></CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="varieties">
              <Card>
                <CardHeader><CardTitle>Сорта (обязательно с привязкой к культуре)</CardTitle></CardHeader>
                <CardContent><DataTable headers={["Культура", "Сорт"]} rows={varieties.map((x) => [x.crop_name || "-", x.name])} loading={loading} empty="Сорта не добавлены" /></CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="reproductions">
              <Card>
                <CardHeader><CardTitle>Репродукции</CardTitle></CardHeader>
                <CardContent><DataTable headers={["Название"]} rows={reproductions.map((x) => [x.name])} loading={loading} empty="Репродукции не добавлены" /></CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="agrochemistry" className="space-y-4">
          <Card className="border-dashed">
            <CardContent className="pt-6 text-sm text-slate-600">
              Агрохимия работает только через глобальный каталог AgriManager. Создание пестицидов и удобрений в компании запрещено.
            </CardContent>
          </Card>
          <Tabs value={agrochemTab} onValueChange={(value) => setAgrochemTab(value as AgrochemTab)}>
            <TabsList>
              <TabsTrigger value="master">Каталог AgriManager</TabsTrigger>
              <TabsTrigger value="company">Используется в компании</TabsTrigger>
            </TabsList>
            <TabsContent value="master" className="space-y-3">
              <Input placeholder="Поиск по глобальному каталогу..." value={searchMaster} onChange={(e) => setSearchMaster(e.target.value)} className="max-w-md" />
              <Card>
                <CardHeader><CardTitle>Глобальные пестициды и удобрения</CardTitle></CardHeader>
                <CardContent>
                  <DataTable
                    headers={["Название", "Тип", "Категория/Тип", "ДВ", "Действие"]}
                    rows={agroMasterRows.map((x) => [
                      x.trade_name || x.name,
                      x.type === "pesticide" ? "Пестицид" : "Удобрение",
                      x.type === "pesticide" ? pesticideCategoryLabels[x.pesticide_category || ""] || "-" : fertilizerTypeLabels[x.fertilizer_type || ""] || "-",
                      x.active_ingredient || "-",
                      linkingGlobalId === x.id ? "Добавление..." : "Добавить в компанию",
                    ])}
                    loading={loading}
                    empty="Глобальные записи не найдены"
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    {agroMasterRows.map((x) => (
                      <Button key={x.id} variant="outline" size="sm" disabled={!!linkingGlobalId} onClick={() => addFromMaster(x.id)}>
                        {linkingGlobalId === x.id ? "Добавление..." : `Добавить: ${x.trade_name || x.name}`}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="company">
              <Card>
                <CardHeader><CardTitle>Подключенные продукты компании</CardTitle></CardHeader>
                <CardContent>
                  <DataTable
                    headers={["Название", "Тип", "Категория/Тип", "ДВ"]}
                    rows={[...pesticides, ...fertilizers].map((x) => [
                      x.trade_name || x.name,
                      x.type === "pesticide" ? "Пестицид" : "Удобрение",
                      x.type === "pesticide" ? pesticideCategoryLabels[x.pesticide_category || ""] || "-" : fertilizerTypeLabels[x.fertilizer_type || ""] || "-",
                      x.active_ingredient || "-",
                    ])}
                    loading={loading}
                    empty="В компании еще нет подключенных агрохимических продуктов"
                  />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="machine-yard">
          <Tabs value={machineYardTab} onValueChange={(value) => setMachineYardTab(value as MachineYardTab)}>
            <TabsList>
              <TabsTrigger value="machines">Техника</TabsTrigger>
              <TabsTrigger value="equipment">Оборудование</TabsTrigger>
            </TabsList>
            <TabsContent value="machines">
              <Card>
                <CardHeader><CardTitle>Техника</CardTitle></CardHeader>
                <CardContent><DataTable headers={["Название", "Тип"]} rows={machines.map((x) => [x.name, x.type])} loading={loading} empty="Техника не добавлена" /></CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="equipment">
              <Card>
                <CardHeader><CardTitle>Оборудование</CardTitle></CardHeader>
                <CardContent><DataTable headers={["Название", "Категория"]} rows={equipment.map((x) => [x.name, x.category || "-"])} loading={loading} empty="Оборудование не добавлено" /></CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="fleet">
          <Tabs value={fleetTab} onValueChange={(value) => setFleetTab(value as FleetTab)}>
            <TabsList><TabsTrigger value="vehicles">Машины</TabsTrigger></TabsList>
            <TabsContent value="vehicles">
              <Card>
                <CardHeader><CardTitle>Автопарк</CardTitle></CardHeader>
                <CardContent>
                  <DataTable
                    headers={["Название", "Тип", "Госномер", "Грузоподъемность (кг)"]}
                    rows={vehicles.map((x) => [x.name, vehicleTypeLabels[x.vehicle_type] || x.vehicle_type, x.plate_number || "-", x.capacity_kg == null ? "-" : String(x.capacity_kg), x.primary_responsible?.full_name || "-", x.is_active ? "Активна" : "Неактивна"])}
                    loading={loading}
                    empty="Машины не добавлены"
                  />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="personnel">
          <Tabs value={personnelTab} onValueChange={(value) => setPersonnelTab(value as PersonnelTab)}>
            <TabsList>
              <TabsTrigger value="workers">Работники</TabsTrigger>
              <TabsTrigger value="specialists">Водители и механизаторы</TabsTrigger>
            </TabsList>
            <TabsContent value="workers">
              <Card>
                <CardHeader>
                  <CardTitle>Работники компании</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_180px_160px]">
                    <Input
                      placeholder="Поиск по ФИО, телефону или заметке..."
                      value={workerSearch}
                      onChange={(e) => setWorkerSearch(e.target.value)}
                    />
                    <Select value={workerRoleFilter} onValueChange={setWorkerRoleFilter}>
                      <SelectTrigger><SelectValue placeholder="Роль" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Все роли</SelectItem>
                        {Object.entries(workerRoleLabels).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={workerStatusFilter} onValueChange={setWorkerStatusFilter}>
                      <SelectTrigger><SelectValue placeholder="Статус" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Все статусы</SelectItem>
                        {Object.entries(workerStatusLabels).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
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
                        <TableRow><TableCell colSpan={7} className="text-center text-slate-500">Загрузка...</TableCell></TableRow>
                      ) : filteredWorkers.length === 0 ? (
                        <TableRow><TableCell colSpan={7} className="text-center text-slate-500">Работники не найдены</TableCell></TableRow>
                      ) : (
                        filteredWorkers.map((worker) => (
                          <TableRow key={worker.id}>
                            <TableCell className="font-medium">
                              <div>{worker.full_name}</div>
                              {worker.short_name ? <div className="text-xs text-slate-500">{worker.short_name}</div> : null}
                            </TableCell>
                            <TableCell>{workerRoleLabels[worker.role_type] || worker.role_type}</TableCell>
                            <TableCell>{employmentTypeLabels[worker.employment_type] || worker.employment_type}</TableCell>
                            <TableCell>{worker.phone || "-"}</TableCell>
                            <TableCell>{workerStatusLabels[worker.status] || worker.status}</TableCell>
                            <TableCell className="max-w-[260px] truncate">{worker.notes || "-"}</TableCell>
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
            <TabsContent value="specialists">
              <Card>
                <CardHeader><CardTitle>Совместимость: водители и механизаторы</CardTitle></CardHeader>
                <CardContent>
                  <DataTable
                    headers={["ФИО", "Тип", "Телефон", "Статус"]}
                    rows={specialists.map((x) => [
                      x.full_name,
                      personnelTypeLabels[x.personnel_type || ""] || x.role || "-",
                      x.phone || "-",
                      x.status === "inactive" ? "Неактивен" : "Активен",
                    ])}
                    loading={loading}
                    empty="Водители и механизаторы не добавлены"
                  />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>

      <Dialog open={!!modalType} onOpenChange={(open) => !open && !saving && closeModal()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {modalType === "crop" ? "Добавить культуру" : null}
              {modalType === "variety" ? "Добавить сорт" : null}
              {modalType === "reproduction" ? "Добавить репродукцию" : null}
              {modalType === "machine" ? "Добавить технику" : null}
              {modalType === "vehicle" ? "Добавить машину" : null}
              {modalType === "specialist" ? "Добавить специалиста" : null}
              {modalType === "worker" ? (editingWorkerId ? "Изменить работника" : "Добавить работника") : null}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {modalType === "crop" || modalType === "reproduction" || modalType === "machine" || modalType === "vehicle" ? (
              <div>
                <Label>Название</Label>
                <Input value={form.name || ""} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
              </div>
            ) : null}

            {modalType === "specialist" ? (
              <div>
                <Label>ФИО</Label>
                <Input value={form.full_name || ""} onChange={(e) => setForm((prev) => ({ ...prev, full_name: e.target.value }))} />
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
                      <SelectTrigger><SelectValue placeholder="Выберите роль" /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(workerRoleLabels).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Тип занятости</Label>
                    <Select value={form.employment_type || "unknown"} onValueChange={(value) => setForm((prev) => ({ ...prev, employment_type: value }))}>
                      <SelectTrigger><SelectValue placeholder="Выберите тип" /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(employmentTypeLabels).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
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
                      <SelectTrigger><SelectValue placeholder="Выберите статус" /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(workerStatusLabels).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
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

            {modalType === "variety" ? (
              <>
                <div>
                  <Label>Название сорта</Label>
                  <Input value={form.name || ""} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
                </div>
                <div>
                  <Label>Культура (обязательно)</Label>
                  <Select value={form.crop_id || ""} onValueChange={(value) => setForm((prev) => ({ ...prev, crop_id: value }))}>
                    <SelectTrigger><SelectValue placeholder="Выберите культуру" /></SelectTrigger>
                    <SelectContent>{crops.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
                  </Select>
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
                  <Label>Грузоподъемность (кг)</Label>
                  <Input type="number" value={form.capacity_kg || ""} onChange={(e) => setForm((prev) => ({ ...prev, capacity_kg: e.target.value }))} />
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
