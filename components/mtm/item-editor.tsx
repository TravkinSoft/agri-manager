"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MtmOptionPicker } from "./option-picker";
import { MtmApiError, saveMtmItem } from "@/lib/services/mtm";
import type { MtmApplicability, MtmCatalogItem, MtmCategory, MtmMetadataInput, MtmModelKind, MtmModelOption } from "@/lib/mtm/types";

export const MTM_CATEGORY_LABELS: Record<MtmCategory, string> = {
  part: "Запчасть", lubricant: "Масло / смазка", ppe: "СИЗ", tire: "Шина / колесо", consumable: "Расходный материал",
};
const KIND_LABELS: Record<MtmModelKind, string> = { machine: "Сельхозтехника", equipment: "Оборудование / орудие", transport: "Транспорт" };
const STATUS_LABELS = { pending: "Не подтверждено", confirmed: "Подтверждено источником", rejected: "Не подходит" };
const SELECT_CLASS = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60";

function metadata(item: MtmCatalogItem): MtmMetadataInput {
  return {
    category: item.category, part_number: item.part_number, barcode: item.barcode,
    internal_code: item.internal_code, specifications: item.specifications, accounting_unit_note: item.accounting_unit_note,
    applicability: item.applicability.map(({ model_kind, model_id, node, status, source, restrictions }) => ({ model_kind, model_id, node, status, source, restrictions })),
  };
}

export function MtmItemEditor({ item, canEdit, onDirtyChange, onBusyChange, onSaved }: {
  item: MtmCatalogItem;
  canEdit: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  onSaved: (item: MtmCatalogItem) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(() => metadata(item));
  const [editing, setEditing] = useState(item.revision === 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [modelKind, setModelKind] = useState<MtmModelKind>("machine");
  const [pickModel, setPickModel] = useState(false);
  const [modelNames, setModelNames] = useState<Record<string, string>>(() => Object.fromEntries(item.applicability.map((entry) => [`${entry.model_kind}:${entry.model_id}`, entry.model_name || entry.model_id])));
  const saveController = useRef<AbortController | null>(null);
  useEffect(() => () => saveController.current?.abort(), []);
  const disabled = !canEdit || !editing || busy;
  function update(patch: Partial<MtmMetadataInput>) { setDraft((previous) => ({ ...previous, ...patch })); onDirtyChange(true); }
  function updateApplicability(index: number, patch: Partial<MtmApplicability>) {
    update({ applicability: draft.applicability.map((entry, current) => current === index ? { ...entry, ...patch } : entry) });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (disabled || saveController.current) return;
    const missingSource = draft.applicability.some((entry) => entry.status === "confirmed" && !entry.source?.trim());
    if (missingSource) { setError("Укажите источник для каждой подтверждённой применяемости."); return; }
    const controller = new AbortController(); saveController.current = controller;
    setBusy(true); onBusyChange(true); setError("");
    try {
      const result = await saveMtmItem(item.product_id, { ...draft, companyId: item.company_id, expected_revision: item.revision }, controller.signal);
      if (!controller.signal.aborted) { onDirtyChange(false); onSaved(result.item); }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof MtmApiError && reason.code === "MTM_REVISION_CONFLICT" ? "Карточка уже изменена другим пользователем. Нажмите «Обновить каталог», затем выберите эту карточку заново. Перед заменой черновика появится подтверждение." : reason instanceof Error ? reason.message : "Карточка не сохранена.");
    } finally {
      if (!controller.signal.aborted) { setBusy(false); onBusyChange(false); saveController.current = null; }
    }
  }

  return <section className="min-w-0 rounded-md border bg-card p-3 sm:p-4" aria-labelledby={`${id}-title`}>
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h2 id={`${id}-title`} className="break-words text-lg font-semibold">{item.product.name}</h2>
        <p className="text-sm text-muted-foreground">Единица каталога: {item.product.base_uom || "не задана"}{item.product.pack_uom ? ` · упаковка: ${item.product.pack_uom}${item.product.units_per_pack != null ? `, ${item.product.units_per_pack} ед.` : ""}` : ""}</p>
      </div>
      {canEdit && !editing ? <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>Изменить</Button> : null}
    </div>
    <form onSubmit={save} onKeyDown={(event) => { if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") event.preventDefault(); }}>
      <fieldset disabled={disabled} className="min-w-0 space-y-4">
        <legend className="sr-only">Реквизиты МТМ</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label htmlFor={`${id}-category`} className="space-y-1 text-sm"><span>Категория</span><select id={`${id}-category`} className={SELECT_CLASS} value={draft.category} onChange={(event) => update({ category: event.target.value as MtmCategory })}>{Object.entries(MTM_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label htmlFor={`${id}-part`} className="space-y-1 text-sm"><span>Полный номер детали</span><Input id={`${id}-part`} value={draft.part_number || ""} maxLength={200} onChange={(event) => update({ part_number: event.target.value || null })} placeholder="Если присвоен производителем" /></label>
          <label htmlFor={`${id}-barcode`} className="space-y-1 text-sm"><span>Штрихкод</span><Input id={`${id}-barcode`} value={draft.barcode || ""} maxLength={128} onChange={(event) => update({ barcode: event.target.value || null })} autoComplete="off" /></label>
          <label htmlFor={`${id}-internal`} className="space-y-1 text-sm"><span>Внутренний код</span><Input id={`${id}-internal`} value={draft.internal_code || ""} maxLength={200} onChange={(event) => update({ internal_code: event.target.value || null })} /></label>
        </div>
        <label htmlFor={`${id}-specifications`} className="block space-y-1 text-sm"><span>Характеристики *</span><Textarea id={`${id}-specifications`} value={draft.specifications} required maxLength={4000} onChange={(event) => update({ specifications: event.target.value })} placeholder="Например: размер перчаток, вязкость и допуск масла, размер подшипника" /></label>
        <label htmlFor={`${id}-unit`} className="block space-y-1 text-sm"><span>Что означает одна учётная единица *</span><Input id={`${id}-unit`} value={draft.accounting_unit_note} required maxLength={500} onChange={(event) => update({ accounting_unit_note: event.target.value })} placeholder="Например: 1 шт. = 1 пара перчаток" /><span className="block text-xs text-muted-foreground">Уточните предмет или пару. Это описание; единица и количество в каталоге не пересчитываются.</span></label>
        <div className="space-y-3 border-t pt-3">
          <h3 className="font-medium">Применяемость</h3>
          {draft.applicability.length === 0 ? <p className="text-sm text-muted-foreground">Применяемость не указана. Совместимость с техникой не подтверждена; обычным расходникам связь с техникой может не требоваться.</p> : null}
          {draft.applicability.map((entry, index) => <div key={`${entry.model_kind}:${entry.model_id}:${index}`} className="rounded-md border bg-background p-3">
            <div className="mb-3 flex items-start justify-between gap-2"><div className="min-w-0"><h4 className="break-words text-sm font-semibold">{modelNames[`${entry.model_kind}:${entry.model_id}`] || entry.model_id}</h4><p className="text-xs text-muted-foreground">{KIND_LABELS[entry.model_kind]}</p></div>{editing && canEdit ? <Button type="button" variant="ghost" size="sm" aria-label={`Удалить применяемость ${index + 1}`} onClick={() => update({ applicability: draft.applicability.filter((_, current) => current !== index) })}>Убрать</Button> : null}</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label htmlFor={`${id}-node-${index}`} className="space-y-1 text-sm"><span>Узел *</span><Input id={`${id}-node-${index}`} value={entry.node} required maxLength={200} onChange={(event) => updateApplicability(index, { node: event.target.value })} /></label>
              <label htmlFor={`${id}-status-${index}`} className="space-y-1 text-sm"><span>Проверка применяемости</span><select id={`${id}-status-${index}`} className={SELECT_CLASS} value={entry.status} onChange={(event) => updateApplicability(index, { status: event.target.value as MtmApplicability["status"] })}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label htmlFor={`${id}-source-${index}`} className="space-y-1 text-sm sm:col-span-2"><span>Источник{entry.status === "confirmed" ? " *" : ""}</span><Input id={`${id}-source-${index}`} value={entry.source || ""} required={entry.status === "confirmed"} maxLength={1000} onChange={(event) => updateApplicability(index, { source: event.target.value || null })} placeholder="Каталог производителя, документ, ссылка или акт проверки" /></label>
              <label htmlFor={`${id}-restriction-${index}`} className="space-y-1 text-sm sm:col-span-2"><span>Ограничения серии / комплектации</span><Textarea id={`${id}-restriction-${index}`} value={entry.restrictions || ""} maxLength={1000} onChange={(event) => updateApplicability(index, { restrictions: event.target.value || null })} /></label>
            </div>
            {entry.status !== "confirmed" ? <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300">{entry.status === "rejected" ? "Эту деталь не следует считать подходящей к выбранной модели." : "Не использовать эту связь как подтверждённую замену."}</p> : entry.restrictions ? <p className="mt-2 text-xs font-medium">Подтверждение действует только с указанными ограничениями.</p> : null}
          </div>)}
          {canEdit && editing ? <div className="flex flex-wrap items-center gap-2"><label className="sr-only" htmlFor={`${id}-kind`}>Вид техники</label><select id={`${id}-kind`} className={`${SELECT_CLASS} sm:w-auto`} value={modelKind} onChange={(event) => setModelKind(event.target.value as MtmModelKind)}>{Object.entries(KIND_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><Button type="button" variant="outline" onClick={() => setPickModel(true)}>Добавить модель</Button></div> : null}
        </div>
      </fieldset>
      {error ? <p role="alert" className="mt-3 whitespace-pre-wrap text-sm text-destructive">{error} Введённые данные сохранены в форме.</p> : null}
      {editing && canEdit ? <div className="mt-4 flex flex-wrap gap-2 border-t pt-3"><Button type="submit" disabled={busy}>{busy ? "Сохранение…" : "Сохранить карточку"}</Button><p className="self-center text-xs text-muted-foreground">Сохраняются только реквизиты и применяемость.</p></div> : <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">{item.updated_at ? `Последнее изменение: ${new Date(item.updated_at).toLocaleString("ru-RU")}` : "Новая карточка"}{!canEdit ? " · Только просмотр" : ""}</p>}
    </form>
    {pickModel && !disabled ? <MtmOptionPicker key={modelKind} companyId={item.company_id} kind={modelKind} onClose={() => setPickModel(false)} onPick={(option) => {
      const model = option as MtmModelOption;
      setModelNames((names) => ({ ...names, [`${model.model_kind}:${model.id}`]: model.name }));
      update({ applicability: [...draft.applicability, { model_kind: model.model_kind, model_id: model.id, node: "", status: "pending", source: null, restrictions: null }] });
      setPickModel(false);
    }} /> : null}
  </section>;
}
