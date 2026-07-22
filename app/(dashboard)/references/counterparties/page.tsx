"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Building2, MoreHorizontal, Plus, RotateCcw, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/contexts/auth-context";
import {
  createCounterparty,
  listCounterparties,
  searchSupplierCounterparties,
  updateCounterparty,
} from "@/lib/services/counterparties";
import type {
  Counterparty,
  CounterpartyCountryCode,
  CounterpartySearchResult,
} from "@/lib/types/counterparty";

type AddMode = "global" | "local";

export default function CounterpartiesPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const companyId = profile?.company_id || "";
  const canManage = profile?.role === "company_admin" || profile?.role === "global_admin";
  const [rows, setRows] = useState<Counterparty[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState<CounterpartyCountryCode | "all">("all");
  const [status, setStatus] = useState<"active" | "archived" | "all">("active");
  const [role, setRole] = useState<"supplier" | "buyer">("supplier");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>("global");
  const [globalSearch, setGlobalSearch] = useState("");
  const [globalResults, setGlobalResults] = useState<CounterpartySearchResult[]>([]);
  const [selectedGlobal, setSelectedGlobal] = useState<CounterpartySearchResult | null>(null);
  const [localName, setLocalName] = useState("");
  const [localTaxId, setLocalTaxId] = useState("");
  const [localCountry, setLocalCountry] = useState<CounterpartyCountryCode>("KZ");

  const reload = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      setRows(await listCounterparties({ companyId, type: role, status, country, search, activeOnly: false }));
    } catch (cause) {
      toast({
        title: "Не удалось загрузить контрагентов",
        description: cause instanceof Error ? cause.message : "Неизвестная ошибка",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [companyId, country, role, search, status, toast]);

  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 180);
    return () => window.clearTimeout(timer);
  }, [reload]);

  useEffect(() => {
    if (!dialogOpen || addMode !== "global" || !companyId) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const results = await searchSupplierCounterparties(companyId, globalSearch, role);
        if (!cancelled) setGlobalResults(results.filter((row) => row.source === "global"));
      } catch (cause) {
        if (!cancelled) {
          toast({
            title: "Поиск не выполнен",
            description: cause instanceof Error ? cause.message : "Неизвестная ошибка",
            variant: "destructive",
          });
        }
      }
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [addMode, companyId, dialogOpen, globalSearch, role, toast]);

  const resetDialog = () => {
    setAddMode("global");
    setGlobalSearch("");
    setGlobalResults([]);
    setSelectedGlobal(null);
    setLocalName("");
    setLocalTaxId("");
    setLocalCountry("KZ");
  };

  const submitAdd = async () => {
    if (!companyId || saving) return;
    if (addMode === "global" && !selectedGlobal?.global_counterparty_id) {
      toast({ title: "Выберите контрагента из ГЛБД", variant: "destructive" });
      return;
    }
    if (addMode === "local" && (!localName.trim() || !localTaxId.trim())) {
      toast({ title: "Укажите юридическое название и БИН/ИНН", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await createCounterparty({
        companyId,
        globalCounterpartyId: addMode === "global" ? selectedGlobal?.global_counterparty_id : null,
        name: addMode === "local" ? localName.trim() : selectedGlobal?.legal_name || "",
        type: role,
        binIin: addMode === "local" ? localTaxId.trim() : selectedGlobal?.tax_id,
        countryCode: addMode === "local" ? localCountry : selectedGlobal?.country_code,
      });
      setDialogOpen(false);
      resetDialog();
      await reload();
      toast({ title: "Контрагент добавлен" });
    } catch (cause) {
      toast({
        title: "Не удалось добавить контрагента",
        description: cause instanceof Error ? cause.message : "Неизвестная ошибка",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleArchived = async (row: Counterparty) => {
    try {
      await updateCounterparty(row.id, { companyId, archived: !row.archived });
      await reload();
      toast({ title: row.archived ? "Контрагент восстановлен" : "Контрагент архивирован" });
    } catch (cause) {
      toast({
        title: "Не удалось изменить статус",
        description: cause instanceof Error ? cause.message : "Неизвестная ошибка",
        variant: "destructive",
      });
    }
  };

  const emptyText = useMemo(() => {
    if (loading) return "Загрузка...";
    if (search) return "По вашему запросу ничего не найдено";
    return "Контрагентов пока нет";
  }, [loading, search]);

  return (
    <div className="space-y-5">
      <PageHeader title="Контрагенты" description="Одна организация может быть поставщиком и покупателем без дублирования БИН" />

      <div className="flex border-b border-slate-800">
        <Button variant={role === "supplier" ? "default" : "ghost"} className="rounded-none" onClick={() => setRole("supplier")}>Поставщики</Button>
        <Button variant={role === "buyer" ? "default" : "ghost"} className="rounded-none" onClick={() => setRole("buyer")}>Покупатели</Button>
      </div>

      <div className="flex flex-col gap-3 border-y border-slate-800 py-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <Input
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Название или БИН/ИНН"
          />
        </div>
        <Select value={country} onValueChange={(value) => setCountry(value as CounterpartyCountryCode | "all")}>
          <SelectTrigger className="w-full lg:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все страны</SelectItem>
            <SelectItem value="KZ">Казахстан</SelectItem>
            <SelectItem value="RU">Россия</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
          <SelectTrigger className="w-full lg:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Активные</SelectItem>
            <SelectItem value="archived">Архивные</SelectItem>
            <SelectItem value="all">Все статусы</SelectItem>
          </SelectContent>
        </Select>
        {canManage ? (
          <Button onClick={() => { resetDialog(); setDialogOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Добавить {role === "buyer" ? "покупателя" : "поставщика"}
          </Button>
        ) : null}
      </div>

      <div className="overflow-hidden border border-slate-800">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Юридическое название</TableHead>
              <TableHead>БИН/ИНН</TableHead>
              <TableHead>Страна</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Первое использование</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="font-medium">{row.legal_name}</div>
                  <div className="text-xs text-slate-500">{row.short_name || row.aliases[0] || (row.source === "global" ? "ГЛБД" : "Локальная запись")}</div>
                </TableCell>
                <TableCell className="font-mono">{row.tax_id || "—"}</TableCell>
                <TableCell>{row.country_name || "—"}</TableCell>
                <TableCell>
                  <Badge variant={row.archived || !row.is_active ? "secondary" : "default"}>
                    {row.archived || !row.is_active ? "Архивный" : "Активный"}
                  </Badge>
                </TableCell>
                <TableCell>{row.first_used_at ? new Date(row.first_used_at).toLocaleDateString("ru-RU") : "Ещё не использовался"}</TableCell>
                <TableCell>
                  {canManage ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="Действия"><MoreHorizontal className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => void toggleArchived(row)}>
                          {row.archived ? <RotateCcw className="mr-2 h-4 w-4" /> : <Archive className="mr-2 h-4 w-4" />}
                          {row.archived ? "Восстановить" : "Архивировать"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="h-28 text-center text-slate-500">{emptyText}</TableCell></TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(next) => { setDialogOpen(next); if (!next) resetDialog(); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>Добавить {role === "buyer" ? "покупателя" : "поставщика"}</DialogTitle></DialogHeader>
          <div className="flex border-b border-slate-800">
            <Button type="button" variant={addMode === "global" ? "default" : "ghost"} className="rounded-none" onClick={() => setAddMode("global")}>Из ГЛБД</Button>
            <Button type="button" variant={addMode === "local" ? "default" : "ghost"} className="rounded-none" onClick={() => setAddMode("local")}>Локальная запись</Button>
          </div>

          {addMode === "global" ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Поиск в ГЛБД</Label>
                <Input value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} placeholder="Название или БИН/ИНН" />
              </div>
              <div className="max-h-72 overflow-y-auto border border-slate-800">
                {globalResults.map((row) => (
                  <button
                    type="button"
                    key={row.key}
                    onClick={() => setSelectedGlobal(row)}
                    className={`flex w-full items-start gap-2 border-b border-slate-800 px-3 py-2 text-left last:border-b-0 ${selectedGlobal?.key === row.key ? "bg-slate-800" : "hover:bg-slate-900"}`}
                  >
                    <Building2 className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      <span className="block font-medium">{row.legal_name}</span>
                      <span className="block text-xs text-slate-400">{row.tax_id} — {row.country_name}</span>
                    </span>
                  </button>
                ))}
                {globalResults.length === 0 ? <div className="px-3 py-8 text-center text-sm text-slate-500">Контрагент не найден</div> : null}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-slate-400">Создавайте локальную запись только если контрагента действительно нет в ГЛБД.</p>
              <div className="space-y-2"><Label>Юридическое название</Label><Input value={localName} onChange={(event) => setLocalName(event.target.value)} /></div>
              <div className="space-y-2"><Label>БИН/ИНН</Label><Input inputMode="numeric" value={localTaxId} onChange={(event) => setLocalTaxId(event.target.value.replace(/\D/g, ""))} /></div>
              <div className="space-y-2">
                <Label>Страна</Label>
                <Select value={localCountry} onValueChange={(value) => setLocalCountry(value as CounterpartyCountryCode)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="KZ">Казахстан</SelectItem><SelectItem value="RU">Россия</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Отмена</Button>
            <Button onClick={() => void submitAdd()} disabled={saving}>{saving ? "Сохранение..." : "Добавить"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
