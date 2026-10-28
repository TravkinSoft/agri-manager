"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getMtmModels, getMtmProducts } from "@/lib/services/mtm";
import type { MtmModelKind, MtmModelOption, MtmProductOption } from "@/lib/mtm/types";

const PAGE_SIZE = 20;
type Option = MtmModelOption | MtmProductOption;

export function MtmOptionPicker({ companyId, kind, onPick, onClose }: {
  companyId: string;
  kind: "products" | MtmModelKind;
  onPick: (option: Option) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<Option[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      const query = { companyId, search, offset, limit: PAGE_SIZE };
      const operation = kind === "products"
        ? getMtmProducts(query, controller.signal)
        : getMtmModels({ ...query, kind }, controller.signal);
      void operation.then((result) => {
        if (controller.signal.aborted) return;
        setItems(result.items); setTotal(result.total);
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Не удалось загрузить справочник.");
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [companyId, kind, offset, search]);

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{kind === "products" ? "Выбрать товар Flow" : "Выбрать модель техники"}</DialogTitle>
        <DialogDescription>{kind === "products" ? "Материалы и ГСМ из существующего каталога. Если нужного товара нет, его заводит администратор общего каталога Flow." : "Выберите существующую модель. Это ещё не подтверждение совместимости."}</DialogDescription>
      </DialogHeader>
      <Input aria-label="Поиск в справочнике" maxLength={200} placeholder="Название…" value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); setLoading(true); }} />
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : loading ? <p role="status">Загрузка…</p> : <>
        {items.length === 0 ? <p className="text-sm text-muted-foreground">Совпадений нет. Попробуйте другое название.</p> : <ul className="divide-y">
          {items.map((item) => <li key={item.id}><button type="button" className="w-full rounded-sm px-2 py-3 text-left hover:bg-accent focus-visible:outline focus-visible:outline-2" onClick={() => onPick(item)}>
            <span className="block break-words font-medium">{item.name}</span>
            {"base_uom" in item ? <span className="text-xs text-muted-foreground">Единица: {item.base_uom || "не задана"}</span> : null}
          </button></li>)}
        </ul>}
        <div className="flex items-center justify-between gap-2 text-xs">
          <Button type="button" variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Назад</Button>
          <span>{total ? `${offset + 1}–${Math.min(offset + items.length, total)} из ${total}` : "0 результатов"}</span>
          <Button type="button" variant="outline" size="sm" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>Далее</Button>
        </div>
      </>}
    </DialogContent>
  </Dialog>;
}
