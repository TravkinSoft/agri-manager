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
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/contexts/auth-context";
import {
  addGlobalAgrochemicalToCompany,
  createCrop,
  createMachineReference,
  createSeedReproduction,
  createSpecialistReference,
  createVariety,
  createVehicleReference,
  getCrops,
  getEquipmentReferences,
  getFertilizers,
  getMachineReferences,
  getPesticides,
  getSeedReproductions,
  getSpecialistReferences,
  getVarieties,
  getVehicleReferences,
  searchAgrochemicalMaster,
} from "@/lib/services/references";

type DomainTab = "agronomy" | "agrochemistry" | "machine-yard" | "fleet" | "personnel";
type AgronomyTab = "crops" | "varieties" | "reproductions";
type AgrochemTab = "master" | "company";
type MachineYardTab = "machines" | "equipment";
type FleetTab = "vehicles";
type PersonnelTab = "specialists";
type ModalType = "crop" | "variety" | "reproduction" | "machine" | "vehicle" | "specialist";

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
  const [personnelTab, setPersonnelTab] = useState<PersonnelTab>("specialists");
  const [modalType, setModalType] = useState<ModalType | null>(null);

  const [searchMaster, setSearchMaster] = useState("");

  const [crops, setCrops] = useState<any[]>([]);
  const [varieties, setVarieties] = useState<any[]>([]);
  const [reproductions, setReproductions] = useState<any[]>([]);
  const [pesticides, setPesticides] = useState<any[]>([]);
  const [fertilizers, setFertilizers] = useState<any[]>([]);
  const [agroMasterRows, setAgroMasterRows] = useState<any[]>([]);
  const [machines, setMachines] = useState<any[]>([]);
  const [equipment, setEquipment] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [specialists, setSpecialists] = useState<any[]>([]);

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
    if (domainTab === "personnel" && personnelTab === "specialists") return { label: "Добавить специалиста", modal: "specialist" as const };
    return null;
  }, [domainTab, agronomyTab, machineYardTab, fleetTab, personnelTab]);

  const loadAll = async () => {
    if (!profile?.company_id) return;
    setLoading(true);
    try {
      const [cropRows, varietyRows, reprRows, pesticideRows, fertilizerRows, machineRows, equipmentRows, vehicleRows, specialistRows] = await Promise.all([
        getCrops(profile.company_id, false, "ru"),
        getVarieties(profile.company_id, false, "ru"),
        getSeedReproductions(profile.company_id, false, "ru"),
        getPesticides(profile.company_id, false, "ru"),
        getFertilizers(profile.company_id, false, "ru"),
        getMachineReferences(profile.company_id, false, "ru"),
        getEquipmentReferences(profile.company_id, false, "ru"),
        getVehicleReferences(profile.company_id, false),
        getSpecialistReferences(profile.company_id, false),
      ]);
      setCrops(cropRows);
      setVarieties(varietyRows);
      setReproductions(reprRows);
      setPesticides(pesticideRows);
      setFertilizers(fertilizerRows);
      setMachines(machineRows);
      setEquipment(equipmentRows);
      setVehicles(vehicleRows);
      setSpecialists(specialistRows);
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

  const openModal = (type: ModalType) => {
    setModalType(type);
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
          vehicle_type: (form.vehicle_type || "truck") as any,
          plate_number: form.plate_number.trim(),
          capacity_kg: Number(form.capacity_kg || 1),
          body_volume_m3: null,
          status: "free",
          is_active: true,
        });
      }
      if (modalType === "specialist") {
        if (!form.full_name?.trim()) throw new Error("Укажите ФИО");
        await createSpecialistReference(profile.company_id, profile.id, {
          full_name: form.full_name.trim(),
          role: form.role || "",
          machine_id: "",
          equipment_id: "",
        });
      }
      setModalType(null);
      setForm({});
      await loadAll();
      toast({ title: "Готово", description: "Запись успешно создана" });
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
                    rows={vehicles.map((x) => [x.name, vehicleTypeLabels[x.vehicle_type] || x.vehicle_type, x.plate_number, String(x.capacity_kg)])}
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
            <TabsList><TabsTrigger value="specialists">Специалисты</TabsTrigger></TabsList>
            <TabsContent value="specialists">
              <Card>
                <CardHeader><CardTitle>Персонал</CardTitle></CardHeader>
                <CardContent><DataTable headers={["ФИО", "Роль"]} rows={specialists.map((x) => [x.full_name, x.role || "-"])} loading={loading} empty="Специалисты не добавлены" /></CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>

      <Dialog open={!!modalType} onOpenChange={(open) => !open && !saving && setModalType(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {modalType === "crop" ? "Добавить культуру" : null}
              {modalType === "variety" ? "Добавить сорт" : null}
              {modalType === "reproduction" ? "Добавить репродукцию" : null}
              {modalType === "machine" ? "Добавить технику" : null}
              {modalType === "vehicle" ? "Добавить машину" : null}
              {modalType === "specialist" ? "Добавить специалиста" : null}
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
            <Button variant="outline" onClick={() => !saving && setModalType(null)} disabled={saving}>
              Отмена
            </Button>
            <Button onClick={submitCreate} disabled={saving}>
              {saving ? "Сохранение..." : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
