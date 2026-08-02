"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, MoreHorizontal, RotateCcw, Search } from "lucide-react";
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
import { COUNTERPARTY_COUNTRY_LABELS } from "@/lib/counterparties/catalog";
import { listGlobalCounterparties, updateGlobalCounterparty } from "@/lib/services/global-counterparties";
import type { CounterpartyCountryCode, GlobalCounterparty } from "@/lib/types/counterparty";

export default function GlobalCounterpartiesPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<GlobalCounterparty[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState<CounterpartyCountryCode | "all">("all");
  const [status, setStatus] = useState<"active" | "archived" | "all">("active");
  const [editing, setEditing] = useState<GlobalCounterparty | null>(null);
  const [legalName, setLegalName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [editCountry, setEditCountry] = useState<CounterpartyCountryCode>("KZ");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listGlobalCounterparties({ search, country, status }));
    } catch (cause) {
      toast({
        title: "Не удалось загрузить ГЛБД контрагентов",
        description: cause instanceof Error ? cause.message : "Неизвестная ошибка",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [country, search, status, toast]);

  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 180);
    return () => window.clearTimeout(timer);
  }, [reload]);

  const openEdit = (row: GlobalCounterparty) => {
    setEditing(row);
    setLegalName(row.legal_name);
    setTaxId(row.tax_id);
    setEditCountry(row.country_code);
  };

  const save = async () => {
    if (!editing || !legalName.trim() || !taxId.trim()) return;
    setSaving(true);
    try {
      await updateGlobalCounterparty(editing.id, {
        legalName: legalName.trim(),
        taxId: taxId.trim(),
        countryCode: editCountry,
      });
      setEditing(null);
      await reload();
      toast({ title: "Контрагент обновлён" });
    } catch (cause) {
      toast({
        title: "Не удалось сохранить",
        description: cause instanceof Error ? cause.message : "Неизвестная ошибка",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleArchive = async (row: GlobalCounterparty) => {
    try {
      await updateGlobalCounterparty(row.id, { archived: !row.archived });
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

  return (
    <div className="space-y-3">
      <div className="border border-[#9aa8ba] bg-white">
        <div className="border-b border-[#9aa8ba] bg-[#d7dde6] px-3 py-2">
          <h1 className="font-mono text-sm font-semibold uppercase text-[#18324f]">Контрагенты</h1>
          <p className="mt-1 text-xs text-[#52657b]">Глобальные юридические идентичности поставщиков</p>
        </div>
        <div className="flex flex-col gap-2 p-3 lg:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#69788d]" />
            <Input className="rounded-none border-[#9aa8ba] bg-white pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Название или БИН/ИНН" />
          </div>
          <Select value={country} onValueChange={(value) => setCountry(value as typeof country)}>
            <SelectTrigger className="w-full rounded-none border-[#9aa8ba] bg-white lg:w-44"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Все страны</SelectItem><SelectItem value="KZ">Казахстан</SelectItem><SelectItem value="RU">Россия</SelectItem></SelectContent>
          </Select>
          <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
            <SelectTrigger className="w-full rounded-none border-[#9aa8ba] bg-white lg:w-44"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="active">Активные</SelectItem><SelectItem value="archived">Архивные</SelectItem><SelectItem value="all">Все статусы</SelectItem></SelectContent>
          </Select>
        </div>
      </div>

      <div className="overflow-hidden border border-[#9aa8ba] bg-white">
        <Table>
          <TableHeader><TableRow className="bg-[#eef1f5]"><TableHead>Юридическое название</TableHead><TableHead>БИН/ИНН</TableHead><TableHead>Страна</TableHead><TableHead>Статус</TableHead><TableHead className="w-12" /></TableRow></TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.legal_name}</TableCell>
                <TableCell className="font-mono">{row.tax_id}</TableCell>
                <TableCell>{COUNTERPARTY_COUNTRY_LABELS[row.country_code]}</TableCell>
                <TableCell><Badge variant={row.archived || !row.is_active ? "secondary" : "default"}>{row.archived || !row.is_active ? "Архивный" : "Активный"}</Badge></TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Действия"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(row)}>Редактировать</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void toggleArchive(row)}>
                        {row.archived ? <RotateCcw className="mr-2 h-4 w-4" /> : <Archive className="mr-2 h-4 w-4" />}
                        {row.archived ? "Восстановить" : "Архивировать"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 ? <TableRow><TableCell colSpan={5} className="h-28 text-center text-[#69788d]">{loading ? "Загрузка..." : "Записи не найдены"}</TableCell></TableRow> : null}
          </TableBody>
        </Table>
      </div>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Редактировать контрагента</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2"><Label>Юридическое название</Label><Input value={legalName} onChange={(event) => setLegalName(event.target.value)} /></div>
            <div className="space-y-2"><Label>БИН/ИНН</Label><Input inputMode="numeric" value={taxId} onChange={(event) => setTaxId(event.target.value.replace(/\D/g, ""))} /></div>
            <div className="space-y-2"><Label>Страна</Label><Select value={editCountry} onValueChange={(value) => setEditCountry(value as CounterpartyCountryCode)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="KZ">Казахстан</SelectItem><SelectItem value="RU">Россия</SelectItem></SelectContent></Select></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>Отмена</Button><Button onClick={() => void save()} disabled={saving}>{saving ? "Сохранение..." : "Сохранить"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
