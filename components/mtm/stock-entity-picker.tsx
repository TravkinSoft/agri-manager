"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getMtmStockOptions } from "@/lib/services/mtm-stock";
import type { MtmStockOption, MtmStockOptionKind, MtmStockOptionsResponse } from "@/lib/mtm/stock-types";

const TITLES: Record<MtmStockOptionKind, string> = { warehouse: "Выбрать склад", employee: "Выбрать сотрудника", machine: "Выбрать машину", equipment: "Выбрать оборудование", transport: "Выбрать транспорт", task: "Выбрать задачу" };
const LIMIT = 20;

export function MtmStockEntityPicker({ companyId, kind, onPick, onClose }: { companyId: string; kind: MtmStockOptionKind; onPick: (item: MtmStockOption) => void; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<MtmStockOptionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setData(null);
    const timer = setTimeout(() => {
      void getMtmStockOptions({ companyId, kind, search, offset, limit: LIMIT }, controller.signal)
        .then((response) => { if (!controller.signal.aborted) setData(response); })
        .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Справочник недоступен."); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [companyId, kind, search, offset, retry]);

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
    <DialogHeader><DialogTitle>{TITLES[kind]}</DialogTitle><DialogDescription>Доступные записи выбранной компании.</DialogDescription></DialogHeader>
    <Input aria-label="Поиск записи" placeholder="Название…" maxLength={200} value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); setLoading(true); }} />
    {error ? <div role="alert"><p className="text-sm text-destructive">{error}</p><Button type="button" variant="outline" size="sm" onClick={() => setRetry((value) => value + 1)}>Повторить</Button></div> : loading ? <p role="status">Загрузка…</p> : data ? <>
      {data.items.length ? <ul className="divide-y">{data.items.map((item) => <li key={item.id}><button type="button" className="w-full rounded px-2 py-3 text-left hover:bg-accent focus-visible:outline focus-visible:outline-2" onClick={() => onPick(item)}>{item.name}</button></li>)}</ul> : <p className="text-sm text-muted-foreground">Подходящих записей нет.</p>}
      <div className="flex items-center justify-between gap-2 text-xs"><Button type="button" size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>Назад</Button><span>{data.total ? `${offset + 1}–${Math.min(offset + data.items.length, data.total)} из ${data.total}` : "0 записей"}</span><Button type="button" size="sm" variant="outline" disabled={offset + LIMIT >= data.total} onClick={() => setOffset(offset + LIMIT)}>Далее</Button></div>
    </> : null}
  </DialogContent></Dialog>;
}
