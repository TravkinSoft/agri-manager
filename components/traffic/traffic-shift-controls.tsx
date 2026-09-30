"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, ChevronRight, MapPin, Play, RefreshCw, Square, Wrench } from "lucide-react";
import { stateAge, type TrafficSnapshot } from "@/lib/traffic/model";
import { parseHectaresInput } from "@/lib/traffic/hectares-input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trafficRequest } from "./use-traffic";

type HarvestPlot = {
  cropStructureId: string;
  fieldId: string;
  fieldName: string;
  cropName: string;
  varietyName: string;
  reproductionName: string;
  plannedAreaHa: number;
  actualCompletedHa: number;
  remainingAreaHa: number;
  status: string;
};

type PlotDialogMode = "open" | "switch" | null;

export function TrafficShiftControls({ snapshot, stale, refresh, onCommitted }: {
  snapshot: TrafficSnapshot;
  stale: boolean;
  refresh: (fresh?: boolean) => Promise<void>;
  onCommitted: () => Promise<void>;
}) {
  const [closing, setClosing] = useState(false);
  const [managingShift, setManagingShift] = useState(false);
  const [plotDialog, setPlotDialog] = useState<PlotDialogMode>(null);
  const [plots, setPlots] = useState<HarvestPlot[]>([]);
  const [suggestedPlotId, setSuggestedPlotId] = useState("");
  const [selectedPlotId, setSelectedPlotId] = useState("");
  const [loadingPlots, setLoadingPlots] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now);
  const serverOffset = useMemo(() => Date.parse(snapshot.serverTime) - Date.now(), [snapshot.serverTime]);
  const shift = snapshot.combineShift;
  const open = shift?.status === "open";
  const needsPlot = open && !shift?.cropStructureId;
  const combineStatus = snapshot.ownCombineStatus;
  const isBroken = combineStatus?.isBroken === true;
  const currentPlot = useMemo(
    () => plots.find((plot) => plot.cropStructureId === shift?.cropStructureId) || null,
    [plots, shift?.cropStructureId],
  );
  const selectedPlot = useMemo(
    () => plots.find((plot) => plot.cropStructureId === selectedPlotId) || null,
    [plots, selectedPlotId],
  );
  const continuationPlot = useMemo(
    () => plots.find((plot) => plot.cropStructureId === suggestedPlotId && plot.status !== "completed") || null,
    [plots, suggestedPlotId],
  );
  const currentFieldName = currentPlot?.fieldName || snapshot.fieldName;

  const loadPlots = useCallback(async () => {
    setLoadingPlots(true);
    try {
      const payload = await trafficRequest("/api/traffic/operator/plots", "GET");
      setPlots(Array.isArray(payload?.plots) ? payload.plots : []);
      setSuggestedPlotId(typeof payload?.suggestedCropStructureId === "string" ? payload.suggestedCropStructureId : "");
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoadingPlots(false);
    }
  }, []);

  useEffect(() => { void loadPlots(); }, [loadPlots]);
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [open]);

  async function commit(body: Record<string, unknown>) {
    if (busy || stale || !snapshot.enabled) return;
    setBusy(true);
    setError("");
    try {
      const result = await trafficRequest("/api/traffic/operator/shift", "POST", {
        ...body,
        key: crypto.randomUUID(),
      });
      if (result?.ok !== true) throw new Error("Сервер не подтвердил смену");
      await Promise.all([onCommitted(), loadPlots()]);
      setClosing(false);
      setManagingShift(false);
      setPlotDialog(null);
    } catch (caught) {
      setError((caught as Error).message);
      void refresh(true);
    } finally {
      setBusy(false);
    }
  }

  async function changeCombineStatus(nextBroken: boolean) {
    if (busy || stale || !snapshot.enabled) return;
    const prompt = nextBroken
      ? "Сообщить о поломке комбайна?\n\nВесовая, приёмка, заведующий автопарком и агроном увидят этот статус. Смена и статусы машин не изменятся."
      : "Комбайн снова работает?\n\nСтатус поломки исчезнет у всех участников оборота.";
    if (window.confirm(prompt) !== true) return;
    setBusy(true);
    setError("");
    try {
      const result = await trafficRequest("/api/traffic/operator/combine-breakdown", "POST", {
        isBroken: nextBroken,
        version: combineStatus?.version ?? 0,
        key: crypto.randomUUID(),
      });
      if (result?.ok !== true || result.isBroken !== nextBroken) throw new Error("Сервер не подтвердил статус комбайна");
      await onCommitted();
    } catch (caught) {
      setError((caught as Error).message);
      void refresh(true);
    } finally {
      setBusy(false);
    }
  }

  function beginPlotDialog(mode: Exclude<PlotDialogMode, null>) {
    // Choosing a different plot must never silently choose the first row. A
    // server-confirmed unfinished plot is continued by the separate primary
    // action; this dialog is only for an intentional override.
    setSelectedPlotId("");
    setError("");
    setManagingShift(false);
    setPlotDialog(mode);
  }

  function shouldConfirmOutside(total: number, finished: boolean) {
    const planned = currentPlot?.plannedAreaHa || 0;
    if (!finished || planned <= 0) return false;
    return Math.abs(total - planned) > Math.max(1, planned * 0.03);
  }

  function confirmOutside(total: number, target: string) {
    return window.confirm(`Указано ${total} га при площади участка ${currentPlot?.plannedAreaHa || 0} га. Всё равно ${target}?`);
  }

  function readFieldHectares(form: FormData): number | null {
    const total = parseHectaresInput(form.get("hectaresFieldTotal"));
    if (total === null) {
      setError("Укажите гектары числом: например, 8,3 или 8.34. Допустимо до 3 знаков после запятой, от 0 до 1 000 000 га.");
      return null;
    }
    const alreadyCompleted = currentPlot?.actualCompletedHa ?? shift?.hectaresFieldTotal ?? 0;
    if (total < alreadyCompleted) {
      setError(`На этом поле уже учтено ${alreadyCompleted.toLocaleString("ru-RU")} га. Укажите общий итог по полю, включая предыдущие смены.`);
      return null;
    }
    setError("");
    return total;
  }

  function submitPlot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPlotId) return;
    if (plotDialog === "open") {
      void commit({ action: "open", cropStructureId: selectedPlotId });
      return;
    }
    if (!shift || shift.status !== "open") return;
    if (needsPlot) {
      void commit({ action: "switch", shiftId: shift.id, cropStructureId: selectedPlotId,
        hectaresFieldTotal: 0, fieldFinished: false });
      return;
    }
    const form = new FormData(event.currentTarget);
    const hectaresFieldTotal = readFieldHectares(form);
    if (hectaresFieldTotal === null) return;
    const fieldFinished = form.get("fieldFinished") === "on";
    const outside = shouldConfirmOutside(hectaresFieldTotal, fieldFinished);
    if (outside && !confirmOutside(hectaresFieldTotal, "завершить поле и перейти на другое")) return;
    void commit({ action: "switch", shiftId: shift.id, cropStructureId: selectedPlotId,
      hectaresFieldTotal, fieldFinished, confirmOutsideTolerance: outside });
  }

  function closeShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shift || shift.status !== "open") return;
    const form = new FormData(event.currentTarget);
    const hectaresFieldTotal = readFieldHectares(form);
    if (hectaresFieldTotal === null) return;
    const fieldFinished = form.get("fieldFinished") === "on";
    const outside = shouldConfirmOutside(hectaresFieldTotal, fieldFinished);
    if (outside && !confirmOutside(hectaresFieldTotal, "завершить поле")) return;
    void commit({ action: "close", shiftId: shift.id, hectaresFieldTotal, fieldFinished,
      confirmOutsideTolerance: outside });
  }

  const selectablePlots = plots.filter((plot) => plot.status !== "completed" && plot.cropStructureId !== shift?.cropStructureId);

  return (
    <>
      <div data-testid="traffic-combine-shift" className="relative flex items-center gap-2">
        <button
          type="button"
          aria-label="Управление сменой комбайнёра"
          disabled={busy || stale || !snapshot.enabled}
          onClick={() => setManagingShift(true)}
          className={`group flex min-h-[54px] min-w-[170px] max-w-[260px] items-center gap-3 rounded-2xl border px-3 text-left disabled:opacity-40 ${needsPlot || !open ? "border-amber-500/45 bg-amber-500/10" : "border-emerald-500/30 bg-emerald-500/10"}`}
        >
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${needsPlot || !open ? "bg-amber-500/15 text-amber-800" : "bg-emerald-500/15 text-emerald-800"}`}>
            {open && !needsPlot ? <MapPin aria-hidden size={19} /> : <Play aria-hidden size={19} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {open ? "Смена открыта" : "Смена закрыта"}
            </span>
            <span className="mt-0.5 block truncate text-sm font-semibold text-foreground">
              {needsPlot ? "Выберите участок" : open ? currentFieldName ? `Поле ${currentFieldName}` : "Участок выбран" : continuationPlot ? `Продолжить поле ${continuationPlot.fieldName}` : "Открыть смену"}
            </span>
            {open && currentPlot ? (
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                {[currentPlot.varietyName, currentPlot.reproductionName].filter(Boolean).join(" · ")}
              </span>
            ) : null}
          </span>
          <ChevronRight aria-hidden size={17} className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </button>

        <button
          type="button"
          aria-label={isBroken ? "Комбайн сломан. Изменить статус" : "Комбайн работает. Сообщить о поломке"}
          title={isBroken ? "Комбайн сломан" : "Комбайн работает"}
          disabled={busy || stale || !snapshot.enabled}
          onClick={() => void changeCombineStatus(!isBroken)}
          className={`flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-2xl border disabled:opacity-40 ${isBroken ? "border-rose-500/45 bg-rose-500/10 text-rose-800" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-800"}`}
        >
          <Wrench aria-hidden size={20} />
        </button>
        {error ? <span role="alert" className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg bg-rose-50 p-2 text-xs text-rose-800">{error}</span> : null}
      </div>

      <Dialog open={managingShift} onOpenChange={(value) => { if (!busy) setManagingShift(value); }}>
        <DialogContent className="w-[calc(100%-1.5rem)] max-w-xl rounded-2xl p-0">
          <DialogHeader className="border-b border-border px-5 pb-4 pt-5 text-left sm:px-6">
            <DialogTitle>Смена комбайнёра</DialogTitle>
            <DialogDescription>Здесь только участок и смена. Машины и уже созданные рейсы не изменяются.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-5 pb-5 sm:px-6 sm:pb-6">
            <section className={`rounded-2xl border p-4 ${open ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-muted/25"}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className={`text-xs font-semibold uppercase tracking-[0.14em] ${open ? "text-emerald-800" : "text-muted-foreground"}`}>
                    {open ? "Смена сейчас открыта" : "Смена сейчас закрыта"}
                  </p>
                  {open ? (
                    needsPlot ? <>
                      <p className="mt-2 text-lg font-semibold text-amber-800">Участок ещё не выбран</p>
                      <p className="mt-1 text-sm text-muted-foreground">Выберите фактический участок до отправки следующей машины.</p>
                    </> : <>
                      <p className="mt-2 text-xl font-semibold text-foreground">{currentFieldName ? `Поле ${currentFieldName}` : "Участок выбран"}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{currentPlot
                        ? [currentPlot.cropName, currentPlot.varietyName, currentPlot.reproductionName].filter(Boolean).join(" · ")
                        : "Подробности участка обновляются…"}</p>
                    </>
                  ) : (
                    continuationPlot ? <>
                      <p className="mt-2 text-lg font-semibold text-foreground">Продолжить поле {continuationPlot.fieldName}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{[continuationPlot.cropName, continuationPlot.varietyName, continuationPlot.reproductionName].filter(Boolean).join(" · ")} · сделано {continuationPlot.actualCompletedHa} из {continuationPlot.plannedAreaHa} га</p>
                    </> : <p className="mt-2 text-sm text-muted-foreground">Чтобы отправлять машины, откройте смену и выберите фактический участок.</p>
                  )}
                </div>
                {open ? (
                  <div className="shrink-0 text-right text-xs tabular-nums">
                    <span className="rounded-full bg-emerald-500/15 px-3 py-1 font-semibold text-emerald-800">с {new Date(shift.openedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</span>
                    <p className="mt-2 text-muted-foreground" data-testid="shift-elapsed">В работе {stateAge(shift.openedAt, now + serverOffset)}</p>
                  </div>
                ) : null}
              </div>

              {open && currentPlot ? (
                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border/70 pt-4 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Сделано по полю</p>
                    <p className="mt-1 font-semibold text-foreground">{currentPlot.actualCompletedHa.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} га</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Осталось</p>
                    <p className="mt-1 font-semibold text-foreground" data-testid="shift-remaining">{currentPlot.remainingAreaHa.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} га</p>
                  </div>
                  <p className="col-span-2 text-xs text-muted-foreground">Площадь по структуре: {currentPlot.plannedAreaHa.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} га</p>
                </div>
              ) : null}
            </section>

            {open ? (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => beginPlotDialog("switch")}
                  disabled={busy || loadingPlots || !selectablePlots.length}
                  className="flex min-h-[58px] w-full items-center gap-3 rounded-2xl border border-border px-4 text-left hover:bg-accent/35 disabled:opacity-45"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-800"><RefreshCw aria-hidden size={19} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-foreground">{needsPlot ? "Выбрать текущий участок" : "Закончить или сменить поле"}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{needsPlot ? "Указать, где фактически идёт уборка" : "Записать гектары и перейти на следующий участок"}</span>
                  </span>
                  <ChevronRight aria-hidden size={18} className="text-muted-foreground" />
                </button>
                <button
                  type="button"
                  onClick={() => { setError(""); setManagingShift(false); setClosing(true); }}
                  disabled={busy}
                  className="flex min-h-[58px] w-full items-center gap-3 rounded-2xl border border-border px-4 text-left hover:bg-accent/35 disabled:opacity-45"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Square aria-hidden size={18} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-foreground">Закрыть смену</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">Указать итог по текущему полю и завершить работу</span>
                  </span>
                  <ChevronRight aria-hidden size={18} className="text-muted-foreground" />
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {continuationPlot ? (
                  <button
                    type="button"
                    onClick={() => void commit({ action: "open", cropStructureId: continuationPlot.cropStructureId })}
                    disabled={busy || loadingPlots}
                    className="flex min-h-[58px] w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-45"
                  >
                    <Play aria-hidden size={18} /> {busy ? "Открываем…" : `Продолжить · поле ${continuationPlot.fieldName}`}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => beginPlotDialog("open")}
                    disabled={busy || loadingPlots || !selectablePlots.length}
                    className="flex min-h-[58px] w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-45"
                  >
                    <Play aria-hidden size={18} /> Открыть смену и выбрать участок
                  </button>
                )}
                {continuationPlot && selectablePlots.length > 1 ? (
                  <button type="button" onClick={() => beginPlotDialog("open")} disabled={busy || loadingPlots}
                    className="min-h-[48px] w-full rounded-xl border border-border px-4 text-sm font-medium text-foreground disabled:opacity-45">
                    Выбрать другое поле
                  </button>
                ) : null}
              </div>
            )}

            {loadingPlots ? <p role="status" className="text-center text-xs text-muted-foreground">Загружаем участки…</p> : null}
            {!loadingPlots && !selectablePlots.length ? <p role="alert" className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-800">Нет доступных участков. Обновите данные или обратитесь к администратору.</p> : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={plotDialog !== null} onOpenChange={(value) => { if (!value && !busy) setPlotDialog(null); }}>
        <DialogContent className="w-[calc(100%-1.5rem)] max-w-xl rounded-2xl p-0">
          <DialogHeader className="border-b border-border px-5 pb-4 pt-5 text-left sm:px-6">
            <DialogTitle>{plotDialog === "open" ? "Открыть смену" : needsPlot ? "Выбрать текущий участок" : "Перейти на другое поле"}</DialogTitle>
            <DialogDescription>{plotDialog === "open" && continuationPlot
              ? `Поле ${continuationPlot.fieldName} уже предложено для продолжения. Здесь можно выбрать другое фактическое поле.`
              : "Нажмите на тот участок, где комбайн работает фактически."}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitPlot} className="space-y-4 px-5 pb-5 sm:px-6 sm:pb-6">
            {plotDialog === "switch" && !needsPlot ? <>
              <section className="rounded-2xl border border-border bg-muted/20 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.13em] text-muted-foreground">Завершаем текущий участок</p>
                <p className="mt-1 text-base font-semibold text-foreground">{currentPlot ? `Поле ${currentPlot.fieldName} · ${currentPlot.varietyName}` : "Текущий участок"}</p>
              </section>
              <label className="block text-sm font-medium text-foreground">Сделано на текущем поле всего, га
                <input name="hectaresFieldTotal" type="text" inputMode="decimal" maxLength={18} required placeholder="Например, 8,3"
                  defaultValue={currentPlot?.actualCompletedHa ?? shift?.hectaresFieldTotal ?? 0}
                  className="mt-2 min-h-[48px] w-full rounded-xl border border-border bg-background px-3 text-base outline-none focus:border-amber-300" />
              </label>
              <p className="text-xs text-muted-foreground">Всего по этому полю, включая предыдущие смены. Можно вводить через запятую или точку.</p>
              <label className="flex min-h-[48px] items-center gap-3 rounded-xl border border-border px-3 text-sm"><input name="fieldFinished" type="checkbox" className="h-5 w-5" /> Поле закончено</label>
            </> : null}
            <fieldset>
              <legend className="text-sm font-semibold text-foreground">{plotDialog === "open" ? "С какого участка начинаем" : needsPlot ? "Где сейчас идёт уборка" : "Следующий участок"}</legend>
              <div className="mt-2 max-h-[min(42vh,360px)] space-y-2 overflow-y-auto pr-1">
                {selectablePlots.map((plot) => {
                  const selected = selectedPlotId === plot.cropStructureId;
                  return (
                    <button
                      key={plot.cropStructureId}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setSelectedPlotId(plot.cropStructureId)}
                      className={`flex min-h-[72px] w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors ${selected ? "border-primary bg-primary/10 ring-1 ring-primary/40" : "border-border hover:bg-accent/35"}`}
                    >
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                        {selected ? <Check aria-hidden size={19} /> : <MapPin aria-hidden size={19} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-base font-semibold text-foreground">Поле {plot.fieldName}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{[plot.cropName, plot.varietyName, plot.reproductionName].filter(Boolean).join(" · ")}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">Сделано {plot.actualCompletedHa} из {plot.plannedAreaHa} га</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
            {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p> : null}
            <div className="grid grid-cols-2 gap-2 border-t border-border pt-4">
              <button type="button" disabled={busy} onClick={() => setPlotDialog(null)} className="min-h-[48px] rounded-xl border border-border disabled:opacity-50">Отмена</button>
              <button type="submit" disabled={busy || !selectedPlotId} className="min-h-[48px] rounded-xl bg-primary font-semibold text-primary-foreground disabled:opacity-50">
                {busy ? "Сохраняем…" : selectedPlot ? plotDialog === "open" ? `Открыть · поле ${selectedPlot.fieldName}` : needsPlot ? `Выбрать · поле ${selectedPlot.fieldName}` : `Перейти · поле ${selectedPlot.fieldName}` : "Сначала выберите"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={closing} onOpenChange={(value) => { if (!busy) setClosing(value); }}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-md rounded-2xl">
          <DialogHeader><DialogTitle>Закрыть смену</DialogTitle><DialogDescription>Укажите только общий фактический итог по полю. За смену система посчитает сама.</DialogDescription></DialogHeader>
          <form onSubmit={closeShift} className="space-y-4">
            <label className="block text-sm text-foreground">Сделано на поле всего, га
              <input name="hectaresFieldTotal" type="text" inputMode="decimal" maxLength={18} required placeholder="Например, 8,3"
                defaultValue={currentPlot?.actualCompletedHa ?? shift?.hectaresFieldTotal ?? 0}
                className="mt-2 min-h-[48px] w-full rounded-xl border border-border bg-background px-3 text-base outline-none focus:border-amber-300" />
            </label>
            <p className="text-xs text-muted-foreground">Всего по этому полю, включая предыдущие смены. Можно вводить через запятую или точку.</p>
            <label className="flex min-h-[48px] items-center gap-3 rounded-xl border border-border px-3 text-sm"><input name="fieldFinished" type="checkbox" className="h-5 w-5" /> Поле закончено</label>
            {currentPlot ? <p className="text-xs text-muted-foreground">По структуре: {currentPlot.plannedAreaHa} га. Обычное отклонение: ±{Math.max(1, currentPlot.plannedAreaHa * 0.03).toFixed(1)} га.</p>
              : needsPlot ? <p className="text-xs text-amber-800">Это смена, открытая до обновления. Она закроется без изменения машин и рейсов.</p>
                : <p className="text-xs text-muted-foreground">Параметры участка обновляются. Машины и рейсы при закрытии смены не изменяются.</p>}
            {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p> : null}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={busy} onClick={() => setClosing(false)} className="min-h-[48px] rounded-xl border border-border disabled:opacity-50">Отмена</button>
              <button type="submit" disabled={busy} className="min-h-[48px] rounded-xl bg-primary font-semibold text-primary-foreground disabled:opacity-50">{busy ? "Сохраняем…" : "Закрыть смену"}</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
