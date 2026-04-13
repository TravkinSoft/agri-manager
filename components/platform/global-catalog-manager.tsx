"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Pencil, Trash2, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import {
  type CatalogFilter,
  type CatalogFormField,
  type GlobalCatalogConfig,
  type GlobalCatalogEntity,
} from "@/lib/platform/global-catalog-config";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type RowRecord = Record<string, any>;

const BOOL_KEYS = new Set(["is_active", "is_common_in_kz"]);

function formatCellValue(value: any): string {
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (Array.isArray(value)) return value.join(", ");
  if (value == null || value === "") return "-";
  return String(value);
}

function getInitialValue(field: CatalogFormField): any {
  if (field.type === "checkbox") return true;
  if (field.type === "number") return "";
  return "";
}

export function GlobalCatalogManager({ config }: { config: GlobalCatalogConfig }) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [rows, setRows] = useState<RowRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<RowRecord | null>(null);
  const [formState, setFormState] = useState<Record<string, any>>({});
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [remoteOptions, setRemoteOptions] = useState<Record<string, Array<{ label: string; value: string }>>>({});

  const canSubmit = useMemo(() => {
    return config.formFields.every((field) => {
      if (!field.required) return true;
      const value = formState[field.key];
      if (field.type === "checkbox") return true;
      return String(value ?? "").trim().length > 0;
    });
  }, [config.formFields, formState]);

  const effectiveFilterOptions = useMemo(() => {
    const result: Record<string, Array<{ label: string; value: string }>> = {};
    for (const filter of config.filters) {
      const base = [...filter.options];
      const hasAll = base.some((option) => option.value === "all");
      if (!hasAll) base.unshift({ label: "Все", value: "all" });

      if (BOOL_KEYS.has(filter.key)) {
        result[filter.key] = base;
        continue;
      }

      const dynamicValues = new Set<string>();
      for (const row of rows) {
        const raw = row[filter.key];
        if (raw == null || raw === "") continue;
        if (Array.isArray(raw)) {
          raw.forEach((value) => {
            if (value != null && String(value).trim()) dynamicValues.add(String(value));
          });
        } else {
          dynamicValues.add(String(raw));
        }
      }

      for (const value of Array.from(dynamicValues)) {
        if (!base.some((option) => option.value === value)) {
          base.push({ label: value, value });
        }
      }

      result[filter.key] = base;
    }
    return result;
  }, [config.filters, rows]);

  const loadRows = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ userId: user.id });
      if (search.trim()) params.set("search", search.trim());
      Object.entries(filters).forEach(([key, value]) => {
        if (value && value !== "all") params.set(key, value);
      });

      const response = await fetch(`/api/global-admin/catalog/${config.entity}?${params.toString()}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Не удалось загрузить каталог");
      setRows(Array.isArray(payload?.rows) ? payload.rows : []);
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось загрузить каталог",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadRemoteOptions = async () => {
    if (!user?.id) return;
    const fieldsWithRemote = config.formFields.filter((field) => field.optionsEntity);
    if (!fieldsWithRemote.length) return;

    const entries = await Promise.all(
      fieldsWithRemote.map(async (field) => {
        try {
          const params = new URLSearchParams({ userId: user.id });
          const response = await fetch(`/api/global-admin/catalog/${field.optionsEntity}?${params.toString()}`);
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) return [field.key, []] as const;
          const options = (payload?.rows || []).map((row: any) => ({
            label: row.name || row.full_name || row.trade_name || row.id,
            value: row.id,
          }));
          return [field.key, options] as const;
        } catch {
          return [field.key, []] as const;
        }
      })
    );

    setRemoteOptions(Object.fromEntries(entries));
  };

  useEffect(() => {
    const defaults = Object.fromEntries(
      config.filters.map((filter) => [filter.key, filter.options.find((option) => option.value === "all")?.value || "all"])
    );
    setFilters(defaults);
  }, [config.entity]);

  useEffect(() => {
    void loadRows();
  }, [config.entity, user?.id, search, JSON.stringify(filters)]);

  useEffect(() => {
    void loadRemoteOptions();
  }, [config.entity, user?.id]);

  const openCreate = () => {
    const initial = Object.fromEntries(config.formFields.map((field) => [field.key, getInitialValue(field)]));
    setFormState(initial);
    setEditingRow(null);
    setCreateOpen(true);
  };

  const openEdit = (row: RowRecord) => {
    const initial = Object.fromEntries(
      config.formFields.map((field) => {
        const value = row[field.key];
        if (field.type === "checkbox") return [field.key, value !== false];
        return [field.key, value ?? ""];
      })
    );
    setEditingRow(row);
    setFormState(initial);
    setEditOpen(true);
  };

  const submitCreate = async () => {
    if (!user?.id || !canSubmit || saving) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/global-admin/catalog/${config.entity}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, payload: formState }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Не удалось создать запись");

      setCreateOpen(false);
      await loadRows();
      toast({ title: "Готово", description: "Запись успешно создана." });
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось создать запись",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const submitEdit = async () => {
    if (!user?.id || !editingRow?.id || saving) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/global-admin/catalog/${config.entity}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, id: editingRow.id, payload: formState }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Не удалось обновить запись");

      setEditOpen(false);
      setEditingRow(null);
      await loadRows();
      toast({ title: "Готово", description: "Изменения сохранены." });
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось обновить запись",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const archiveRow = async (rowId: string) => {
    if (!user?.id || saving) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/global-admin/catalog/${config.entity}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, id: rowId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Не удалось деактивировать запись");

      await loadRows();
      toast({ title: "Готово", description: "Запись деактивирована." });
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: error?.message || "Не удалось деактивировать запись",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const renderField = (field: CatalogFormField) => {
    const value = formState[field.key];
    const options = field.optionsEntity ? remoteOptions[field.key] || [] : field.options || [];

    if (field.type === "checkbox") {
      return (
        <div className="flex items-center gap-2">
          <Checkbox
            id={field.key}
            checked={Boolean(value)}
            onCheckedChange={(checked) => setFormState((prev) => ({ ...prev, [field.key]: Boolean(checked) }))}
          />
          <Label htmlFor={field.key}>{field.label}</Label>
        </div>
      );
    }

    if (field.type === "select") {
      return (
        <div className="space-y-2">
          <Label>{field.label}{field.required ? " *" : ""}</Label>
          <Select
            value={String(value || "")}
            onValueChange={(next) => setFormState((prev) => ({ ...prev, [field.key]: next }))}
          >
            <SelectTrigger>
              <SelectValue placeholder={field.placeholder || "Выберите значение"} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={`${field.key}-${option.value}`} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    }

    return (
      <div className="space-y-2">
        <Label>{field.label}{field.required ? " *" : ""}</Label>
        <Input
          type={field.type === "number" ? "number" : "text"}
          value={value ?? ""}
          placeholder={field.placeholder || ""}
          onChange={(event) => {
            const nextValue = field.type === "number" ? event.target.value : event.target.value;
            setFormState((prev) => ({ ...prev, [field.key]: nextValue }));
          }}
        />
      </div>
    );
  };

  const renderFilter = (filter: CatalogFilter) => {
    const options = effectiveFilterOptions[filter.key] || filter.options;
    const selected = filters[filter.key] || "all";
    return (
      <div className="space-y-2 min-w-[180px]">
        <Label>{filter.label}</Label>
        <Select
          value={selected}
          onValueChange={(value) => setFilters((prev) => ({ ...prev, [filter.key]: value }))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={`${filter.key}-${option.value}`} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>{config.title}</CardTitle>
              <CardDescription>{config.description}</CardDescription>
            </div>
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              {config.createLabel}
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2 md:col-span-2">
              <Label>Поиск</Label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="pl-9"
                  placeholder={config.searchPlaceholder}
                />
              </div>
            </div>
            {config.filters.map(renderFilter)}
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <Table>
            <TableHeader>
              <TableRow>
                {config.columns.map((column) => (
                  <TableHead key={column.key}>{column.label}</TableHead>
                ))}
                <TableHead className="w-[150px] text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={config.columns.length + 1} className="text-center text-slate-500">
                    Загрузка...
                  </TableCell>
                </TableRow>
              ) : null}
              {!loading && rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={config.columns.length + 1} className="text-center text-slate-500">
                    Записей нет.
                  </TableCell>
                </TableRow>
              ) : null}
              {!loading &&
                rows.map((row) => (
                  <TableRow key={row.id}>
                    {config.columns.map((column) => (
                      <TableCell key={`${row.id}-${column.key}`}>
                        {formatCellValue(row[column.key])}
                      </TableCell>
                    ))}
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="outline" size="icon" onClick={() => openEdit(row)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => archiveRow(row.id)}
                          disabled={saving}
                        >
                          <Trash2 className="h-4 w-4 text-rose-600" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={(open) => !saving && setCreateOpen(open)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{config.createLabel}</DialogTitle>
            <DialogDescription>Заполните поля новой записи.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {config.formFields.map((field) => (
              <div key={`create-${field.key}`} className={field.type === "checkbox" ? "md:col-span-2" : ""}>
                {renderField(field)}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>
              Отмена
            </Button>
            <Button onClick={submitCreate} disabled={!canSubmit || saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Создать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={(open) => !saving && setEditOpen(open)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Редактирование записи</DialogTitle>
            <DialogDescription>Измените поля и сохраните.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {config.formFields.map((field) => (
              <div key={`edit-${field.key}`} className={field.type === "checkbox" ? "md:col-span-2" : ""}>
                {renderField(field)}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
              Отмена
            </Button>
            <Button onClick={submitEdit} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
