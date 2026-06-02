"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, CookingPot, PackagePlus, ShieldAlert, ThermometerSun, Undo2, X } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import {
  assignMealOrderThermoses,
  createMealOrder,
  createThermos,
  getMealThermosBootstrap,
  issueMealOrder,
  returnMealOrderThermoses,
  updateMealOrderStatus,
  updateThermos,
} from "@/lib/services/meal-thermoses";
import type {
  CreateMealOrderInput,
  MealOrder,
  MealOrderPerson,
  MealOrderStatus,
  MealThermosBootstrapPayload,
  Thermos,
  ThermosReturnAction,
  ThermosStatus,
} from "@/lib/types/meal-thermoses";

const MEAL_TYPE_OPTIONS = [
  { value: "breakfast", label: "Завтрак" },
  { value: "lunch", label: "Обед" },
  { value: "dinner", label: "Ужин" },
  { value: "other", label: "Другое" },
] as const;

const ORDER_STATUS_OPTIONS: Array<{ value: "all" | MealOrderStatus; label: string }> = [
  { value: "all", label: "Все статусы" },
  { value: "new", label: "Новая" },
  { value: "accepted", label: "Принята" },
  { value: "cooking", label: "Готовится" },
  { value: "ready", label: "Готово к выдаче" },
  { value: "issued", label: "Выдано" },
  { value: "partially_returned", label: "Частично возвращено" },
  { value: "returned", label: "Возвращено" },
  { value: "cancelled", label: "Отменена" },
];

const THERMOS_STATUS_OPTIONS: Array<{ value: ThermosStatus; label: string }> = [
  { value: "available", label: "Свободен" },
  { value: "assigned", label: "Назначен" },
  { value: "issued", label: "Выдан" },
  { value: "returned_dirty", label: "Вернулся (грязный)" },
  { value: "cleaning", label: "На мойке" },
  { value: "damaged", label: "Повреждён" },
  { value: "lost", label: "Потерян" },
  { value: "inactive", label: "Неактивен" },
];

type AssignmentDraft = Record<string, Record<string, string>>;
type ThermosStatusDraft = Record<string, ThermosStatus>;

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadge(orderStatus: MealOrderStatus) {
  if (orderStatus === "new") return <Badge className="bg-slate-600 text-white">Новая</Badge>;
  if (orderStatus === "accepted") return <Badge className="bg-blue-600 text-white">Принята</Badge>;
  if (orderStatus === "cooking") return <Badge className="bg-amber-600 text-black">Готовится</Badge>;
  if (orderStatus === "ready") return <Badge className="bg-emerald-600 text-white">Готово</Badge>;
  if (orderStatus === "issued") return <Badge className="bg-cyan-600 text-white">Выдано</Badge>;
  if (orderStatus === "partially_returned") return <Badge className="bg-orange-600 text-white">Частично возвращено</Badge>;
  if (orderStatus === "returned") return <Badge className="bg-green-700 text-white">Закрыто</Badge>;
  return <Badge variant="destructive">Отменена</Badge>;
}

function personStatusLabel(status: MealOrderPerson["issue_status"]) {
  if (status === "pending") return "Ожидает";
  if (status === "assigned") return "Назначен";
  if (status === "issued") return "Выдан";
  if (status === "returned") return "Возвращён";
  if (status === "damaged") return "Повреждён";
  return "Потерян";
}

function isKitchenRole(role: string | null | undefined) {
  return role === "global_admin" || role === "company_admin" || role === "warehouse" || role === "warehouse_operator";
}

function isBrigadierRole(role: string | null | undefined) {
  return role === "global_admin" || role === "company_admin" || role === "brigadier";
}

export default function MealThermosesPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const companyId = profile?.company_id || null;

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [bootstrap, setBootstrap] = useState<MealThermosBootstrapPayload | null>(null);
  const [mealDateFilter, setMealDateFilter] = useState<string>(new Date().toISOString().slice(0, 10));
  const [statusFilter, setStatusFilter] = useState<"all" | MealOrderStatus>("all");

  const [createDraft, setCreateDraft] = useState<CreateMealOrderInput>({
    meal_date: new Date().toISOString().slice(0, 10),
    meal_type: "lunch",
    field_id: null,
    delivery_location_text: "",
    comment: "",
    people_text: "",
  });

  const [thermosDraft, setThermosDraft] = useState<{
    number: string;
    label: string;
    volume_l: string;
  }>({
    number: "",
    label: "",
    volume_l: "",
  });

  const [assignmentDraft, setAssignmentDraft] = useState<AssignmentDraft>({});
  const [thermosStatusDraft, setThermosStatusDraft] = useState<ThermosStatusDraft>({});
  const [returnsCommentByPersonId, setReturnsCommentByPersonId] = useState<Record<string, string>>({});

  const canRead = Boolean(
    profile?.role &&
      ["global_admin", "company_admin", "warehouse", "warehouse_operator", "brigadier"].includes(profile.role)
  );
  const canCreateOrder = isBrigadierRole(profile?.role);
  const canKitchenManage = isKitchenRole(profile?.role);

  const loadBootstrap = async () => {
    if (!companyId || !canRead) return;
    setLoading(true);
    try {
      const data = await getMealThermosBootstrap(companyId, {
        mealDate: mealDateFilter || null,
        status: statusFilter,
      });
      setBootstrap(data);
      setThermosStatusDraft((prev) => {
        const next = { ...prev };
        (data.thermoses || []).forEach((item) => {
          if (!next[item.id]) next[item.id] = item.status;
        });
        return next;
      });
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось загрузить данные модуля питания",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (companyId && canRead) {
      void loadBootstrap();
    }
  }, [companyId, canRead, mealDateFilter, statusFilter]);

  const orders = bootstrap?.orders || [];
  const fields = bootstrap?.fields || [];
  const thermoses = bootstrap?.thermoses || [];
  const awaitingReturns = bootstrap?.awaiting_returns || [];
  const summary = bootstrap?.summary;

  const fieldById = useMemo(() => {
    const map = new Map<string, { id: string; name: string; area: number | null }>();
    fields.forEach((field) => map.set(field.id, field));
    return map;
  }, [fields]);

  const buildAssignableThermoses = (order: MealOrder, person: MealOrderPerson): Thermos[] => {
    return thermoses.filter((thermos) => {
      if (thermos.status === "available") return true;
      if (thermos.status === "assigned" && thermos.current_meal_order_id === order.id) return true;
      return String(thermos.id) === String(person.thermos_id || "");
    });
  };

  const refreshAndClearBusy = async () => {
    await loadBootstrap();
    setBusy(null);
  };

  const handleCreateOrder = async () => {
    if (!companyId) return;
    const peopleText = String(createDraft.people_text || "").trim();
    if (!peopleText) {
      toast({ title: "Проверка", description: "Добавьте список людей для заявки", variant: "destructive" });
      return;
    }
    setBusy("create-order");
    try {
      await createMealOrder(companyId, createDraft);
      setCreateDraft({
        meal_date: new Date().toISOString().slice(0, 10),
        meal_type: "lunch",
        field_id: null,
        delivery_location_text: "",
        comment: "",
        people_text: "",
      });
      toast({ title: "Готово", description: "Заявка на питание создана" });
      await refreshAndClearBusy();
    } catch (error: any) {
      setBusy(null);
      toast({ title: "Ошибка", description: error?.message || "Не удалось создать заявку", variant: "destructive" });
    }
  };

  const handleOrderStatus = async (orderId: string, status: MealOrderStatus) => {
    if (!companyId) return;
    setBusy(`status:${orderId}:${status}`);
    try {
      await updateMealOrderStatus(orderId, companyId, status);
      await refreshAndClearBusy();
    } catch (error: any) {
      setBusy(null);
      toast({ title: "Ошибка", description: error?.message || "Не удалось обновить статус заявки", variant: "destructive" });
    }
  };

  const handleAssign = async (order: MealOrder) => {
    if (!companyId) return;
    const draft = assignmentDraft[order.id] || {};
    const assignments = order.people
      .filter((person) => ["pending", "assigned"].includes(person.issue_status))
      .map((person) => ({
        meal_order_person_id: person.id,
        thermos_id: String(draft[person.id] || person.thermos_id || "").trim(),
      }))
      .filter((row) => row.thermos_id);

    if (assignments.length === 0) {
      toast({
        title: "Проверка",
        description: "Выберите термос хотя бы для одного человека",
        variant: "destructive",
      });
      return;
    }

    setBusy(`assign:${order.id}`);
    try {
      await assignMealOrderThermoses(order.id, companyId, assignments);
      toast({ title: "Готово", description: "Термосы назначены" });
      await refreshAndClearBusy();
    } catch (error: any) {
      setBusy(null);
      toast({ title: "Ошибка", description: error?.message || "Не удалось назначить термосы", variant: "destructive" });
    }
  };

  const handleIssue = async (orderId: string) => {
    if (!companyId) return;
    setBusy(`issue:${orderId}`);
    try {
      await issueMealOrder(orderId, companyId);
      toast({ title: "Готово", description: "Термосы выданы" });
      await refreshAndClearBusy();
    } catch (error: any) {
      setBusy(null);
      toast({ title: "Ошибка", description: error?.message || "Не удалось выдать термосы", variant: "destructive" });
    }
  };

  const handleReturn = async (row: {
    meal_order_id: string;
    meal_order_person_id: string;
  }, action: ThermosReturnAction) => {
    if (!companyId) return;
    setBusy(`return:${row.meal_order_person_id}:${action}`);
    try {
      await returnMealOrderThermoses(row.meal_order_id, companyId, [
        {
          meal_order_person_id: row.meal_order_person_id,
          action,
          comment: returnsCommentByPersonId[row.meal_order_person_id] || null,
        },
      ]);
      setReturnsCommentByPersonId((prev) => ({ ...prev, [row.meal_order_person_id]: "" }));
      toast({ title: "Готово", description: "Возврат зафиксирован" });
      await refreshAndClearBusy();
    } catch (error: any) {
      setBusy(null);
      toast({ title: "Ошибка", description: error?.message || "Не удалось отметить возврат", variant: "destructive" });
    }
  };

  const handleCreateThermos = async () => {
    if (!companyId) return;
    if (!thermosDraft.number.trim()) {
      toast({ title: "Проверка", description: "Укажите номер термоса", variant: "destructive" });
      return;
    }
    setBusy("create-thermos");
    try {
      await createThermos(companyId, {
        number: thermosDraft.number.trim(),
        label: thermosDraft.label.trim() || null,
        volume_l: thermosDraft.volume_l.trim() ? Number(thermosDraft.volume_l.trim()) : null,
      });
      setThermosDraft({ number: "", label: "", volume_l: "" });
      toast({ title: "Готово", description: "Термос добавлен" });
      await refreshAndClearBusy();
    } catch (error: any) {
      setBusy(null);
      toast({ title: "Ошибка", description: error?.message || "Не удалось добавить термос", variant: "destructive" });
    }
  };

  const handlePatchThermos = async (thermos: Thermos) => {
    if (!companyId) return;
    const draftStatus = thermosStatusDraft[thermos.id] || thermos.status;
    setBusy(`thermos:${thermos.id}`);
    try {
      await updateThermos(thermos.id, companyId, { status: draftStatus });
      toast({ title: "Готово", description: `Статус термоса ${thermos.number} обновлён` });
      await refreshAndClearBusy();
    } catch (error: any) {
      setBusy(null);
      toast({ title: "Ошибка", description: error?.message || "Не удалось обновить статус термоса", variant: "destructive" });
    }
  };

  if (!canRead) {
    return <PageHeader title="Питание / Термосы" description="Нет доступа для текущей роли" />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Питание / Термосы"
        description="Операционный модуль кухни и бригадиров: заявки, выдача и возврат термосов"
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Сводка</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            <div className="rounded-lg border border-[#2B3448] bg-[#151C28] p-3">
              <div className="text-xs text-slate-400">Заявок сегодня</div>
              <div className="text-xl font-semibold text-slate-100">{summary?.orders_today ?? 0}</div>
            </div>
            <div className="rounded-lg border border-[#2B3448] bg-[#151C28] p-3">
              <div className="text-xs text-slate-400">Обедов сегодня</div>
              <div className="text-xl font-semibold text-slate-100">{summary?.lunches_today ?? 0}</div>
            </div>
            <div className="rounded-lg border border-[#2B3448] bg-[#151C28] p-3">
              <div className="text-xs text-slate-400">Выдано термосов</div>
              <div className="text-xl font-semibold text-slate-100">{summary?.thermoses_issued ?? 0}</div>
            </div>
            <div className="rounded-lg border border-[#2B3448] bg-[#151C28] p-3">
              <div className="text-xs text-slate-400">Ожидают возврата</div>
              <div className="text-xl font-semibold text-slate-100">{summary?.awaiting_return ?? 0}</div>
            </div>
            <div className="rounded-lg border border-[#2B3448] bg-[#151C28] p-3">
              <div className="text-xs text-slate-400">Потеряно</div>
              <div className="text-xl font-semibold text-rose-300">{summary?.thermoses_lost ?? 0}</div>
            </div>
            <div className="rounded-lg border border-[#2B3448] bg-[#151C28] p-3">
              <div className="text-xs text-slate-400">Повреждено</div>
              <div className="text-xl font-semibold text-amber-300">{summary?.thermoses_damaged ?? 0}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Фильтры очереди</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <Label>Дата питания</Label>
              <Input type="date" value={mealDateFilter} onChange={(event) => setMealDateFilter(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Статус</Label>
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as "all" | MealOrderStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORDER_STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end md:col-span-2">
              <Button variant="outline" onClick={() => void loadBootstrap()} disabled={loading}>
                Обновить
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {canCreateOrder ? (
          <Card className="xl:col-span-1">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Новая заявка</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Дата</Label>
                  <Input
                    type="date"
                    value={createDraft.meal_date}
                    onChange={(event) => setCreateDraft((prev) => ({ ...prev, meal_date: event.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Тип питания</Label>
                  <Select
                    value={createDraft.meal_type}
                    onValueChange={(value) =>
                      setCreateDraft((prev) => ({ ...prev, meal_type: value as CreateMealOrderInput["meal_type"] }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MEAL_TYPE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <Label>Поле (опционально)</Label>
                <Select
                  value={createDraft.field_id || "none"}
                  onValueChange={(value) => setCreateDraft((prev) => ({ ...prev, field_id: value === "none" ? null : value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите поле" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Без привязки к полю</SelectItem>
                    {fields.map((field) => (
                      <SelectItem key={field.id} value={field.id}>
                        {field.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>Место доставки</Label>
                <Input
                  value={createDraft.delivery_location_text || ""}
                  onChange={(event) =>
                    setCreateDraft((prev) => ({ ...prev, delivery_location_text: event.target.value }))
                  }
                  placeholder="например: Поле 28, южный край"
                />
              </div>

              <div className="space-y-1">
                <Label>Список людей</Label>
                <Textarea
                  value={createDraft.people_text || ""}
                  onChange={(event) => setCreateDraft((prev) => ({ ...prev, people_text: event.target.value }))}
                  rows={6}
                  placeholder={"Соколовский\nРудницкий\nИванов"}
                />
              </div>

              <div className="space-y-1">
                <Label>Комментарий</Label>
                <Textarea
                  value={createDraft.comment || ""}
                  onChange={(event) => setCreateDraft((prev) => ({ ...prev, comment: event.target.value }))}
                  rows={2}
                  placeholder="опционально"
                />
              </div>

              <Button className="w-full" onClick={() => void handleCreateOrder()} disabled={busy === "create-order"}>
                <PackagePlus className="mr-2 h-4 w-4" />
                Создать заявку
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <Card className={canCreateOrder ? "xl:col-span-2" : "xl:col-span-3"}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Очередь заявок</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? <div className="text-sm text-slate-400">Загрузка...</div> : null}
            {!loading && orders.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[#2B3448] p-3 text-sm text-slate-400">
                Заявки не найдены.
              </div>
            ) : null}

            {orders.map((order) => {
              const draftByOrder = assignmentDraft[order.id] || {};
              const fieldName = order.field_id ? fieldById.get(order.field_id)?.name || order.fields?.name || "—" : "—";
              const isIssuedLike = order.status === "issued" || order.status === "partially_returned" || order.status === "returned";

              return (
                <div key={order.id} className="rounded-xl border border-[#2B3448] bg-[#151C28] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-100">
                        {order.brigadier_name || "Бригадир"} · {order.meal_date}
                      </div>
                      <div className="text-xs text-slate-400">
                        {MEAL_TYPE_OPTIONS.find((item) => item.value === order.meal_type)?.label || order.meal_type}
                        {" · "}
                        Поле: {fieldName}
                        {" · "}
                        Людей: {order.people_count}
                      </div>
                    </div>
                    {statusBadge(order.status)}
                  </div>

                  {order.delivery_location_text ? (
                    <div className="mt-2 text-xs text-slate-400">Доставка: {order.delivery_location_text}</div>
                  ) : null}
                  {order.comment ? <div className="mt-1 text-xs text-slate-400">Комментарий: {order.comment}</div> : null}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {canKitchenManage && order.status === "new" ? (
                      <Button size="sm" variant="outline" disabled={busy === `status:${order.id}:accepted`} onClick={() => void handleOrderStatus(order.id, "accepted")}>
                        <Check className="mr-1 h-4 w-4" />
                        Принять
                      </Button>
                    ) : null}

                    {canKitchenManage && order.status === "accepted" ? (
                      <Button size="sm" variant="outline" disabled={busy === `status:${order.id}:cooking`} onClick={() => void handleOrderStatus(order.id, "cooking")}>
                        <CookingPot className="mr-1 h-4 w-4" />
                        В готовку
                      </Button>
                    ) : null}

                    {canKitchenManage && order.status === "cooking" ? (
                      <Button size="sm" variant="outline" disabled={busy === `status:${order.id}:ready`} onClick={() => void handleOrderStatus(order.id, "ready")}>
                        <ThermometerSun className="mr-1 h-4 w-4" />
                        Готово
                      </Button>
                    ) : null}

                    {canKitchenManage && order.status === "ready" ? (
                      <Button size="sm" variant="default" disabled={busy === `issue:${order.id}`} onClick={() => void handleIssue(order.id)}>
                        <PackagePlus className="mr-1 h-4 w-4" />
                        Выдать термосы
                      </Button>
                    ) : null}

                    {(canKitchenManage || profile?.role === "brigadier") &&
                    !isIssuedLike &&
                    order.status !== "cancelled" ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busy === `status:${order.id}:cancelled`}
                        onClick={() => void handleOrderStatus(order.id, "cancelled")}
                      >
                        <X className="mr-1 h-4 w-4" />
                        Отменить
                      </Button>
                    ) : null}
                  </div>

                  <div className="mt-3 space-y-2">
                    {order.people.map((person) => {
                      const assignable = buildAssignableThermoses(order, person);
                      const selectValue = draftByOrder[person.id] || person.thermos_id || "none";
                      const allowAssign = canKitchenManage && ["pending", "assigned"].includes(person.issue_status);
                      return (
                        <div
                          key={person.id}
                          className="grid grid-cols-1 gap-2 rounded-lg border border-[#2B3448] p-2 md:grid-cols-[1fr_220px]"
                        >
                          <div className="text-sm">
                            <div className="font-medium text-slate-100">{person.person_name}</div>
                            <div className="text-xs text-slate-400">
                              Статус: {personStatusLabel(person.issue_status)}
                              {person.thermos_number ? ` · Термос: ${person.thermos_number}` : ""}
                            </div>
                          </div>
                          {allowAssign ? (
                            <Select
                              value={selectValue}
                              onValueChange={(value) =>
                                setAssignmentDraft((prev) => ({
                                  ...prev,
                                  [order.id]: {
                                    ...(prev[order.id] || {}),
                                    [person.id]: value === "none" ? "" : value,
                                  },
                                }))
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Термос" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">Без термоса</SelectItem>
                                {assignable.map((thermos) => (
                                  <SelectItem key={`${order.id}:${person.id}:${thermos.id}`} value={thermos.id}>
                                    {thermos.number} · {thermos.status}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <div className="text-xs text-slate-400">{person.thermos_number ? `Термос ${person.thermos_number}` : "—"}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {canKitchenManage && !["cancelled", "issued", "returned"].includes(order.status) ? (
                    <div className="mt-2 flex justify-end">
                      <Button size="sm" variant="outline" disabled={busy === `assign:${order.id}`} onClick={() => void handleAssign(order)}>
                        Сохранить назначения
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Ожидают возврата</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {awaitingReturns.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[#2B3448] p-3 text-sm text-slate-400">
                Выданных термосов без возврата сейчас нет.
              </div>
            ) : null}
            {awaitingReturns.map((row) => (
              <div key={row.meal_order_person_id} className="rounded-lg border border-[#2B3448] bg-[#151C28] p-3">
                <div className="text-sm font-medium text-slate-100">
                  Термос {row.thermos_number || "—"} · {row.person_name || "—"}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {row.brigadier_name || "—"} · {row.meal_date} · {row.field_name || row.delivery_location_text || "без поля"}
                </div>
                <div className="mt-1 text-xs text-slate-400">Выдан: {formatDateTime(row.issued_at)}</div>
                <div className="mt-2 space-y-2">
                  <Input
                    placeholder="Комментарий (опционально)"
                    value={returnsCommentByPersonId[row.meal_order_person_id] || ""}
                    onChange={(event) =>
                      setReturnsCommentByPersonId((prev) => ({
                        ...prev,
                        [row.meal_order_person_id]: event.target.value,
                      }))
                    }
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === `return:${row.meal_order_person_id}:returned`}
                      onClick={() => void handleReturn(row, "returned")}
                    >
                      <Undo2 className="mr-1 h-4 w-4" />
                      Вернулся
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === `return:${row.meal_order_person_id}:damaged`}
                      onClick={() => void handleReturn(row, "damaged")}
                    >
                      <ShieldAlert className="mr-1 h-4 w-4" />
                      Повреждён
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy === `return:${row.meal_order_person_id}:lost`}
                      onClick={() => void handleReturn(row, "lost")}
                    >
                      Потерян
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Справочник термосов</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {canKitchenManage ? (
              <div className="rounded-xl border border-[#2B3448] bg-[#151C28] p-3">
                <div className="mb-2 text-sm font-medium text-slate-100">Добавить термос</div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  <Input
                    placeholder="Номер"
                    value={thermosDraft.number}
                    onChange={(event) => setThermosDraft((prev) => ({ ...prev, number: event.target.value }))}
                  />
                  <Input
                    placeholder="Метка"
                    value={thermosDraft.label}
                    onChange={(event) => setThermosDraft((prev) => ({ ...prev, label: event.target.value }))}
                  />
                  <Input
                    placeholder="Объём (л)"
                    value={thermosDraft.volume_l}
                    onChange={(event) => setThermosDraft((prev) => ({ ...prev, volume_l: event.target.value }))}
                  />
                </div>
                <Button className="mt-2" onClick={() => void handleCreateThermos()} disabled={busy === "create-thermos"}>
                  Добавить
                </Button>
              </div>
            ) : null}

            {thermoses.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[#2B3448] p-3 text-sm text-slate-400">
                Термосы пока не добавлены.
              </div>
            ) : null}

            {thermoses.map((thermos) => (
              <div key={thermos.id} className="rounded-lg border border-[#2B3448] bg-[#151C28] p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium text-slate-100">
                    Термос {thermos.number}
                    {thermos.label ? ` · ${thermos.label}` : ""}
                  </div>
                  <Badge variant="outline">{thermos.status}</Badge>
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  Держатель: {thermos.current_holder_name || "—"} · Последняя выдача: {formatDateTime(thermos.last_issued_at)}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  Возврат: {formatDateTime(thermos.last_returned_at)} · Объём: {thermos.volume_l ?? "—"} л
                </div>

                {canKitchenManage ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Select
                      value={thermosStatusDraft[thermos.id] || thermos.status}
                      onValueChange={(value) =>
                        setThermosStatusDraft((prev) => ({
                          ...prev,
                          [thermos.id]: value as ThermosStatus,
                        }))
                      }
                    >
                      <SelectTrigger className="w-[220px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {THERMOS_STATUS_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === `thermos:${thermos.id}`}
                      onClick={() => void handlePatchThermos(thermos)}
                    >
                      Обновить статус
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

