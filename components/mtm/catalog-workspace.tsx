"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MtmItemEditor, MTM_CATEGORY_LABELS } from "./item-editor";
import { MtmOptionPicker } from "./option-picker";
import { getMtmCatalog } from "@/lib/services/mtm";
import { normalizeScan, RequestEpoch, resolveScan, shouldOpenCatalogItem } from "@/lib/mtm/scan";
import type { MtmCatalogItem, MtmCatalogResponse, MtmProductOption } from "@/lib/mtm/types";

const PAGE_SIZE = 25;

export function MtmCatalogWorkspace({ companyId }: { companyId: string }) {
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [catalog, setCatalog] = useState<MtmCatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<MtmCatalogItem | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<MtmCatalogItem | null>(null);
  const [pickingProduct, setPickingProduct] = useState(false);
  const [scan, setScan] = useState("");
  const [scanMessage, setScanMessage] = useState("");
  const [scanning, setScanning] = useState(false);
  const scanEpoch = useRef(new RequestEpoch());
  const scanController = useRef<AbortController | null>(null);
  const scanInput = useRef<HTMLInputElement | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const savingRef = useRef(saving);
  savingRef.current = saving;

  const selectItem = useCallback((item: MtmCatalogItem, explicitReload = false) => {
    if (savingRef.current || !shouldOpenCatalogItem(selectedRef.current, item, explicitReload)) return;
    if (dirtyRef.current) { setPendingSelection(item); return; }
    setSelected(item); setDirty(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    const timer = setTimeout(() => {
      void getMtmCatalog({ companyId, offset, limit: PAGE_SIZE, search }, controller.signal).then((result) => {
        if (!controller.signal.aborted) setCatalog(result);
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) { setCatalog(null); setError(reason instanceof Error ? reason.message : "Не удалось загрузить МТМ."); }
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [companyId, offset, search, refresh]);
  useEffect(() => () => { scanEpoch.current.invalidate(); scanController.current?.abort(); }, []);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  async function lookupScan(event: FormEvent) {
    event.preventDefault();
    if (savingRef.current) return;
    scanController.current?.abort();
    const epoch = scanEpoch.current.next();
    let code: string;
    try { code = normalizeScan(scan); } catch (reason) { setScanMessage((reason as Error).message); setScanning(false); return; }
    const controller = new AbortController(); scanController.current = controller;
    setScanning(true); setScanMessage("");
    try {
      const result = await getMtmCatalog({ companyId, barcode: code, limit: 2 }, controller.signal);
      if (!scanEpoch.current.isCurrent(epoch) || controller.signal.aborted) return;
      const match = resolveScan(code, result.items, selectedRef.current?.product_id || null);
      if (match.status === "unknown") setScanMessage("Код не найден в МТМ. Текущая карточка не изменена.");
      else if (match.status === "ambiguous") setScanMessage("Код относится к нескольким карточкам. Уточните каталог у администратора.");
      else if (match.item) {
        setScanMessage(match.status === "repeated" ? "Повторный скан: эта карточка уже выбрана." : `Найдено: ${match.item.product.name}.`);
        selectItem(match.item);
      }
      setScan(""); scanInput.current?.focus();
    } catch (reason) {
      if (scanEpoch.current.isCurrent(epoch) && !controller.signal.aborted) setScanMessage(reason instanceof Error ? reason.message : "Поиск не выполнен.");
    } finally { if (scanEpoch.current.isCurrent(epoch) && !controller.signal.aborted) setScanning(false); }
  }

  function selectNew(product: MtmProductOption) {
    setPickingProduct(false);
    selectItem({ company_id: companyId, product_id: product.id, product, revision: 0, category: "part", part_number: null, barcode: null, internal_code: null, specifications: "", accounting_unit_note: "", applicability: [], updated_at: "", updated_by: "" });
  }

  return <div className="mx-auto max-w-7xl space-y-4 pb-8">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-semibold">МТМ</h1><p className="text-sm text-muted-foreground">Запчасти, расходники и применяемость</p></div><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>Обновить каталог</Button>{catalog?.can_edit ? <Button type="button" variant="outline" disabled={saving} onClick={() => setPickingProduct(true)}>Добавить из каталога Flow</Button> : null}</div></header>
    <div className="grid gap-3 lg:grid-cols-2">
      <label htmlFor="mtm-search" className="space-y-1 text-sm"><span>Поиск по названию, номеру или коду</span><Input id="mtm-search" maxLength={200} value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); setLoading(true); }} placeholder="Название или полный номер…" /></label>
      <form onSubmit={lookupScan} className="space-y-1"><label htmlFor="mtm-scan" className="text-sm">Сканер / точный штрихкод</label><div className="flex gap-2"><Input id="mtm-scan" disabled={saving} ref={scanInput} value={scan} onChange={(event) => setScan(event.target.value)} autoComplete="off" placeholder="Отсканируйте и нажмите Enter" /><Button type="submit" variant="outline" disabled={saving}>{scanning ? "Поиск…" : "Найти"}</Button></div></form>
    </div>
    <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{scanMessage || "Скан выбирает карточку. Сохранение реквизитов выполняется отдельной кнопкой."}</p>
    {error ? <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm"><p>{error}</p><Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => setRefresh((value) => value + 1)}>Повторить загрузку</Button></div> : null}
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.8fr)]">
      <section aria-label="Каталог МТМ" className="min-w-0 space-y-3">
        {loading ? <p role="status" className="py-4 text-sm">Загрузка каталога…</p> : catalog ? <>
          {catalog.items.length ? <ul className="space-y-2">{catalog.items.map((item) => <li key={item.product_id}><button type="button" aria-pressed={selected?.product_id === item.product_id} className={`w-full rounded-md border p-3 text-left focus-visible:outline focus-visible:outline-2 ${selected?.product_id === item.product_id ? "border-primary bg-accent" : "bg-card hover:bg-accent/50"}`} onClick={() => selectItem(item, true)}><span className="block break-words font-medium">{item.product.name}</span><span className="block text-xs text-muted-foreground">{MTM_CATEGORY_LABELS[item.category]} · {item.product.base_uom || "Единица не задана"}</span><span className="mt-1 block break-all text-sm">№ {item.part_number || "не указан"}</span>{item.barcode ? <span className="block break-all text-xs text-muted-foreground">Штрихкод: {item.barcode}</span> : null}</button></li>)}</ul> : <p className="rounded-md border p-4 text-sm text-muted-foreground">{search ? "Совпадений нет." : "В МТМ пока нет зарегистрированных товаров."}</p>}
          <div className="flex items-center justify-between gap-2 text-xs"><Button type="button" variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Назад</Button><span>{catalog.total ? `${offset + 1}–${Math.min(offset + catalog.items.length, catalog.total)} из ${catalog.total}` : "0 карточек"}</span><Button type="button" variant="outline" size="sm" disabled={offset + PAGE_SIZE >= catalog.total} onClick={() => setOffset(offset + PAGE_SIZE)}>Далее</Button></div>
        </> : null}
      </section>
      {selected ? <MtmItemEditor key={`${selected.product_id}:${selected.revision}`} item={selected} canEdit={Boolean(catalog?.can_edit)} onDirtyChange={setDirty} onBusyChange={setSaving} onSaved={(saved) => { setSelected(saved); setDirty(false); setRefresh((value) => value + 1); }} /> : <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">Выберите товар или найдите его сканером.</div>}
    </div>
    {pickingProduct ? <MtmOptionPicker companyId={companyId} kind="products" onClose={() => setPickingProduct(false)} onPick={(option) => selectNew(option as MtmProductOption)} /> : null}
    <Dialog open={Boolean(pendingSelection)} onOpenChange={(open) => { if (!open) setPendingSelection(null); }}><DialogContent><DialogHeader><DialogTitle>В карточке есть несохранённые изменения</DialogTitle><DialogDescription>Остаться в редакторе или отбросить изменения и открыть выбранный товар?</DialogDescription></DialogHeader><DialogFooter><Button type="button" variant="outline" onClick={() => setPendingSelection(null)}>Остаться</Button><Button type="button" variant="destructive" disabled={saving} onClick={() => { if (pendingSelection) { setSelected(pendingSelection); setDirty(false); setPendingSelection(null); } }}>Отбросить и открыть</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
