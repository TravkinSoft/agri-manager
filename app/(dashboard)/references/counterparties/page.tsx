"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/contexts/auth-context";
import { createCounterparty, listCounterparties, updateCounterparty } from "@/lib/services/counterparties";
import type { Counterparty, CounterpartyType } from "@/lib/types/counterparty";

const TYPE_LABELS: Record<CounterpartyType, string> = {
  supplier: "Поставщик",
  buyer: "Покупатель",
  carrier: "Перевозчик",
  service: "Сервис",
  both: "Поставщик и покупатель",
  other: "Другое",
};

type FormState = {
  name: string;
  type: CounterpartyType;
  binIin: string;
  phone: string;
  contactPerson: string;
  comment: string;
  isActive: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  type: "supplier",
  binIin: "",
  phone: "",
  contactPerson: "",
  comment: "",
  isActive: true,
};

export default function CounterpartiesPage() {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<Counterparty[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [typeFilter, setTypeFilter] = useState<CounterpartyType | "all">("all");

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editing, setEditing] = useState<Counterparty | null>(null);

  const companyId = profile?.company_id || "";
  const actorUserId = profile?.id || "";

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (!showInactive && !row.is_active) return false;
      if (typeFilter !== "all" && row.counterparty_type !== typeFilter) return false;
      return true;
    });
  }, [rows, showInactive, typeFilter]);

  const reload = async () => {
    if (!companyId || !actorUserId) return;
    setLoading(true);
    try {
      const data = await listCounterparties({
        companyId,
        userId: actorUserId,
        activeOnly: false,
      });
      setRows(data);
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось загрузить контрагентов",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, [companyId, actorUserId]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setCreateOpen(true);
  };

  const openEdit = (row: Counterparty) => {
    setEditing(row);
    setForm({
      name: row.name,
      type: (row.counterparty_type as CounterpartyType) || "other",
      binIin: row.bin_iin || "",
      phone: row.phone || "",
      contactPerson: row.contact_person || "",
      comment: row.notes || "",
      isActive: row.is_active,
    });
    setEditOpen(true);
  };

  const submitCreate = async () => {
    if (!companyId || !actorUserId || saving) return;
    if (!form.name.trim()) {
      toast({ title: "Ошибка", description: "Укажите название контрагента", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await createCounterparty({
        companyId,
        actorUserId,
        name: form.name.trim(),
        type: form.type,
        binIin: form.binIin.trim() || null,
        phone: form.phone.trim() || null,
        contactPerson: form.contactPerson.trim() || null,
        comment: form.comment.trim() || null,
        isActive: form.isActive,
      });
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      await reload();
      toast({ title: "Готово", description: "Контрагент создан" });
    } catch (error: any) {
      toast({ title: "Ошибка", description: error?.message || "Не удалось создать контрагента", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const submitEdit = async () => {
    if (!companyId || !actorUserId || !editing || saving) return;
    if (!form.name.trim()) {
      toast({ title: "Ошибка", description: "Укажите название контрагента", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await updateCounterparty(editing.id, {
        companyId,
        actorUserId,
        name: form.name.trim(),
        type: form.type,
        binIin: form.binIin.trim() || null,
        phone: form.phone.trim() || null,
        contactPerson: form.contactPerson.trim() || null,
        comment: form.comment.trim() || null,
        isActive: form.isActive,
      });
      setEditOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      await reload();
      toast({ title: "Готово", description: "Контрагент обновлен" });
    } catch (error: any) {
      toast({ title: "Ошибка", description: error?.message || "Не удалось обновить контрагента", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (row: Counterparty) => {
    if (!companyId || !actorUserId) return;
    try {
      await updateCounterparty(row.id, {
        companyId,
        actorUserId,
        isActive: !row.is_active,
      });
      await reload();
      toast({ title: "Готово", description: !row.is_active ? "Контрагент активирован" : "Контрагент деактивирован" });
    } catch (error: any) {
      toast({ title: "Ошибка", description: error?.message || "Не удалось изменить статус", variant: "destructive" });
    }
  };

  const renderForm = () => (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>Название *</Label>
        <Input
          value={form.name}
          onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
          placeholder='ТОО "Партнер Агро"'
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label>Тип *</Label>
          <Select value={form.type} onValueChange={(value) => setForm((prev) => ({ ...prev, type: value as CounterpartyType }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(TYPE_LABELS) as CounterpartyType[]).map((type) => (
                <SelectItem key={type} value={type}>{TYPE_LABELS[type]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>BIN / ИИН</Label>
          <Input
            value={form.binIin}
            onChange={(event) => setForm((prev) => ({ ...prev, binIin: event.target.value }))}
            placeholder="Опционально"
          />
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label>Телефон</Label>
          <Input
            value={form.phone}
            onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
            placeholder="+7..."
          />
        </div>
        <div className="space-y-1">
          <Label>Контактное лицо</Label>
          <Input
            value={form.contactPerson}
            onChange={(event) => setForm((prev) => ({ ...prev, contactPerson: event.target.value }))}
            placeholder="Опционально"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label>Комментарий</Label>
        <Input
          value={form.comment}
          onChange={(event) => setForm((prev) => ({ ...prev, comment: event.target.value }))}
          placeholder="Опционально"
        />
      </div>
      <div className="space-y-1">
        <Label>Статус</Label>
        <Select value={form.isActive ? "active" : "inactive"} onValueChange={(value) => setForm((prev) => ({ ...prev, isActive: value === "active" }))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Активен</SelectItem>
            <SelectItem value="inactive">Неактивен</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Контрагенты" description="Локальный справочник контрагентов компании">
        <div className="flex items-center gap-2">
          <Button variant={showInactive ? "default" : "outline"} onClick={() => setShowInactive((prev) => !prev)}>
            {showInactive ? "Скрыть неактивные" : "Показать неактивные"}
          </Button>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Добавить контрагента
          </Button>
        </div>
      </PageHeader>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Список контрагентов</CardTitle>
            <div className="w-[280px]">
              <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as CounterpartyType | "all")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все типы</SelectItem>
                  {(Object.keys(TYPE_LABELS) as CounterpartyType[]).map((type) => (
                    <SelectItem key={type} value={type}>{TYPE_LABELS[type]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Название</TableHead>
                <TableHead>Тип</TableHead>
                <TableHead>BIN / ИИН</TableHead>
                <TableHead>Телефон</TableHead>
                <TableHead>Контакт</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead className="w-[220px]">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-slate-500">Загрузка...</TableCell>
                </TableRow>
              ) : filteredRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-slate-500">Контрагенты не найдены</TableCell>
                </TableRow>
              ) : (
                filteredRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>{TYPE_LABELS[(row.counterparty_type as CounterpartyType) || "other"] || row.counterparty_type}</TableCell>
                    <TableCell>{row.bin_iin || "-"}</TableCell>
                    <TableCell>{row.phone || "-"}</TableCell>
                    <TableCell>{row.contact_person || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={row.is_active ? "outline" : "secondary"}>{row.is_active ? "Активен" : "Неактивен"}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => openEdit(row)}>Изменить</Button>
                        <Button variant="outline" size="sm" onClick={() => toggleActive(row)}>
                          {row.is_active ? "Деактивировать" : "Активировать"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новый контрагент</DialogTitle>
          </DialogHeader>
          {renderForm()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>Отмена</Button>
            <Button onClick={submitCreate} disabled={saving}>{saving ? "Сохраняем..." : "Создать"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Редактировать контрагента</DialogTitle>
          </DialogHeader>
          {renderForm()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>Отмена</Button>
            <Button onClick={submitEdit} disabled={saving}>{saving ? "Сохраняем..." : "Сохранить"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
