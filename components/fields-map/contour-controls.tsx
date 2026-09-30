"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { contourRings } from "@/lib/fields-map/contour-editor";
import type { FieldMapContour, FieldMapFieldCard, GeoJsonAreaGeometry } from "@/lib/types/fields-map";

type Point = { id: string; lng: number; lat: number; source: "manual" | "follow" };
export function ContourControls(props: {
  contour: FieldMapContour | null; canWrite: boolean; busy: boolean;
  name: string; onName: (name: string) => void;
  targets: FieldMapFieldCard[]; target: string; onTarget: (id: string) => void;
  onStart: () => void; onRename: () => void; onLink: () => void; onDetach: () => void;
  onDelete: () => void; onRestore: () => void;
  edit: { geometry: GeoJsonAreaGeometry | null; part: number; ring: number; points: Point[] } | null;
  onRing: (value: string) => void; onPoints: (points: Point[]) => void;
  onSave: () => void; onCancel: () => void;
}) {
  const { contour, edit, busy } = props;
  const control = "h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground";
  if (edit) return <section aria-label="Редактор колец контура" className="space-y-3 rounded-xl border border-border bg-card p-3 text-foreground">
    <h3 className="font-semibold">Редактирование контура</h3>
    <p className="text-xs text-muted-foreground">Меняется выбранное кольцо. Другие части и отверстия сохраняются. Полная геометрия проверяется перед сохранением.</p>
    {edit.geometry ? <Label className="block">Часть и кольцо
      <select aria-label="Часть и кольцо контура" className={control} disabled={busy} value={`${edit.part}:${edit.ring}`} onChange={(event) => props.onRing(event.target.value)}>
        {contourRings(edit.geometry).map((item) => <option key={`${item.part}:${item.ring}`} value={`${item.part}:${item.ring}`}>{item.label}</option>)}
      </select>
    </Label> : null}
    <div className="text-xs text-muted-foreground">Вершин: {edit.points.length}. Клик на карте добавляет вершину; Esc отменяет черновик.</div>
    <details className="rounded-lg border border-border p-2">
      <summary className="cursor-pointer text-sm">Координаты вершин выбранного кольца</summary>
      <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
        {edit.points.map((point, index) => <div key={point.id} className="grid grid-cols-[24px_1fr_1fr_40px] items-center gap-1">
          <span className="text-xs">{index + 1}</span>
          {(["lng", "lat"] as const).map((axis) => <input key={axis} type="number" step="any" min={axis === "lng" ? -180 : -90} max={axis === "lng" ? 180 : 90}
            aria-label={`${axis === "lng" ? "Долгота" : "Широта"} вершины ${index + 1}`} className={`${control} px-1`} value={point[axis]} disabled={busy}
            onChange={(event) => { const value = Number(event.target.value); if (!Number.isFinite(value)) return;
              props.onPoints(edit.points.map((p, i) => i === index ? { ...p, [axis]: value } : p)); }} />)}
          <Button variant="ghost" aria-label={`Удалить вершину ${index + 1}`} disabled={busy} onClick={() => props.onPoints(edit.points.filter((_, i) => i !== index))}>×</Button>
        </div>)}
      </div>
    </details>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={busy || edit.points.length >= 999} onClick={() => {
        const last = edit.points[edit.points.length - 1] || { lng: 69, lat: 53 };
        props.onPoints([...edit.points, { id: `vertex-${Date.now()}`, lng: last.lng, lat: last.lat, source: "manual" }]);
      }}>Добавить вершину</Button>
      <Button variant="outline" disabled={busy || !edit.points.length} onClick={() => props.onPoints(edit.points.slice(0, -1))}>Отменить вершину</Button>
      <Button variant="outline" disabled={busy} onClick={props.onCancel}>Отмена</Button>
      <Button disabled={busy || !edit.geometry || edit.points.length < 3} onClick={props.onSave}>{busy ? "Сохранение…" : "Сохранить версию"}</Button>
    </div>
  </section>;
  return <section aria-label="Управление контуром" className="space-y-3 rounded-xl border border-border bg-card p-3 text-foreground">
    <div className="text-sm font-semibold">{contour?.deleted_at ? "Удалённый контур" : contour?.field_id ? "Контур связан с полем" : contour ? "Контур без связи с полем" : "Поле без контура"}</div>
    {contour ? <div className="space-y-1 text-xs text-muted-foreground">
      <div>Источник: {contour.source_file_name || "Ручной контур"}</div>
      <div>Исходное имя: {contour.source_polygon_name || "Не установлено"}</div>
      <div className="break-all">ID исходника: {contour.source_polygon_id || "Не установлен"}</div>
      <div>Версия: {contour.contour_version} · {contour.area_ha?.toLocaleString("ru-RU", { maximumFractionDigits: 2 }) || "—"} га</div>
    </div> : null}
    {!props.canWrite ? <p className="text-xs text-muted-foreground">Только просмотр.</p> : contour?.deleted_at ?
      <Button disabled={busy} onClick={props.onRestore}>Восстановить контур</Button> : <>
      {contour ? <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); props.onRename(); }}>
        <input aria-label="Название контура" maxLength={200} value={props.name} onChange={(event) => props.onName(event.target.value)} className={control} disabled={busy} />
        <Button variant="outline" type="submit" disabled={busy || !props.name.trim() || props.name.trim() === contour.display_name}>Подписать</Button>
      </form> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={props.onStart}>{contour ? "Редактировать границу" : "Нарисовать контур"}</Button>
        {contour?.field_id ? <Button variant="outline" disabled={busy} onClick={props.onDetach}>Отвязать от поля</Button> : null}
        {contour ? <Button variant="destructive" disabled={busy} onClick={props.onDelete}>Удалить с карты</Button> : null}
      </div>
      {contour && props.targets.length ? <div className="flex gap-2">
        <select aria-label="Поле для связи с контуром" className={control} disabled={busy} value={props.target} onChange={(event) => props.onTarget(event.target.value)}>
          <option value="none">Выберите поле без контура</option>
          {props.targets.map((field) => <option key={field.field_id} value={field.field_id}>Поле {field.field_display_name}</option>)}
        </select>
        <Button variant="outline" disabled={busy || props.target === "none"} onClick={props.onLink}>Связать</Button>
      </div> : null}
      {contour && !contour.field_id ? <p className="text-xs text-muted-foreground">У этого контура пока нет связи с учётом. Поле, посевы и партии не создавались.</p> : null}
    </>}
  </section>;
}
