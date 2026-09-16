"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Clock3, EllipsisVertical, Play, RefreshCw, Square, Wrench } from "lucide-react";
import type { TrafficSnapshot } from "@/lib/traffic/model";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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

function plotLabel(plot: HarvestPlot) {
  return [plot.fieldName, plot.cropName, plot.varietyName, plot.reproductionName]
    .filter(Boolean)
    .join(" · ");
}

export function TrafficShiftControls({ snapshot, stale, refresh, onCommitted }: {
  snapshot: TrafficSnapshot;
  stale: boolean;
  refresh: (fresh?: boolean) => Promise<void>;
  onCommitted: () => Promise<void>;
}) {
  const [closing, setClosing] = useState(false);
  const [plotDialog, setPlotDialog] = useState<PlotDialogMode>(null);
  const [plots, setPlots] = useState<HarvestPlot[]>([]);
  const [selectedPlotId, setSelectedPlotId] = useState("");
  const [loadingPlots, setLoadingPlots] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const shift = snapshot.combineShift;
  const open = shift?.status === "open";
  const combineStatus = snapshot.ownCombineStatus;
  const isBroken = combineStatus?.isBroken === true;
  const currentPlot = useMemo(
    () => plots.find((plot) => plot.cropStructureId === shift?.cropStructureId) || null,
    [plots, shift?.cropStructureId],
  );

  const loadPlots = useCallback(async () => {
    setLoadingPlots(true);
    try {
      const payload = await trafficRequest("/api/traffic/operator/plots", "GET");
      setPlots(Array.isArray(payload?.plots) ? payload.plots : []);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoadingPlots(false);
    }
  }, []);

  useEffect(() => { void loadPlots(); }, [loadPlots]);

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
    const candidate = plots.find((plot) => plot.status !== "completed" && plot.cropStructureId !== shift?.cropStructureId);
    setSelectedPlotId(candidate?.cropStructureId || "");
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

  function submitPlot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPlotId) return;
    if (plotDialog === "open") {
      void commit({ action: "open", cropStructureId: selectedPlotId });
      return;
    }
    if (!shift || shift.status !== "open") return;
    const form = new FormData(event.currentTarget);
    const hectaresFieldTotal = Number(form.get("hectaresFieldTotal"));
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
    const hectaresFieldTotal = Number(form.get("hectaresFieldTotal"));
    const fieldFinished = form.get("fieldFinished") === "on";
    const outside = shouldConfirmOutside(hectaresFieldTotal, fieldFinished);
    if (outside && !confirmOutside(hectaresFieldTotal, "завершить поле")) return;
    void commit({ action: "close", shiftId: shift.id, hectaresFieldTotal, fieldFinished,
      confirmOutsideTolerance: outside });
  }

  const selectablePlots = plots.filter((plot) => plot.status !== "completed" && plot.cropStructureId !== shift?.cropStructureId);

  return (
    <>
      <div data-testid="traffic-combine-shift" className="relative">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Меню комбайнёра" disabled={busy || stale || !snapshot.enabled}
              className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl text-foreground hover:bg-accent/40 disabled:opacity-40">
              <EllipsisVertical aria-hidden size={22} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel className="font-normal">
              <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Wrench aria-hidden size={15} className={isBroken ? "text-rose-800" : "text-emerald-800"} /> Статус комбайна
              </span>
              <span className={`mt-1 block text-xs ${isBroken ? "text-rose-800" : "text-emerald-800"}`}>{isBroken ? "Поломка" : "Работает"}</span>
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => void changeCombineStatus(!isBroken)}
              className={`min-h-[48px] gap-2 ${isBroken ? "text-emerald-800 focus:text-emerald-800" : "text-rose-800 focus:text-rose-800"}`}>
              {isBroken ? <Play aria-hidden size={16} /> : <Wrench aria-hidden size={16} />}
              {isBroken ? "Комбайн снова работает" : "Сообщить о поломке"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="font-normal">
              <span className="flex items-center gap-2 text-sm font-semibold text-foreground"><Clock3 aria-hidden size={15} className="text-amber-800" /> Смена комбайнёра</span>
              <span className={`mt-1 block text-xs ${open ? "text-emerald-800" : "text-muted-foreground"}`}>
                {open ? currentPlot ? `${plotLabel(currentPlot)} · с ${new Date(shift.openedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`
                  : `Открыта в ${new Date(shift.openedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })} · прежний режим`
                  : shift?.closedAt ? `Последняя: ${shift.hectaresShift ?? 0} га` : "Смена ещё не открыта"}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {open ? <>
              <DropdownMenuItem onSelect={() => beginPlotDialog("switch")} className="min-h-[48px] gap-2" disabled={!selectablePlots.length}>
                <RefreshCw aria-hidden size={16} /> Закончить или сменить поле
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setClosing(true)} className="min-h-[48px] gap-2"><Square aria-hidden size={16} /> Закрыть смену</DropdownMenuItem>
            </> : (
              <DropdownMenuItem onSelect={() => beginPlotDialog("open")} className="min-h-[48px] gap-2" disabled={loadingPlots || !selectablePlots.length}>
                <Play aria-hidden size={16} /> Открыть смену и выбрать поле
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {error ? <span role="alert" className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg bg-rose-50 p-2 text-xs text-rose-800">{error}</span> : null}
      </div>

      <Dialog open={plotDialog !== null} onOpenChange={(value) => { if (!value && !busy) setPlotDialog(null); }}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle>{plotDialog === "open" ? "Открыть смену" : "Перейти на другое поле"}</DialogTitle>
            <DialogDescription>Выберите фактический овощной участок. Отправленные машины получат его автоматически.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitPlot} className="space-y-4">
            {plotDialog === "switch" ? <>
              <label className="block text-sm text-foreground">Сделано на текущем поле всего, га
                <input name="hectaresFieldTotal" type="number" inputMode="decimal" min={currentPlot?.actualCompletedHa || 0} max="1000000" step="0.001" required
                  defaultValue={currentPlot?.actualCompletedHa ?? shift?.hectaresFieldTotal ?? 0}
                  className="mt-2 min-h-[48px] w-full rounded-xl border border-border bg-background px-3 text-base outline-none focus:border-amber-300" />
              </label>
              <label className="flex min-h-[48px] items-center gap-3 rounded-xl border border-border px-3 text-sm"><input name="fieldFinished" type="checkbox" className="h-5 w-5" /> Поле закончено</label>
            </> : null}
            <label className="block text-sm text-foreground">{plotDialog === "open" ? "С какого участка начинаем" : "Следующий участок"}
              <select value={selectedPlotId} onChange={(event) => setSelectedPlotId(event.target.value)} required
                className="mt-2 min-h-[52px] w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-amber-300">
                <option value="">Выберите участок</option>
                {selectablePlots.map((plot) => <option key={plot.cropStructureId} value={plot.cropStructureId}>{plotLabel(plot)} · {plot.actualCompletedHa}/{plot.plannedAreaHa} га</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={busy} onClick={() => setPlotDialog(null)} className="min-h-[48px] rounded-xl border border-border disabled:opacity-50">Отмена</button>
              <button type="submit" disabled={busy || !selectedPlotId} className="min-h-[48px] rounded-xl bg-primary font-semibold text-primary-foreground disabled:opacity-50">
                {busy ? "Сохраняем…" : plotDialog === "open" ? "Открыть смену" : "Перейти"}
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
              <input name="hectaresFieldTotal" type="number" inputMode="decimal" min={currentPlot?.actualCompletedHa || 0} max="1000000" step="0.001" required
                defaultValue={currentPlot?.actualCompletedHa ?? shift?.hectaresFieldTotal ?? 0}
                className="mt-2 min-h-[48px] w-full rounded-xl border border-border bg-background px-3 text-base outline-none focus:border-amber-300" />
            </label>
            <label className="flex min-h-[48px] items-center gap-3 rounded-xl border border-border px-3 text-sm"><input name="fieldFinished" type="checkbox" className="h-5 w-5" /> Поле закончено</label>
            {currentPlot ? <p className="text-xs text-muted-foreground">По структуре: {currentPlot.plannedAreaHa} га. Обычное отклонение: ±{Math.max(1, currentPlot.plannedAreaHa * 0.03).toFixed(1)} га.</p>
              : <p className="text-xs text-amber-800">Это смена, открытая до обновления. Она закроется без изменения машин и рейсов.</p>}
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
