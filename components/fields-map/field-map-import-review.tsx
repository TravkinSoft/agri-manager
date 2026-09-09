"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Eye, FileCheck2, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  FIELD_MAP_SKIP_DECISION,
  resolveFieldMapDecision,
  summarizeFieldMapReview,
  type FieldMapMatchDecisions,
} from "@/lib/fields-map/import-review";
import type {
  FieldMapFieldCard,
  FieldMapImportSummary,
  FieldMapPreviewDiagnostics,
  FieldMapPreviewMatch,
} from "@/lib/types/fields-map";

const PENDING_DECISION = "__pending__";

type ImportPreview = {
  fileName: string;
  stats: {
    total_polygons: number;
    matched_polygons: number;
    unmatched_polygons: number;
    error_count: number;
  };
  matches: FieldMapPreviewMatch[];
  debug: FieldMapPreviewDiagnostics | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  upload: { fileName: string; polygonCount: number; errors: string[] } | null;
  preview: ImportPreview | null;
  fields: FieldMapFieldCard[];
  decisions: FieldMapMatchDecisions;
  imports: FieldMapImportSummary[];
  busy: boolean;
  confirming: boolean;
  historyBusyId: string | null;
  onDecision: (polygonId: string, value: string) => void;
  onPreview: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onFocusPolygon: (row: FieldMapPreviewMatch) => void;
  onHistoryAction: (importId: string, action: "activate" | "deactivate") => void;
  onDownload: (importId: string) => void;
  onArchive: (importId: string) => void;
};

function formatHa(value: number | null | undefined): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return `${numeric.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} га`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

function reasonLabel(code: string): string {
  const labels: Record<string, string> = {
    geometry_conflict: "контур пересекается с другим",
    source_area_missing: "в источнике нет площади",
    field_area_missing: "у поля нет площади",
    area_mismatch: "площадь отличается",
    area_margin_too_small: "кандидаты слишком близки",
    fuzzy_suggestion_only: "только нечёткая подсказка",
    no_candidate: "кандидат не найден",
  };
  return labels[code] || code;
}

export function FieldMapImportReview({
  open,
  onOpenChange,
  upload,
  preview,
  fields,
  decisions,
  imports,
  busy,
  confirming,
  historyBusyId,
  onDecision,
  onPreview,
  onConfirm,
  onCancel,
  onFocusPolygon,
  onHistoryAction,
  onDownload,
  onArchive,
}: Props) {
  const [filter, setFilter] = useState<"attention" | "all">("attention");
  const rows = useMemo(() => preview?.matches || [], [preview?.matches]);
  const summary = useMemo(() => summarizeFieldMapReview(rows, decisions), [decisions, rows]);
  const visibleRows = useMemo(
    () =>
      filter === "all"
        ? rows
        : rows.filter((row) => {
            const resolved = resolveFieldMapDecision(row, decisions);
            return row.match_status !== "matched" || resolved.skipped || !resolved.fieldId;
          }),
    [decisions, filter, rows]
  );
  const polygonsByField = useMemo(() => {
    const result = new Map<string, string[]>();
    rows.forEach((row) => {
      const fieldId = resolveFieldMapDecision(row, decisions).fieldId;
      if (!fieldId) return;
      result.set(fieldId, [...(result.get(fieldId) || []), row.polygon_id]);
    });
    return result;
  }, [decisions, rows]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="tf2-portal-panel flex w-full flex-col gap-0 border-white/10 bg-[#0B111B] p-0 text-slate-100 duration-150 sm:max-w-2xl xl:max-w-4xl"
      >
        <SheetHeader className="border-b border-white/10 px-4 py-4 pr-12 text-left sm:px-6">
          <SheetTitle className="text-slate-50">Импорт контуров полей</SheetTitle>
          <SheetDescription className="text-slate-400">
            Автоматически сохраняются только точные совпадения. Для каждого спорного контура выберите одно поле или явно пропустите его.
          </SheetDescription>
        </SheetHeader>

        <div className="travkin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <section aria-labelledby="field-map-import-file" className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <h3 id="field-map-import-file" className="truncate text-sm font-semibold text-slate-100">
                  {upload?.fileName || "KML ещё не выбран"}
                </h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  {upload ? `${upload.polygonCount} контуров прочитано локально` : "Выберите KML кнопкой на карте."}
                </p>
              </div>
              <Button size="sm" variant="outline" disabled={!upload || busy} onClick={onPreview}>
                <FileCheck2 className="mr-2 h-4 w-4" />
                {busy && !preview ? "Проверяем…" : "Проверить"}
              </Button>
            </div>
            {upload?.errors.length ? (
              <div className="mt-2 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
                {upload.errors.slice(0, 4).join("; ")}
              </div>
            ) : null}
          </section>

          {preview ? (
            <>
              <section aria-labelledby="field-map-review-summary" className="mt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 id="field-map-review-summary" className="text-sm font-semibold text-slate-100">Очередь сопоставления</h3>
                  <div className="flex gap-1" role="group" aria-label="Фильтр очереди">
                    <Button size="sm" variant={filter === "attention" ? "default" : "outline"} onClick={() => setFilter("attention")}>
                      Требуют решения
                    </Button>
                    <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>
                      Все {summary.total}
                    </Button>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-live="polite">
                  <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-2"><div className="text-xl font-bold text-emerald-200">{summary.linked}</div><div className="text-xs text-slate-400">связано</div></div>
                  <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-2"><div className="text-xl font-bold text-amber-200">{summary.pending}</div><div className="text-xs text-slate-400">ждут решения</div></div>
                  <div className="rounded-lg border border-white/10 bg-white/[0.025] p-2"><div className="text-xl font-bold text-slate-200">{summary.skipped}</div><div className="text-xs text-slate-400">пропущено явно</div></div>
                  <div className="rounded-lg border border-rose-400/20 bg-rose-400/10 p-2"><div className="text-xl font-bold text-rose-200">{summary.duplicateFieldIds.length}</div><div className="text-xs text-slate-400">дубликатов полей</div></div>
                </div>

                {summary.pending > 0 || summary.duplicateFieldIds.length > 0 || summary.linked === 0 ? (
                  <div role="alert" className="mt-3 flex gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {summary.pending > 0 ? `Решите ${summary.pending} спорных контуров. ` : ""}
                      {summary.duplicateFieldIds.length > 0 ? "Одно поле нельзя назначить двум контурам." : ""}
                      {summary.linked === 0 && summary.pending === 0 ? "Оставьте хотя бы один контур для импорта." : ""}
                    </span>
                  </div>
                ) : (
                  <div className="mt-3 flex gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    Очередь разобрана. Подтверждение сохранит {summary.linked} контуров одной транзакцией.
                  </div>
                )}
              </section>

              <div className="mt-4 space-y-2">
                {visibleRows.map((row) => {
                  const resolution = resolveFieldMapDecision(row, decisions);
                  const selectValue = Object.prototype.hasOwnProperty.call(decisions, row.polygon_id)
                    ? decisions[row.polygon_id] || FIELD_MAP_SKIP_DECISION
                    : row.match_status === "matched" && row.field_id
                      ? row.field_id
                      : PENDING_DECISION;
                  const duplicate = Boolean(resolution.fieldId && (polygonsByField.get(resolution.fieldId)?.length || 0) > 1);
                  const statusLabel = row.match_status === "matched" ? "Точное совпадение" : row.match_status === "ambiguous" ? "Нужно решить" : "Не найдено";
                  return (
                    <article
                      key={row.polygon_id}
                      className={`rounded-xl border p-3 ${duplicate ? "border-rose-400/50 bg-rose-400/[0.07]" : row.match_status === "matched" ? "border-emerald-400/20 bg-emerald-400/[0.04]" : "border-white/10 bg-white/[0.025]"}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="truncate font-semibold text-slate-100">{row.polygon_name}</h4>
                            <Badge variant="outline">{statusLabel}</Badge>
                            {duplicate ? <Badge className="bg-rose-500 text-white">Поле повторяется</Badge> : null}
                          </div>
                          <div className="mt-1 text-xs text-slate-400">
                            {formatHa(row.area_ha)} · уверенность {Math.round(Number(row.confidence_score || 0) * 100)}%
                          </div>
                          {row.reason_codes?.length ? (
                            <div className="mt-1 text-xs text-amber-200">{row.reason_codes.map(reasonLabel).join(" · ")}</div>
                          ) : null}
                          {row.candidates.length ? (
                            <div className="mt-2 text-xs text-slate-400">
                              Подсказки: {row.candidates.slice(0, 3).map((candidate) => `${candidate.field_display_name}${candidate.area_delta_pct == null ? "" : ` (Δ ${candidate.area_delta_pct.toFixed(1)}%)`}`).join(", ")}
                            </div>
                          ) : null}
                        </div>
                        <Button size="sm" variant="ghost" aria-label={`Показать контур ${row.polygon_name} на карте`} onClick={() => onFocusPolygon(row)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="mt-3">
                        <Label htmlFor={`field-map-match-${row.polygon_id}`} className="mb-1.5 block text-xs text-slate-300">
                          Поле TravkinFlow
                        </Label>
                        <Select value={selectValue} onValueChange={(value) => onDecision(row.polygon_id, value)}>
                          <SelectTrigger id={`field-map-match-${row.polygon_id}`} className={duplicate ? "border-rose-400" : "border-white/10 bg-[#080D16]"}>
                            <SelectValue placeholder="Выберите решение" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={PENDING_DECISION} disabled>Решение не принято</SelectItem>
                            <SelectItem value={FIELD_MAP_SKIP_DECISION}>Не импортировать этот контур</SelectItem>
                            {fields.map((field) => {
                              const assignedElsewhere = (polygonsByField.get(field.field_id) || []).some((polygonId) => polygonId !== row.polygon_id);
                              return (
                                <SelectItem key={`${row.polygon_id}-${field.field_id}`} value={field.field_id} disabled={assignedElsewhere}>
                                  Поле {field.field_display_name} · {formatHa(field.field_area_ha)}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      </div>
                    </article>
                  );
                })}
                {visibleRows.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-sm text-slate-400">
                    Все строки сопоставлены автоматически. Переключите «Все», чтобы проверить назначения.
                  </div>
                ) : null}
              </div>

              {preview.debug ? (
                <details className="mt-4 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-400">
                  <summary className="cursor-pointer font-medium text-slate-300">Техническая диагностика preview</summary>
                  <div className="mt-2 grid gap-1 font-mono">
                    <span>request: {preview.debug.request_id || "—"}</span>
                    <span>valid: {preview.debug.polygons_valid}/{preview.debug.polygons_received}</span>
                    <span>matched / ambiguous / unmatched: {preview.debug.matched_count} / {preview.debug.ambiguous_count} / {preview.debug.unmatched_count}</span>
                  </div>
                </details>
              ) : null}
            </>
          ) : null}

          {imports.length ? (
            <details className="mt-5 rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-200">История импортов · {imports.length}</summary>
              <div className="mt-3 space-y-2">
                {imports.map((item) => (
                  <div key={item.id} className="rounded-lg border border-white/10 bg-[#080D16] p-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-slate-100">{item.source_file_name}</div>
                        <div className="mt-0.5 text-xs text-slate-400">{formatDate(item.imported_at || item.created_at)} · {item.matched_polygons}/{item.total_polygons}</div>
                      </div>
                      <Badge variant={item.is_active ? "default" : "outline"}>{item.is_active ? "Активен" : item.status}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {item.status === "imported" && !item.is_active ? <Button size="sm" variant="outline" disabled={historyBusyId === item.id} onClick={() => onHistoryAction(item.id, "activate")}>Активировать</Button> : null}
                      {item.is_active ? <Button size="sm" variant="outline" disabled={historyBusyId === item.id} onClick={() => onHistoryAction(item.id, "deactivate")}>Деактивировать</Button> : null}
                      <Button size="sm" variant="outline" disabled={historyBusyId === item.id} onClick={() => onDownload(item.id)}><Download className="mr-1 h-3.5 w-3.5" />KML</Button>
                      {item.status !== "archived" ? <Button size="sm" variant="ghost" disabled={historyBusyId === item.id} onClick={() => onArchive(item.id)}><Trash2 className="mr-1 h-3.5 w-3.5" />Архив</Button> : null}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </div>

        <div className="border-t border-white/10 bg-[#0B111B] px-4 py-3 sm:px-6">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button variant="ghost" disabled={confirming} onClick={onCancel}><RotateCcw className="mr-2 h-4 w-4" />Сбросить текущий импорт</Button>
            <Button disabled={!preview || busy || !summary.canConfirm} onClick={onConfirm}>
              {confirming ? "Сохраняем…" : `Подтвердить ${summary.linked || ""}`.trim()}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
