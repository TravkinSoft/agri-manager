"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowRightLeft, Droplets, Fuel, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/contexts/auth-context";
import {
  createFuelIssue,
  createFuelSource,
  createFuelTransfer,
  getFuelBootstrap,
  upsertFuelLimit,
} from "@/lib/services/fuel";
import type { FuelBootstrap, FuelType } from "@/lib/types/fuel";

type FuelSourceType = "stationary_azs" | "barrel" | "fuel_truck" | "mobile_tank";
type LimitTarget = "vehicle" | "mechanizator";

const FUEL_LABELS: Record<FuelType, string> = {
  diesel: "ДТ",
  gasoline: "Бензин",
  adblue: "AdBlue",
  oil: "Масло",
  other: "Другое",
};

const SOURCE_TYPE_LABELS: Record<FuelSourceType, string> = {
  stationary_azs: "Стационарная АЗС",
  barrel: "Бочка",
  fuel_truck: "Топливозаправщик",
  mobile_tank: "Мобильная ёмкость",
};

const canOpenFuelModule = (role?: string | null) =>
  role === "global_admin" ||
  role === "company_admin" ||
  role === "warehouse" ||
  role === "fuel_operator";

const liters = (value: number) => `${Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} л`;
const dateTime = (value?: string | null) => {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
};

export default function FuelPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [savingIssue, setSavingIssue] = useState(false);
  const [savingTransfer, setSavingTransfer] = useState(false);
  const [savingLimit, setSavingLimit] = useState(false);
  const [savingSource, setSavingSource] = useState(false);
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false);
  const [bootstrap, setBootstrap] = useState<FuelBootstrap>({
    sources: [],
    vehicles: [],
    mechanizators: [],
    recentIssues: [],
    recentTransfers: [],
    limits: [],
  });

  const [issueForm, setIssueForm] = useState({
    fuelSourceId: "",
    vehicleId: "",
    mechanizatorId: "",
    liters: "",
    comment: "",
  });
  const [transferForm, setTransferForm] = useState({
    fromFuelSourceId: "",
    toFuelSourceId: "",
    liters: "",
    operatorPersonnelId: "",
    comment: "",
  });
  const [limitForm, setLimitForm] = useState({
    fuelType: "diesel" as FuelType,
    periodMonth: new Date().toISOString().slice(0, 7),
    target: "vehicle" as LimitTarget,
    vehicleId: "",
    mechanizatorId: "",
    limitLiters: "",
    note: "",
  });
  const [sourceForm, setSourceForm] = useState({
    name: "",
    sourceType: "stationary_azs" as FuelSourceType,
    fuelType: "diesel" as FuelType,
    currentBalanceLiters: "",
    capacityLiters: "",
    location: "",
    assignedVehicleId: "",
  });

  const companyId = profile?.company_id || "";
  const actorUserId = profile?.id || "";
  const canUse = canOpenFuelModule(profile?.role);

  const sourceMap = useMemo(
    () => new Map(bootstrap.sources.map((source) => [source.id, source])),
    [bootstrap.sources],
  );
  const vehicleMap = useMemo(
    () => new Map(bootstrap.vehicles.map((vehicle) => [vehicle.id, vehicle])),
    [bootstrap.vehicles],
  );

  const selectedIssueSource = issueForm.fuelSourceId ? sourceMap.get(issueForm.fuelSourceId) : null;
  const selectedTransferSource = transferForm.fromFuelSourceId ? sourceMap.get(transferForm.fromFuelSourceId) : null;
  const selectedVehicle = issueForm.vehicleId ? vehicleMap.get(issueForm.vehicleId) : null;

  const reload = async () => {
    if (!companyId || !actorUserId || !canUse) return;
    setLoading(true);
    try {
      const data = await getFuelBootstrap(companyId, actorUserId);
      setBootstrap(data);
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось загрузить данные АЗС / ГСМ",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, [companyId, actorUserId, canUse]);

  const onVehicleChange = (vehicleId: string) => {
    const vehicle = vehicleMap.get(vehicleId);
    setIssueForm((prev) => ({
      ...prev,
      vehicleId,
      mechanizatorId: vehicle?.primary_responsible_personnel_id || prev.mechanizatorId || "",
    }));
  };

  const submitIssue = async () => {
    if (!companyId || !actorUserId) return;
    const litersValue = Number(issueForm.liters || 0);
    if (!issueForm.fuelSourceId || !issueForm.vehicleId) {
      toast({ title: "Ошибка", description: "Выберите источник топлива и технику.", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(litersValue) || litersValue <= 0) {
      toast({ title: "Ошибка", description: "Литры должны быть больше нуля.", variant: "destructive" });
      return;
    }
    if (selectedIssueSource && litersValue > Number(selectedIssueSource.current_balance_liters || 0)) {
      toast({ title: "Ошибка", description: "Нельзя выдать больше, чем остаток в источнике.", variant: "destructive" });
      return;
    }

    setSavingIssue(true);
    try {
      await createFuelIssue({
        companyId,
        actorUserId,
        fuelSourceId: issueForm.fuelSourceId,
        vehicleId: issueForm.vehicleId,
        mechanizatorId: issueForm.mechanizatorId || null,
        liters: litersValue,
        comment: issueForm.comment || null,
      });
      toast({ title: "Готово", description: "Выдача топлива сохранена." });
      setIssueForm((prev) => ({ ...prev, liters: "", comment: "" }));
      await reload();
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось выдать топливо",
        variant: "destructive",
      });
    } finally {
      setSavingIssue(false);
    }
  };

  const submitTransfer = async () => {
    if (!companyId || !actorUserId) return;
    const litersValue = Number(transferForm.liters || 0);
    if (!transferForm.fromFuelSourceId || !transferForm.toFuelSourceId) {
      toast({ title: "Ошибка", description: "Выберите источник и приёмник топлива.", variant: "destructive" });
      return;
    }
    if (transferForm.fromFuelSourceId === transferForm.toFuelSourceId) {
      toast({ title: "Ошибка", description: "Источник и приёмник не могут совпадать.", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(litersValue) || litersValue <= 0) {
      toast({ title: "Ошибка", description: "Литры должны быть больше нуля.", variant: "destructive" });
      return;
    }
    if (selectedTransferSource && litersValue > Number(selectedTransferSource.current_balance_liters || 0)) {
      toast({ title: "Ошибка", description: "Недостаточно топлива в источнике.", variant: "destructive" });
      return;
    }

    setSavingTransfer(true);
    try {
      await createFuelTransfer({
        companyId,
        actorUserId,
        fromFuelSourceId: transferForm.fromFuelSourceId,
        toFuelSourceId: transferForm.toFuelSourceId,
        liters: litersValue,
        operatorPersonnelId: transferForm.operatorPersonnelId || null,
        comment: transferForm.comment || null,
      });
      toast({ title: "Готово", description: "Перемещение топлива выполнено." });
      setTransferForm((prev) => ({ ...prev, liters: "", comment: "" }));
      await reload();
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось переместить топливо",
        variant: "destructive",
      });
    } finally {
      setSavingTransfer(false);
    }
  };

  const submitLimit = async () => {
    if (!companyId || !actorUserId) return;
    const limitLiters = Number(limitForm.limitLiters || 0);
    const periodMonth = `${limitForm.periodMonth}-01`;
    if (!Number.isFinite(limitLiters) || limitLiters <= 0) {
      toast({ title: "Ошибка", description: "Лимит должен быть больше нуля.", variant: "destructive" });
      return;
    }
    if (limitForm.target === "vehicle" && !limitForm.vehicleId) {
      toast({ title: "Ошибка", description: "Выберите технику для лимита.", variant: "destructive" });
      return;
    }
    if (limitForm.target === "mechanizator" && !limitForm.mechanizatorId) {
      toast({ title: "Ошибка", description: "Выберите механизатора для лимита.", variant: "destructive" });
      return;
    }

    setSavingLimit(true);
    try {
      await upsertFuelLimit({
        companyId,
        actorUserId,
        periodMonth,
        fuelType: limitForm.fuelType,
        vehicleId: limitForm.target === "vehicle" ? limitForm.vehicleId : null,
        mechanizatorId: limitForm.target === "mechanizator" ? limitForm.mechanizatorId : null,
        limitLiters,
        note: limitForm.note || null,
      });
      toast({ title: "Готово", description: "Лимитка сохранена." });
      setLimitForm((prev) => ({ ...prev, limitLiters: "", note: "" }));
      await reload();
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось сохранить лимит",
        variant: "destructive",
      });
    } finally {
      setSavingLimit(false);
    }
  };

  const submitNewSource = async () => {
    if (!companyId || !actorUserId) return;
    const currentBalanceLiters = sourceForm.currentBalanceLiters === "" ? 0 : Number(sourceForm.currentBalanceLiters);
    const capacityLiters = sourceForm.capacityLiters === "" ? null : Number(sourceForm.capacityLiters);
    if (!sourceForm.name.trim()) {
      toast({ title: "Ошибка", description: "Введите название ёмкости.", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(currentBalanceLiters) || currentBalanceLiters < 0) {
      toast({ title: "Ошибка", description: "Некорректный остаток топлива.", variant: "destructive" });
      return;
    }
    if (capacityLiters != null && (!Number.isFinite(capacityLiters) || capacityLiters < 0)) {
      toast({ title: "Ошибка", description: "Некорректная вместимость.", variant: "destructive" });
      return;
    }

    setSavingSource(true);
    try {
      await createFuelSource({
        companyId,
        actorUserId,
        name: sourceForm.name.trim(),
        sourceType: sourceForm.sourceType,
        fuelType: sourceForm.fuelType,
        currentBalanceLiters,
        capacityLiters,
        location: sourceForm.location || null,
        assignedVehicleId: sourceForm.assignedVehicleId || null,
        isActive: true,
      });
      toast({ title: "Готово", description: "Топливная ёмкость создана." });
      setSourceDialogOpen(false);
      setSourceForm({
        name: "",
        sourceType: "stationary_azs",
        fuelType: "diesel",
        currentBalanceLiters: "",
        capacityLiters: "",
        location: "",
        assignedVehicleId: "",
      });
      await reload();
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось создать топливную ёмкость",
        variant: "destructive",
      });
    } finally {
      setSavingSource(false);
    }
  };

  if (!canUse) {
    return (
      <div className="space-y-6">
        <PageHeader title="АЗС / ГСМ" description="Операционный терминал заправщика" />
        <Alert variant="destructive">
          <AlertDescription>Доступ запрещён для текущей роли.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="АЗС / ГСМ" description="Выдача топлива, перемещения между ёмкостями и лимитка">
        <Button onClick={() => setSourceDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Новая ёмкость
        </Button>
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {bootstrap.sources.map((source) => (
          <Card key={source.id} className="border-slate-200">
            <CardContent className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900">{source.name}</div>
                  <div className="text-xs text-slate-500">{SOURCE_TYPE_LABELS[source.source_type as FuelSourceType] || source.source_type}</div>
                </div>
                <Badge variant="outline">{FUEL_LABELS[source.fuel_type as FuelType] || source.fuel_type}</Badge>
              </div>
              <div className="text-xl font-semibold text-slate-950">{liters(source.current_balance_liters)}</div>
              <div className="text-xs text-slate-500">{source.capacity_liters ? `Вместимость: ${liters(source.capacity_liters)}` : "Вместимость не задана"}</div>
            </CardContent>
          </Card>
        ))}
        {!bootstrap.sources.length && !loading ? (
          <Card className="sm:col-span-2 xl:col-span-4">
            <CardContent className="p-5 text-sm text-slate-500">Источники топлива ещё не добавлены.</CardContent>
          </Card>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Fuel className="h-4 w-4 text-emerald-700" />
              Выдача топлива
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Источник топлива *</Label>
                <Select value={issueForm.fuelSourceId} onValueChange={(value) => setIssueForm((prev) => ({ ...prev, fuelSourceId: value }))}>
                  <SelectTrigger><SelectValue placeholder="Выберите ёмкость" /></SelectTrigger>
                  <SelectContent>
                    {bootstrap.sources.map((source) => (
                      <SelectItem key={source.id} value={source.id}>
                        {source.name} · {FUEL_LABELS[source.fuel_type as FuelType]} · {liters(source.current_balance_liters)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Техника / машина *</Label>
                <Select value={issueForm.vehicleId} onValueChange={onVehicleChange}>
                  <SelectTrigger><SelectValue placeholder="Выберите технику" /></SelectTrigger>
                  <SelectContent>
                    {bootstrap.vehicles.map((vehicle) => (
                      <SelectItem key={vehicle.id} value={vehicle.id}>
                        {vehicle.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Механизатор</Label>
                <Select value={issueForm.mechanizatorId || "none"} onValueChange={(value) => setIssueForm((prev) => ({ ...prev, mechanizatorId: value === "none" ? "" : value }))}>
                  <SelectTrigger><SelectValue placeholder="Можно оставить пустым" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Без привязки</SelectItem>
                    {bootstrap.mechanizators.map((person) => (
                      <SelectItem key={person.id} value={person.id}>
                        {person.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Литры *</Label>
                <Input
                  className="h-11 text-lg font-semibold"
                  type="number"
                  min={0}
                  step="0.001"
                  value={issueForm.liters}
                  onChange={(event) => setIssueForm((prev) => ({ ...prev, liters: event.target.value }))}
                  placeholder="0"
                />
              </div>
            </div>
            {selectedIssueSource ? (
              <div className="rounded-md border bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Остаток в источнике: <span className="font-semibold text-slate-900">{liters(selectedIssueSource.current_balance_liters)}</span>
              </div>
            ) : null}
            {selectedVehicle?.primary_responsible_personnel_id ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                Для выбранной техники найден закреплённый механизатор. Поле заполнено автоматически и при необходимости можно изменить вручную.
              </div>
            ) : null}
            <div className="space-y-1">
              <Label>Комментарий</Label>
              <Input value={issueForm.comment} onChange={(event) => setIssueForm((prev) => ({ ...prev, comment: event.target.value }))} placeholder="Опционально" />
            </div>
            <Button className="w-full" onClick={submitIssue} disabled={savingIssue || loading}>
              {savingIssue ? "Сохраняем..." : "ВЫДАТЬ ТОПЛИВО"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowRightLeft className="h-4 w-4 text-indigo-700" />
              Перемещение топлива между ёмкостями
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Откуда *</Label>
                <Select value={transferForm.fromFuelSourceId} onValueChange={(value) => setTransferForm((prev) => ({ ...prev, fromFuelSourceId: value }))}>
                  <SelectTrigger><SelectValue placeholder="Источник" /></SelectTrigger>
                  <SelectContent>
                    {bootstrap.sources.map((source) => (
                      <SelectItem key={source.id} value={source.id}>
                        {source.name} · {FUEL_LABELS[source.fuel_type as FuelType]} · {liters(source.current_balance_liters)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Куда *</Label>
                <Select value={transferForm.toFuelSourceId} onValueChange={(value) => setTransferForm((prev) => ({ ...prev, toFuelSourceId: value }))}>
                  <SelectTrigger><SelectValue placeholder="Приёмник" /></SelectTrigger>
                  <SelectContent>
                    {bootstrap.sources
                      .filter((source) => source.id !== transferForm.fromFuelSourceId)
                      .map((source) => (
                        <SelectItem key={source.id} value={source.id}>
                          {source.name} · {FUEL_LABELS[source.fuel_type as FuelType]}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Оператор</Label>
                <Select value={transferForm.operatorPersonnelId || "none"} onValueChange={(value) => setTransferForm((prev) => ({ ...prev, operatorPersonnelId: value === "none" ? "" : value }))}>
                  <SelectTrigger><SelectValue placeholder="Опционально" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Без привязки</SelectItem>
                    {bootstrap.mechanizators.map((person) => (
                      <SelectItem key={person.id} value={person.id}>
                        {person.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Литры *</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.001"
                  value={transferForm.liters}
                  onChange={(event) => setTransferForm((prev) => ({ ...prev, liters: event.target.value }))}
                  placeholder="0"
                />
              </div>
            </div>
            {selectedTransferSource ? (
              <div className="rounded-md border bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Остаток в источнике: <span className="font-semibold text-slate-900">{liters(selectedTransferSource.current_balance_liters)}</span>
              </div>
            ) : null}
            <div className="space-y-1">
              <Label>Комментарий</Label>
              <Input value={transferForm.comment} onChange={(event) => setTransferForm((prev) => ({ ...prev, comment: event.target.value }))} placeholder="Опционально" />
            </div>
            <Button className="w-full" variant="secondary" onClick={submitTransfer} disabled={savingTransfer || loading}>
              {savingTransfer ? "Сохраняем..." : "ПЕРЕМЕСТИТЬ ТОПЛИВО"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Лимитка (MVP)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Период</Label>
                <Input type="month" value={limitForm.periodMonth} onChange={(event) => setLimitForm((prev) => ({ ...prev, periodMonth: event.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Тип топлива</Label>
                <Select value={limitForm.fuelType} onValueChange={(value) => setLimitForm((prev) => ({ ...prev, fuelType: value as FuelType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(FUEL_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Лимит для</Label>
                <Select value={limitForm.target} onValueChange={(value) => setLimitForm((prev) => ({ ...prev, target: value as LimitTarget }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vehicle">Техники</SelectItem>
                    <SelectItem value="mechanizator">Механизатора</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Лимит (л)</Label>
                <Input type="number" min={0} step="0.001" value={limitForm.limitLiters} onChange={(event) => setLimitForm((prev) => ({ ...prev, limitLiters: event.target.value }))} />
              </div>
            </div>
            {limitForm.target === "vehicle" ? (
              <div className="space-y-1">
                <Label>Техника</Label>
                <Select value={limitForm.vehicleId || "none"} onValueChange={(value) => setLimitForm((prev) => ({ ...prev, vehicleId: value === "none" ? "" : value }))}>
                  <SelectTrigger><SelectValue placeholder="Выберите технику" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Не выбрано</SelectItem>
                    {bootstrap.vehicles.map((vehicle) => (
                      <SelectItem key={vehicle.id} value={vehicle.id}>
                        {vehicle.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1">
                <Label>Механизатор</Label>
                <Select value={limitForm.mechanizatorId || "none"} onValueChange={(value) => setLimitForm((prev) => ({ ...prev, mechanizatorId: value === "none" ? "" : value }))}>
                  <SelectTrigger><SelectValue placeholder="Выберите механизатора" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Не выбрано</SelectItem>
                    {bootstrap.mechanizators.map((person) => (
                      <SelectItem key={person.id} value={person.id}>
                        {person.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label>Комментарий</Label>
              <Input value={limitForm.note} onChange={(event) => setLimitForm((prev) => ({ ...prev, note: event.target.value }))} placeholder="Опционально" />
            </div>
            <Button className="w-full" variant="outline" onClick={submitLimit} disabled={savingLimit || loading}>
              {savingLimit ? "Сохраняем..." : "СОХРАНИТЬ ЛИМИТ"}
            </Button>

            <div className="space-y-2 border-t pt-3">
              {bootstrap.limits.slice(0, 8).map((limit) => (
                <div key={limit.id} className="rounded-md border bg-slate-50 px-3 py-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-slate-700">{limit.target_label}</span>
                    <Badge variant={limit.exceeded ? "destructive" : "outline"}>
                      {FUEL_LABELS[limit.fuel_type as FuelType]}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-slate-600">
                    Лимит: {liters(limit.limit_liters)} · Выдано: {liters(limit.issued_liters)} · Остаток:{" "}
                    <span className={limit.remaining_liters < 0 ? "font-semibold text-rose-700" : "font-semibold text-emerald-700"}>
                      {liters(limit.remaining_liters)}
                    </span>
                  </div>
                </div>
              ))}
              {!bootstrap.limits.length ? <div className="text-sm text-slate-500">Лимитка ещё не задана.</div> : null}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Последние выдачи топлива</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {bootstrap.recentIssues.slice(0, 10).map((issue) => (
                <div key={issue.id} className="rounded-md border bg-slate-50 px-3 py-2">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-semibold text-slate-900">{issue.vehicle_name}</span>
                    <span className="font-semibold text-slate-900">{liters(issue.liters)}</span>
                  </div>
                  <div className="text-xs text-slate-600">
                    {issue.fuel_source_name} · {issue.mechanizator_name || "Без механизатора"} · {dateTime(issue.issued_at)}
                  </div>
                </div>
              ))}
              {!bootstrap.recentIssues.length ? <div className="text-sm text-slate-500">Выдач пока нет.</div> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Последние перемещения</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {bootstrap.recentTransfers.slice(0, 8).map((transfer) => (
                <div key={transfer.id} className="rounded-md border bg-slate-50 px-3 py-2">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium text-slate-900">
                      {transfer.from_fuel_source_name} → {transfer.to_fuel_source_name}
                    </span>
                    <span className="font-semibold text-slate-900">{liters(transfer.liters)}</span>
                  </div>
                  <div className="text-xs text-slate-600">{dateTime(transfer.transferred_at)}</div>
                </div>
              ))}
              {!bootstrap.recentTransfers.length ? <div className="text-sm text-slate-500">Перемещений пока нет.</div> : null}
            </CardContent>
          </Card>
        </div>
      </div>

      {loading ? (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Загрузка АЗС / ГСМ...</AlertDescription>
        </Alert>
      ) : null}

      <Dialog open={sourceDialogOpen} onOpenChange={setSourceDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новая топливная ёмкость</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Название *</Label>
              <Input value={sourceForm.name} onChange={(event) => setSourceForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="АЗС ДТ / Бочка №1 / Топливозаправщик №1" />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Тип источника *</Label>
                <Select value={sourceForm.sourceType} onValueChange={(value) => setSourceForm((prev) => ({ ...prev, sourceType: value as FuelSourceType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(SOURCE_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Тип топлива *</Label>
                <Select value={sourceForm.fuelType} onValueChange={(value) => setSourceForm((prev) => ({ ...prev, fuelType: value as FuelType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(FUEL_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Текущий остаток (л)</Label>
                <Input type="number" min={0} step="0.001" value={sourceForm.currentBalanceLiters} onChange={(event) => setSourceForm((prev) => ({ ...prev, currentBalanceLiters: event.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Вместимость (л)</Label>
                <Input type="number" min={0} step="0.001" value={sourceForm.capacityLiters} onChange={(event) => setSourceForm((prev) => ({ ...prev, capacityLiters: event.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Локация</Label>
              <Input value={sourceForm.location} onChange={(event) => setSourceForm((prev) => ({ ...prev, location: event.target.value }))} placeholder="База / Северная стоянка / Полевая зона" />
            </div>
            <div className="space-y-1">
              <Label>Привязанная машина (для топливозаправщика)</Label>
              <Select value={sourceForm.assignedVehicleId || "none"} onValueChange={(value) => setSourceForm((prev) => ({ ...prev, assignedVehicleId: value === "none" ? "" : value }))}>
                <SelectTrigger><SelectValue placeholder="Не выбрано" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Не выбрано</SelectItem>
                  {bootstrap.vehicles.map((vehicle) => (
                    <SelectItem key={vehicle.id} value={vehicle.id}>
                      {vehicle.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSourceDialogOpen(false)} disabled={savingSource}>
              Отмена
            </Button>
            <Button onClick={submitNewSource} disabled={savingSource}>
              {savingSource ? "Сохраняем..." : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
