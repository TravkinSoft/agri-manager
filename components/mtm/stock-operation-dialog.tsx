"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MtmStockEntityPicker } from "./stock-entity-picker";
import { mtmMinimumSchema, mtmOperationSchema } from "@/lib/mtm/stock-validation";
import type { MtmAssetKind, MtmMinimumRequest, MtmOperation, MtmOperationKind, MtmOperationRequest, MtmStockItem, MtmStockOption, MtmStockOptionKind } from "@/lib/mtm/stock-types";

export const MTM_STOCK_UNITS = { pcs: "шт.", kg: "кг", l: "л" } as const;
export const MTM_OPERATION_LABELS = { receipt: "Приход", issue: "Выдача", return: "Возврат" } as const;
const CONFIRM_LABELS = { receipt: "Подтвердить приход", issue: "Подтвердить выдачу", return: "Подтвердить возврат" } as const;

function preventImplicitSubmit(event: KeyboardEvent<HTMLFormElement>) {
  if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
}

export function MtmStockOperationDialog({ companyId, kind, item, issue, onClose, onSubmit }: {
  companyId: string; kind: MtmOperationKind; item: MtmStockItem; issue?: MtmOperation;
  onClose: () => void; onSubmit: (body: MtmOperationRequest) => Promise<void>;
}) {
  const [quantity, setQuantity] = useState("");
  const [purpose, setPurpose] = useState("");
  const [recipient, setRecipient] = useState<MtmStockOption | null>(null);
  const [assetKind, setAssetKind] = useState<MtmAssetKind | "">("");
  const [asset, setAsset] = useState<MtmStockOption | null>(null);
  const [task, setTask] = useState<MtmStockOption | null>(null);
  const [picker, setPicker] = useState<MtmStockOptionKind | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const parsed = mtmOperationSchema.safeParse({ companyId, kind, warehouse_id: item.warehouse_id, product_id: item.product_id, quantity: quantity.trim(), uom: item.uom, purpose,
      recipient_id: kind === "issue" ? recipient?.id || null : null,
      asset_kind: kind === "issue" ? assetKind || null : null, asset_id: kind === "issue" ? asset?.id || null : null,
      task_id: kind === "issue" ? task?.id || null : null, original_issue_id: kind === "return" ? issue?.id || null : null });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message || "Проверьте реквизиты."); return; }
    setError(""); setBusy(true);
    try { await onSubmit(parsed.data); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Операция не отправлена."); setBusy(false); }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
    <DialogHeader><DialogTitle>{MTM_OPERATION_LABELS[kind]}: {item.product_name}</DialogTitle><DialogDescription>{item.warehouse_name} · Учёт в {MTM_STOCK_UNITS[item.uom]}.</DialogDescription></DialogHeader>
    <form onSubmit={submit} onKeyDown={preventImplicitSubmit} className="space-y-4">
      <p className="text-sm">{kind === "return" ? `По исходной выдаче можно вернуть: ${issue?.remaining_returnable || "0"} ${MTM_STOCK_UNITS[item.uom]}.` : `Доступно: ${item.available} ${MTM_STOCK_UNITS[item.uom]}. Остаток: ${item.balance}, зарезервировано: ${item.reserved}.`}</p>
      {kind === "return" && issue ? <p className="break-words text-xs text-muted-foreground">Выдача от {new Date(issue.created_at).toLocaleString("ru-RU")} · {issue.purpose}{issue.recipient_name ? ` · ${issue.recipient_name}` : ""}. Возврат связан с этой выдачей.</p> : null}
      <label className="block space-y-1 text-sm"><span>Количество, {MTM_STOCK_UNITS[item.uom]} *</span><Input value={quantity} onChange={(event) => setQuantity(event.target.value.replace(",", "."))} disabled={busy} inputMode={item.uom === "pcs" ? "numeric" : "decimal"} autoComplete="off" placeholder={item.uom === "pcs" ? "Целое количество" : "Например, 2.5"} /><span className="block text-xs text-muted-foreground">{item.uom === "pcs" ? "Целые штуки по единице учёта товара." : "До 3 знаков после точки. Упаковки автоматически не пересчитываются."}</span></label>
      <label className="block space-y-1 text-sm"><span>{kind === "receipt" ? "Документ / основание прихода" : kind === "return" ? "Основание возврата" : "Назначение / основание выдачи"} *</span><Textarea value={purpose} disabled={busy} onChange={(event) => setPurpose(event.target.value)} maxLength={1000} rows={3} placeholder={kind === "issue" ? "Для чего выданы материалы" : "Укажите основание"} /></label>
      {kind === "issue" ? <div className="space-y-3">
        <div className="space-y-1"><span className="text-sm">Получатель, если известен</span><div className="flex gap-2"><Button type="button" variant="outline" className="min-w-0 flex-1 justify-start overflow-hidden" disabled={busy} onClick={() => setPicker("employee")}>{recipient?.name || "Выбрать сотрудника"}</Button>{recipient ? <Button type="button" variant="ghost" disabled={busy} onClick={() => setRecipient(null)}>Убрать</Button> : null}</div></div>
        <div className="space-y-1"><label htmlFor="mtm-stock-asset-kind" className="text-sm">Техника — необязательно</label><div className="flex flex-wrap gap-2"><select id="mtm-stock-asset-kind" disabled={busy} className="h-10 rounded-md border bg-background px-2 text-sm" value={assetKind} onChange={(event) => { setAssetKind(event.target.value as MtmAssetKind | ""); setAsset(null); }}><option value="">Не указывать</option><option value="machine">Машина</option><option value="equipment">Оборудование</option><option value="transport">Транспорт</option></select>{assetKind ? <Button type="button" variant="outline" disabled={busy} onClick={() => setPicker(assetKind)}>{asset?.name || "Выбрать конкретную технику"}</Button> : null}</div></div>
        <div className="space-y-1"><span className="text-sm">Задача — необязательно</span><div className="flex gap-2"><Button type="button" variant="outline" className="min-w-0 flex-1 justify-start overflow-hidden" disabled={busy} onClick={() => setPicker("task")}>{task?.name || "Выбрать задачу"}</Button>{task ? <Button type="button" variant="ghost" disabled={busy} onClick={() => setTask(null)}>Убрать</Button> : null}</div></div>
        <p className="text-xs text-muted-foreground">Для общих нужд достаточно основания. Выдача детали не отмечает её установку.</p>
      </div> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Отмена</Button><Button type="submit" disabled={busy}>{busy ? "Отправка…" : CONFIRM_LABELS[kind]}</Button></DialogFooter>
    </form>
    {picker ? <MtmStockEntityPicker companyId={companyId} kind={picker} onClose={() => setPicker(null)} onPick={(option) => { if (picker === "employee") setRecipient(option); else if (picker === "task") setTask(option); else setAsset(option); setPicker(null); }} /> : null}
  </DialogContent></Dialog>;
}

export function MtmStockMinimumDialog({ companyId, item, onClose, onSubmit }: { companyId: string; item: MtmStockItem; onClose: () => void; onSubmit: (body: MtmMinimumRequest) => Promise<void> }) {
  const [quantity, setQuantity] = useState(item.minimum_quantity || "0");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    const parsed = mtmMinimumSchema.safeParse({ companyId, warehouse_id: item.warehouse_id, product_id: item.product_id, quantity: quantity.trim(), expected_revision: item.minimum_revision });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message || "Проверьте минимум."); return; }
    if (item.uom === "pcs" && parsed.data.quantity.includes(".")) { setError("Минимум в штуках должен быть целым."); return; }
    setBusy(true); setError("");
    try { await onSubmit(parsed.data); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Изменение не подтверждено."); setBusy(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Минимальный остаток</DialogTitle><DialogDescription>{item.product_name} · {item.warehouse_name}</DialogDescription></DialogHeader><form onSubmit={submit} onKeyDown={preventImplicitSubmit} className="space-y-4"><label className="block space-y-1 text-sm"><span>Минимум, {MTM_STOCK_UNITS[item.uom]}</span><Input value={quantity} disabled={busy} onChange={(event) => setQuantity(event.target.value.replace(",", "."))} inputMode={item.uom === "pcs" ? "numeric" : "decimal"} /><span className="block text-xs text-muted-foreground">Ноль отключает предупреждение. Изменение минимума не создаёт движение.</span></label>{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}<DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Закрыть</Button><Button type="submit" disabled={busy}>{busy ? "Сохранение…" : "Сохранить минимум"}</Button></DialogFooter></form></DialogContent></Dialog>;
}
