"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getMtmOperations, getMtmStock, isConfirmedMtmRejection, postMtmOperation, saveMtmMinimum } from "@/lib/services/mtm-stock";
import { acknowledgeMtmPendingRequest, createMtmPendingRequest, forgetRejectedMtmRequest, mtmPendingStorageKey, persistMtmPendingRequest, readMtmPendingRequest, type MtmPendingRequest } from "@/lib/mtm/stock-client-state";
import { mtmOperationSchema } from "@/lib/mtm/stock-validation";
import type { MtmMinimumRequest, MtmOperation, MtmOperationKind, MtmOperationRequest, MtmOperationsResponse, MtmStockItem, MtmStockOption, MtmStockResponse } from "@/lib/mtm/stock-types";
import { MtmStockEntityPicker } from "./stock-entity-picker";
import { MtmStockMinimumDialog, MtmStockOperationDialog, MTM_OPERATION_LABELS, MTM_STOCK_UNITS } from "./stock-operation-dialog";

const LIMIT = 20;
type OperationDraft = { kind: MtmOperationKind; item: MtmStockItem; issue?: MtmOperation };

function failureText(error: unknown) { return error instanceof Error ? error.message : "Запрос не выполнен."; }
function isPositive(value: string) { return /^\d+(\.\d+)?$/.test(value) && Number(value) > 0; }

export function MtmStockWorkspace({ companyId, actorId }: { companyId: string; actorId: string }) {
  const [warehouse, setWarehouse] = useState<MtmStockOption | null>(null);
  const [chooseWarehouse, setChooseWarehouse] = useState(false);
  const [search, setSearch] = useState("");
  const [belowMinimum, setBelowMinimum] = useState(false);
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [stock, setStock] = useState<MtmStockResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<MtmStockItem | null>(null);
  const [history, setHistory] = useState<MtmOperationsResponse | null>(null);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [draft, setDraft] = useState<OperationDraft | null>(null);
  const [minimum, setMinimum] = useState<MtmStockItem | null>(null);
  const [minimumBusy, setMinimumBusy] = useState(false);
  const [pending, setPending] = useState<MtmPendingRequest | null>(null);
  const [pendingBusy, setPendingBusy] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [notice, setNotice] = useState("");
  const pendingBusyRef = useRef(false);
  const pendingRef = useRef<MtmPendingRequest | null>(null);
  const alive = useRef(true);
  const storageKey = mtmPendingStorageKey(actorId, companyId);
  const warehouseId = warehouse?.id;
  const selectedProductId = selected?.product_id;
  const locked = !storageReady || Boolean(storageError) || Boolean(pending) || minimumBusy;

  useEffect(() => {
    alive.current = true;
    try {
      const saved = readMtmPendingRequest(window.sessionStorage, storageKey, companyId);
      if (saved && !mtmOperationSchema.safeParse(JSON.parse(saved.body)).success) throw new Error("Сохранённая операция не прошла проверку. Новые движения заблокированы до сверки журнала.");
      pendingRef.current = saved; setPending(saved); setStorageReady(true);
    } catch (reason) { setStorageError(failureText(reason)); }
    return () => { alive.current = false; };
  }, [companyId, storageKey]);

  useEffect(() => {
    if (!pending && !minimumBusy && !draft && !minimum) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [pending, minimumBusy, draft, minimum]);

  useEffect(() => {
    if (!warehouseId) { setStock(null); return; }
    const controller = new AbortController(); setLoading(true); setError("");
    const timer = setTimeout(() => {
      void getMtmStock({ companyId, warehouseId, search, belowMinimum, offset, limit: LIMIT }, controller.signal)
        .then((result) => { if (!controller.signal.aborted) { setStock(result); setSelected((previous) => previous ? result.items.find((item) => item.product_id === previous.product_id && item.warehouse_id === previous.warehouse_id) || previous : null); } })
        .catch((reason: unknown) => { if (!controller.signal.aborted) { setStock(null); setError(failureText(reason)); } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [companyId, warehouseId, search, belowMinimum, offset, refresh]);

  useEffect(() => {
    if (!warehouseId || !selectedProductId) { setHistory(null); return; }
    const controller = new AbortController(); setHistoryLoading(true); setHistoryError(""); setHistory(null);
    void getMtmOperations({ companyId, warehouseId, productId: selectedProductId, offset: historyOffset, limit: LIMIT }, controller.signal)
      .then((response) => { if (!controller.signal.aborted) setHistory(response); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setHistoryError(failureText(reason)); })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [companyId, warehouseId, selectedProductId, historyOffset, refresh]);

  async function performPending(request: MtmPendingRequest, firstAttempt = false) {
    if (pendingBusyRef.current) return;
    pendingBusyRef.current = true; setPendingBusy(true); setNotice(""); setError("");
    try {
      const operation = await postMtmOperation(request);
      acknowledgeMtmPendingRequest(window.sessionStorage, storageKey, request, operation.id);
      pendingRef.current = null;
      if (alive.current) { setPending(null); setNotice(`${MTM_OPERATION_LABELS[operation.kind]} подтверждён: ${operation.quantity} ${MTM_STOCK_UNITS[operation.uom]}. Запись № ${operation.id}.`); setRefresh((value) => value + 1); }
    } catch (reason) {
      // A rejection of a RETRY cannot disprove an earlier committed request.
      if (isConfirmedMtmRejection(reason, firstAttempt)) {
        try {
          forgetRejectedMtmRequest(window.sessionStorage, storageKey, request);
          pendingRef.current = null;
          if (alive.current) { setPending(null); setError(`Операция отклонена: ${failureText(reason)}`); setRefresh((value) => value + 1); }
        } catch (storageFailure) { if (alive.current) setStorageError(failureText(storageFailure)); }
      } else if (alive.current) setError(`Результат не подтверждён. ${failureText(reason)} Не создавайте операцию заново; проверьте сохранённый запрос.`);
    } finally { pendingBusyRef.current = false; if (alive.current) setPendingBusy(false); }
  }

  async function submitOperation(body: MtmOperationRequest) {
    if (locked || pendingRef.current || pendingBusyRef.current) throw new Error("Сначала выясните исход предыдущей операции.");
    const request = createMtmPendingRequest(body, crypto.randomUUID());
    // Persist before any HTTP write. A storage failure prevents submission.
    persistMtmPendingRequest(window.sessionStorage, storageKey, request);
    pendingRef.current = request; setPending(request); setDraft(null);
    await performPending(request, true);
  }

  async function submitMinimum(body: MtmMinimumRequest) {
    if (locked || pendingRef.current || pendingBusyRef.current) throw new Error("Сначала выясните исход предыдущей операции.");
    setMinimumBusy(true);
    try {
      const result = await saveMtmMinimum(body);
      if (alive.current) { setMinimum(null); setNotice(`Минимум сохранён: ${result.minimum_quantity}.`); setRefresh((value) => value + 1); }
    } catch (reason) {
      // The fixed expected_revision makes a retry unable to overwrite a newer edit.
      if (alive.current) setRefresh((value) => value + 1);
      throw reason;
    } finally { if (alive.current) setMinimumBusy(false); }
  }

  const selectedUnavailable = Boolean(selected?.warehouse_archived || selected?.stock_blocked);
  return <div className="mx-auto max-w-7xl space-y-4 pb-8">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-semibold">Склад МТМ</h1><p className="text-sm text-muted-foreground">Приход, выдача и возврат запчастей и расходников</p></div><Button type="button" variant="outline" disabled={loading || !warehouseId} onClick={() => setRefresh((value) => value + 1)}>Обновить</Button></header>
    {storageError ? <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{storageError}</p> : null}
    {pending ? <section aria-label="Незавершённая операция" className="space-y-2 rounded-md border border-amber-500/60 p-3"><p className="font-medium">Есть запрос с неподтверждённым исходом</p><p className="text-sm">Новые движения заблокированы. Проверка отправит тот же запрос и не создаст повтор при уже проведённой операции.</p><p className="break-all text-xs text-muted-foreground">Запрос {pending.key} · {new Date(pending.createdAt).toLocaleString("ru-RU")}</p><Button type="button" variant="outline" disabled={pendingBusy || Boolean(storageError)} onClick={() => { void performPending(pending); }}>{pendingBusy ? "Проверка…" : "Проверить сохранённый запрос"}</Button></section> : null}
    {notice ? <p role="status" className="break-words text-sm">{notice}</p> : null}
    {error ? <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{error}</p> : null}
    <div className="flex flex-wrap items-end gap-3"><div className="space-y-1"><span className="block text-sm">Склад</span><Button type="button" variant="outline" disabled={minimumBusy} onClick={() => setChooseWarehouse(true)}>{warehouse?.name || "Выбрать склад"}</Button></div><label className="min-w-[12rem] flex-1 space-y-1 text-sm"><span>Товар</span><Input value={search} maxLength={200} placeholder="Найти товар…" onChange={(event) => { setSearch(event.target.value); setOffset(0); setLoading(true); }} /></label><label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={belowMinimum} onChange={(event) => { setBelowMinimum(event.target.checked); setOffset(0); setLoading(true); }} />Ниже минимума</label></div>
    {!warehouseId ? <p className="py-6 text-sm text-muted-foreground">Выберите склад. Остатки будут показаны по его движениям.</p> : loading ? <p role="status">Загрузка остатков…</p> : stock ? <>
      {!stock.can_operate ? <p className="text-sm text-muted-foreground">Доступен просмотр. Движения проводит кладовщик.</p> : null}
      <div className="overflow-x-auto"><table className="w-full min-w-[42rem] text-left text-sm"><caption className="sr-only">Остатки склада МТМ</caption><thead><tr className="border-b"><th className="py-2 pr-3">Товар</th><th className="px-2 py-2 text-right">Остаток</th><th className="px-2 py-2 text-right">Резерв</th><th className="px-2 py-2 text-right">Доступно</th><th className="px-2 py-2 text-right">Минимум</th></tr></thead><tbody>{stock.items.map((item) => <tr key={`${item.warehouse_id}:${item.product_id}`} className={`border-b ${selected?.product_id === item.product_id ? "bg-accent" : ""}`}><td className="py-2 pr-3"><button type="button" className="rounded text-left font-medium underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2" onClick={() => { setSelected(item); setHistoryOffset(0); }}>{item.product_name}</button><span className="block text-xs text-muted-foreground">{MTM_STOCK_UNITS[item.uom]}{item.product_archived ? " · товар в архиве" : ""}{item.warehouse_archived ? " · склад в архиве" : ""}</span>{item.stock_blocked ? <span className="block text-xs text-destructive">Остаток не подтверждён: требуется сверка учёта</span> : item.below_minimum ? <span className="block text-xs text-amber-700 dark:text-amber-300">Ниже минимума</span> : null}</td><td className="px-2 py-2 text-right tabular-nums">{item.stock_blocked ? "—" : item.balance}</td><td className="px-2 py-2 text-right tabular-nums">{item.stock_blocked ? "—" : item.reserved}</td><td className="px-2 py-2 text-right tabular-nums">{item.stock_blocked ? "—" : item.available}</td><td className="px-2 py-2 text-right tabular-nums">{item.minimum_quantity ?? "Не задан"}</td></tr>)}</tbody></table></div>
      {!stock.items.length ? <p className="text-sm text-muted-foreground">{belowMinimum ? "Нет позиций ниже минимума по выбранному фильтру." : "Нет подходящих позиций. Сначала зарегистрируйте товар во вкладке «Каталог»."}</p> : null}
      <div className="flex items-center justify-between gap-2 text-xs"><Button type="button" variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>Назад</Button><span>{stock.total ? `${offset + 1}–${Math.min(offset + stock.items.length, stock.total)} из ${stock.total}` : "0 позиций"}</span><Button type="button" variant="outline" size="sm" disabled={offset + LIMIT >= stock.total} onClick={() => setOffset(offset + LIMIT)}>Далее</Button></div>
    </> : null}
    {selected && warehouseId ? <section aria-label="Движения выбранного товара" className="space-y-3 border-t pt-4"><header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">{selected.product_name}</h2><p className="text-sm text-muted-foreground">{selected.warehouse_name} · {MTM_STOCK_UNITS[selected.uom]}</p></div><div className="flex flex-wrap gap-2">{stock?.can_operate ? <><Button type="button" variant="outline" disabled={locked || loading || selectedUnavailable || selected.product_archived} onClick={() => setDraft({ kind: "receipt", item: selected })}>Приход</Button><Button type="button" variant="outline" disabled={locked || loading || selectedUnavailable || selected.product_archived} onClick={() => setDraft({ kind: "issue", item: selected })}>Выдать</Button></> : null}{stock?.can_manage_minimums ? <Button type="button" variant="outline" disabled={locked || loading || selectedUnavailable || selected.product_archived} onClick={() => setMinimum(selected)}>Минимум</Button> : null}</div></header>
      {selected.stock_blocked ? <p role="alert" className="text-sm text-destructive">Учёт позиции требует сверки. Новые движения недоступны.</p> : null}
      {historyError ? <p role="alert" className="text-sm text-destructive">{historyError}</p> : historyLoading ? <p role="status">Загрузка истории…</p> : history ? <>
        {history.items.length ? <ul className="divide-y">{history.items.map((operation) => <li key={operation.id} className="flex flex-wrap items-start justify-between gap-3 py-3"><div className="min-w-0 flex-1"><p className="font-medium">{MTM_OPERATION_LABELS[operation.kind]} · {operation.quantity} {MTM_STOCK_UNITS[operation.uom]}</p><p className="break-words text-sm">{operation.purpose}</p><p className="break-words text-xs text-muted-foreground">{new Date(operation.created_at).toLocaleString("ru-RU")}{operation.recipient_name ? ` · ${operation.recipient_name}` : ""}{operation.asset_name ? ` · ${operation.asset_name}` : ""}{operation.task_name ? ` · ${operation.task_name}` : ""}</p><p className="break-all text-xs text-muted-foreground">Автор: {operation.created_by_name || "Автор не указан"}</p><details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Реквизиты записи</summary><p className="break-all">Запись: {operation.id} · ID автора: {operation.created_by}{operation.original_issue_id ? ` · Исходная выдача: ${operation.original_issue_id}` : ""}</p></details>{operation.kind === "issue" ? <p className="text-xs">Можно вернуть: {operation.remaining_returnable} {MTM_STOCK_UNITS[operation.uom]}</p> : null}</div>{operation.kind === "issue" && isPositive(operation.remaining_returnable) && stock?.can_operate ? <Button type="button" variant="outline" size="sm" disabled={locked || selectedUnavailable} onClick={() => setDraft({ kind: "return", item: { ...selected, uom: operation.uom }, issue: operation })}>Вернуть по выдаче</Button> : null}</li>)}</ul> : <p className="text-sm text-muted-foreground">Операций МТМ по этой позиции пока нет. Остаток учитывает общий складской журнал.</p>}
        <div className="flex items-center justify-between gap-2 text-xs"><Button type="button" size="sm" variant="outline" disabled={historyOffset === 0} onClick={() => setHistoryOffset(Math.max(0, historyOffset - LIMIT))}>Раньше в списке</Button><span>{history.total ? `${historyOffset + 1}–${Math.min(historyOffset + history.items.length, history.total)} из ${history.total}` : "0 операций"}</span><Button type="button" size="sm" variant="outline" disabled={historyOffset + LIMIT >= history.total} onClick={() => setHistoryOffset(historyOffset + LIMIT)}>Следующие</Button></div>
      </> : null}
    </section> : null}
    {chooseWarehouse ? <MtmStockEntityPicker companyId={companyId} kind="warehouse" onClose={() => setChooseWarehouse(false)} onPick={(item) => { setWarehouse(item); setSelected(null); setHistoryOffset(0); setOffset(0); setStock(null); setChooseWarehouse(false); }} /> : null}
    {draft ? <MtmStockOperationDialog companyId={companyId} {...draft} onClose={() => setDraft(null)} onSubmit={submitOperation} /> : null}
    {minimum ? <MtmStockMinimumDialog companyId={companyId} item={minimum} onClose={() => setMinimum(null)} onSubmit={submitMinimum} /> : null}
  </div>;
}
