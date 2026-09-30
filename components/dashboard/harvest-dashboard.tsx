"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { CombineWorkdayPanel } from "@/components/dashboard/combine-workday-panel";
import { DashboardTrafficPanel } from "@/components/dashboard/dashboard-traffic-panel";
import { SummarySectionTabs } from "@/components/dashboard/summary-section-tabs";
import { hasSummarySections, type SummarySection } from "@/lib/dashboard/summary-sections";
import { WeighbridgeShiftHistory } from "@/components/dashboard/weighbridge-shift-history";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/contexts/auth-context";
import { isPotatoLabel, type HarvestFilterOptions, type HarvestOverview } from "@/lib/dashboard/harvest-summary";
import { getHarvestBootstrap, getHarvestSummary } from "@/lib/services/harvest-dashboard";
import { LIVE_REFRESH_TABLES, useLiveRefresh } from "@/hooks/use-live-refresh";
import { compactReproductionLabel } from "@/lib/agronomy/reproduction-display";
import { OperationalDashboard } from "@/components/dashboard/operational-dashboard";

type BootstrapPayload = {
  summary: HarvestOverview;
  options: HarvestFilterOptions;
  operationalDayStartHour: number;
};
function mass(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const tonnes = value / 1000;
  return `${tonnes.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} т`;
}

export function HarvestDashboard() {
  const { profile } = useAuth();
  const scope = `${profile?.id}:${profile?.role}:${profile?.company_id}`;
  if (hasSummarySections(profile?.role) && profile?.company_id) {
    return <OperationalDashboard key={scope} scope={scope} companyId={profile.company_id} />;
  }
  return <HarvestDashboardContent key={`${profile?.id}:${profile?.role}:${profile?.company_id}`} />;
}

function HarvestDashboardContent() {
  const { profile } = useAuth();
  const companyId = profile?.company_id || null;
  const sectionsEnabled = hasSummarySections(profile?.role);
  const [section, setSection] = useState<SummarySection>("weighbridge");
  const [visited, setVisited] = useState<SummarySection[]>(["weighbridge"]);
  const selectSection = (next: SummarySection) => {
    setSection(next);
    setVisited(previous => previous.includes(next) ? previous : [...previous, next]);
  };
  const scope = `${profile?.id}:${profile?.role}:${companyId}`;
  const weighbridgeVisible = !sectionsEnabled || section === "weighbridge";
  const [summary, setSummary] = useState<HarvestOverview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [harvestedHectares, setHarvestedHectares] = useState("");
  const [selectedPlotId, setSelectedPlotId] = useState<string | null>(null);
  const summaryRef = useRef<HarvestOverview | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const queuedRefreshRef = useRef(false);
  const previousActivePlotRef = useRef<string | null>(null);

  const loadDashboard = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    // Coalesce an update during a slow read instead of repeatedly cancelling it.
    if (abortRef.current) { queuedRefreshRef.current = true; return; }
    do {
      queuedRefreshRef.current = false;
      const controller = new AbortController();
      abortRef.current = controller;
      const timeout = window.setTimeout(() => controller.abort(), 30_000);
      setLoading(!summaryRef.current);
      setError("");
      const query = { period: "current_day" as const, start: null, end: null, filters: {}, includeDriverStats: false };
      try {
        const next = summaryRef.current
          ? await getHarvestSummary<HarvestOverview>(query, { signal: controller.signal })
          : (await getHarvestBootstrap<BootstrapPayload>(query, { signal: controller.signal })).summary;
        if (controller.signal.aborted) return;
        summaryRef.current = next;
        setSummary(next);
      } catch (reason) {
        if (controller.signal.aborted) {
          if (abortRef.current === controller) {
            setLoading(false);
            setError("Сводка загружается дольше обычного. Повторим автоматически.");
          }
          return;
        }
        if ([401, 403].includes(Number((reason as { status?: number }).status))) {
          summaryRef.current = null;
          setSummary(null);
        }
        setError(reason instanceof Error ? reason.message : "Не удалось загрузить сводку");
      } finally {
        window.clearTimeout(timeout);
        if (abortRef.current === controller) abortRef.current = null;
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    } while (queuedRefreshRef.current);
  }, [companyId]);

  useEffect(() => {
    summaryRef.current = null;
    previousActivePlotRef.current = null;
    setSelectedPlotId(null);
    setSummary(null);
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      queuedRefreshRef.current = false;
    };
  }, [companyId, loadDashboard]);
  const refreshDashboardLive = useCallback(async () => {
    await loadDashboard();
  }, [loadDashboard]);
  useLiveRefresh({ enabled: Boolean(companyId) && weighbridgeVisible, companyId, tables: LIVE_REFRESH_TABLES.weighbridge, intervalMs: 15_000, onRefresh: refreshDashboardLive });
  useEffect(() => { setHarvestedHectares(""); }, [selectedPlotId]);
  useEffect(() => {
    if (weighbridgeVisible) void loadDashboard();
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      queuedRefreshRef.current = false;
    };
  }, [weighbridgeVisible, loadDashboard]);

  useEffect(() => {
    const plots = summary?.harvestPlots || [];
    const fields = summary?.harvestFields || [];
    const activePlotId = plots.find((plot) => plot.isCurrent)?.cropStructureAllocationId || null;
    const previousActivePlotId = previousActivePlotRef.current;
    setSelectedPlotId((current) => {
      if (!plots.length) return null;
      const stillAvailable = current && (
        plots.some((plot) => plot.cropStructureAllocationId === current)
        || fields.some((field) => `field:${field.key}` === current)
      );
      if (!stillAvailable || !current || (previousActivePlotId && current === previousActivePlotId && activePlotId !== previousActivePlotId)) {
        return activePlotId || plots[0].cropStructureAllocationId;
      }
      return current;
    });
    previousActivePlotRef.current = activePlotId;
  }, [summary?.harvestFields, summary?.harvestPlots]);

  const potatoParties = useMemo(() => (summary?.parties || []).filter((party) => isPotatoLabel(party.cropName)), [summary]);
  const periodMovement = summary?.potatoPeriodMovement;
  const selectedField = selectedPlotId?.startsWith("field:")
    ? summary?.harvestFields?.find((field) => `field:${field.key}` === selectedPlotId) || null
    : null;
  const selectedPlot = selectedField
    ? null
    : summary?.harvestPlots.find((plot) => plot.cropStructureAllocationId === selectedPlotId)
      || summary?.harvestPlots.find((plot) => plot.isCurrent)
      || summary?.harvestPlots[0]
      || null;
  const selectedScopeTotalAcceptedKg = selectedField?.totalAcceptedKg
    ?? selectedPlot?.totalAcceptedKg
    ?? summary?.currentPlotTotalAcceptedKg
    ?? 0;
  const stockKg = potatoParties.reduce((total, party) => total + party.currentStockKg, 0);
  const liveSelection = summary?.activeWeighbridgeSelection || null;
  const activeSelection = selectedField
    ? {
        ticketId: "",
        occurredAt: selectedField.lastChangedAt,
        fieldId: selectedField.fieldId,
        fieldName: selectedField.fieldName,
        cropStructureAllocationId: "",
        harvestLotId: null,
        seasonId: selectedField.seasonId,
        cropId: selectedField.cropId,
        cropName: selectedField.cropName,
        varietyId: null,
        varietyName: null,
        reproductionId: null,
        reproductionName: null,
        areaHa: selectedField.fieldAreaHa ?? selectedField.plannedAreaHa,
      }
    : selectedPlot
    ? {
        ticketId: "",
        occurredAt: selectedPlot.lastChangedAt,
        fieldId: selectedPlot.fieldId,
        fieldName: selectedPlot.fieldName,
        cropStructureAllocationId: selectedPlot.cropStructureAllocationId,
        harvestLotId: null,
        seasonId: selectedPlot.seasonId,
        cropId: selectedPlot.cropId,
        cropName: selectedPlot.cropName,
        varietyId: selectedPlot.varietyId,
        varietyName: selectedPlot.varietyName,
        reproductionId: selectedPlot.reproductionId,
        reproductionName: selectedPlot.reproductionName,
        areaHa: selectedPlot.areaHa,
      }
    : liveSelection;
  const activeCrop = activeSelection?.cropName || "Уборка";
  const activeField = activeSelection?.fieldName || "Поле не выбрано";
  const activeFieldLabel = activeField.replace(/^поле\s*/iu, "") || activeField;
  const fieldHectares = activeSelection?.areaHa ?? null;
  const reproduction = compactReproductionLabel(activeSelection?.reproductionName);
  const reproductionDetail = reproduction === "—" ? null : /^\d+$/u.test(reproduction) ? `${reproduction} р.` : reproduction;
  const currentPlotIdentity = selectedField
    ? [
        /^поле\b/iu.test(selectedField.fieldName) ? selectedField.fieldName : `Поле ${selectedField.fieldName}`,
        "всё поле",
        `${selectedField.allocationCount} ${selectedField.allocationCount === 1 ? "участок" : "участка"}`,
      ].join(" · ")
    : activeSelection
    ? [
        /^поле\b/iu.test(activeField) ? activeField : `Поле ${activeField}`,
        activeSelection.varietyName,
        reproductionDetail,
        fieldHectares === null ? null : `участок ${fieldHectares.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} га`,
      ].filter(Boolean).join(" · ")
    : "Точный участок не выбран";
  const weighbridgeOnline = Boolean(summary?.weighbridgeShifts?.some((shift) => shift.status === "open"));
  const combineOnline = Boolean(summary?.harvestPlots.some(plot => plot.combineShiftOpen));
  const enteredHectares = Number(harvestedHectares.replace(",", "."));
  const hectares = harvestedHectares.trim()
    ? (Number.isFinite(enteredHectares) && enteredHectares > 0 ? enteredHectares : null)
    : selectedField?.areaPending
      ? null
      : selectedField?.harvestedAreaHa ?? (selectedPlot?.areaPending ? null : selectedPlot?.harvestedAreaHa);
  const liveAreaIssue = selectedField?.areaIssue || selectedPlot?.areaIssue || null;
  const manualYieldTonnes = !liveAreaIssue && !selectedField?.areaPending && hectares && hectares > 0 ? selectedScopeTotalAcceptedKg / 1000 / hectares : null;
  const liveYieldPending = Boolean(selectedField?.areaPending || selectedPlot?.areaPending);
  const liveYieldTonnes = liveYieldPending || liveAreaIssue
    ? null
    : selectedField?.yieldTPerHa ?? selectedPlot?.yieldTPerHa ?? (!selectedPlot && !selectedField ? summary?.currentPlotYieldTPerHa ?? null : null);
  const liveYieldNote = liveYieldPending
    ? "Комбайнёр должен закрыть смену и указать убранные гектары"
    : liveAreaIssue
      ? "Урожайность не рассчитана: требуется сверка гектаров"
    : selectedField?.harvestedAreaHa
      ? `По всему полю подтверждено: ${selectedField.harvestedAreaHa.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} га`
    : selectedField
      ? "Комбайнёр должен закрыть смену и указать убранные гектары"
    : selectedPlot?.harvestedAreaHa
    ? `Всего подтверждено: ${selectedPlot.harvestedAreaHa.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} га${selectedPlot.areaPending ? " · гектары текущей смены ещё не указаны" : ""}`
    : summary?.currentPlotHarvestedAreaStatus === "verified"
      ? `Убрано за рабочий день: ${summary.currentPlotHarvestedAreaHa?.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} га`
      : summary?.currentPlotHarvestedAreaStatus === "field_has_multiple_plots"
      ? "Гектары смены связаны с полем, а не с точным участком"
      : summary?.currentPlotHarvestedAreaStatus === "no_closed_shift"
        ? "Нет закрытого отчёта смены с фактическими гектарами"
        : "Точный участок не выбран";
  const periodImpurityPercent = periodMovement?.removedImpuritiesKg != null
    && periodMovement.receivedNetKg > 0
    ? periodMovement.removedImpuritiesKg / periodMovement.receivedNetKg * 100
    : null;
  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-3 overflow-x-hidden">
      {sectionsEnabled ? <SummarySectionTabs value={section} onChange={selectSection} /> : null}
      <div id="summary-panel-weighbridge" role={sectionsEnabled ? "tabpanel" : undefined} aria-labelledby={sectionsEnabled ? "summary-tab-weighbridge" : undefined} hidden={!weighbridgeVisible} className="space-y-3">
      {error ? <div className="border-l-2 border-rose-400 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {loading && !summary ? <div className="flex min-h-[144px] items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Загрузка...</div> : null}

      {summary ? (
        <>
          <section className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1 border-y border-border py-1.5 text-[11px]" aria-label="Текущая работа">
            <span className={`flex items-center gap-1.5 font-semibold ${weighbridgeOnline ? "text-emerald-700" : "text-muted-foreground"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${weighbridgeOnline ? "bg-emerald-500" : "bg-muted-foreground"}`} />
              Весовая · {weighbridgeOnline ? "Смена открыта" : summary.weighbridgeShifts?.length ? "Смена закрыта" : "Нет данных о сменах"}
            </span>
            <span className={`flex items-center gap-1.5 font-semibold ${combineOnline ? "text-emerald-700" : "text-muted-foreground"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${combineOnline ? "bg-emerald-500" : "bg-muted-foreground"}`} />
              Комбайнёр · {combineOnline ? "Смена открыта" : summary.harvestPlots.length ? "Смена закрыта" : "Нет данных о сменах"}
            </span>
            <span className="text-muted-foreground">Связь с устройствами не определяется</span>
            <span className="text-muted-foreground">Культура <strong className="text-foreground">{activeCrop}</strong></span>
            <span className="text-muted-foreground">Поле <strong className="text-foreground">{activeFieldLabel}</strong></span>
            <span className="text-muted-foreground">{selectedField ? "Площадь поля" : "Участок"} <strong className="tabular-nums text-foreground">{fieldHectares == null ? "—" : `${fieldHectares.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} га`}</strong></span>
          </section>

          {summary.harvestPlots.length ? (
            <section className="border-b border-border py-1.5" aria-label="Поля сегодняшней уборки">
              <div role="tablist" aria-label="Активное и предыдущие поля" className="travkin-scrollbar flex gap-1.5 overflow-x-auto pb-0.5">
                {(summary.harvestFields || []).filter((field) => field.allocationCount > 1).map((field) => {
                  const selected = selectedField?.key === field.key;
                  const fieldArea = field.fieldAreaHa ?? field.plannedAreaHa;
                  return (
                    <button
                      key={`field-${field.key}`}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setSelectedPlotId(`field:${field.key}`)}
                      className={`min-w-[230px] shrink-0 rounded-lg border px-3 py-2 text-left transition-colors ${selected ? "border-[color:var(--manor-brass-soft)] bg-[color:var(--manor-paper-raised)]" : "border-border bg-transparent hover:bg-card"}`}
                      title={`Общая урожайность по всем участкам поля ${field.fieldName}`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-semibold text-foreground">{field.fieldName}</span>
                        <span className="shrink-0 text-[9px] uppercase tracking-[0.08em] text-[color:var(--manor-brass-soft)]">Всё поле</span>
                      </span>
                      <span className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                        <span>{field.allocationCount} участка · {fieldArea.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} га</span>
                        <span className="shrink-0 tabular-nums text-[color:var(--manor-brass-soft)]">{mass(field.totalAcceptedKg)}</span>
                      </span>
                      <span className="mt-1 block text-[10px] text-muted-foreground">{field.cropName} · убрано {field.harvestedAreaHa == null ? "—" : field.harvestedAreaHa.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} га{field.areaPending ? " · ждём закрытия смены" : ""}</span>
                    </button>
                  );
                })}
                {summary.harvestPlots.map((plot) => {
                  const selected = plot.cropStructureAllocationId === selectedPlot?.cropStructureAllocationId;
                  const completed = plot.status === "completed";
                  const identity = [plot.areaHa == null ? null : `${plot.areaHa.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} га`, plot.varietyName, compactReproductionLabel(plot.reproductionName)].filter((value) => value && value !== "—").join(" · ");
                  return (
                    <button
                      key={plot.cropStructureAllocationId}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setSelectedPlotId(plot.cropStructureAllocationId)}
                      className={`min-w-[210px] shrink-0 rounded-lg border px-3 py-2 text-left transition-colors ${selected ? "border-[color:var(--manor-brass-soft)] bg-[color:var(--manor-paper-raised)]" : "border-border bg-transparent hover:bg-card"}`}
                      title={`${plot.fieldName} · ${identity || plot.cropName}`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-semibold text-foreground">{plot.fieldName}</span>
                        {plot.isCurrent ? <span className="shrink-0 text-[9px] uppercase tracking-[0.08em] text-emerald-700">Текущее</span> : null}
                      </span>
                      <span className="mt-1 flex items-center justify-between gap-2 text-[10px]">
                        <span className={`flex shrink-0 items-center gap-1 font-medium ${completed ? "text-muted-foreground" : "text-emerald-700"}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${completed ? "bg-muted-foreground" : "bg-emerald-500"}`} />
                          {completed ? "Завершено" : plot.status === "paused" ? "Приостановлено" : "В работе"}
                        </span>
                        <span className="text-muted-foreground">{identity || plot.cropName}</span>
                        <span className="shrink-0 tabular-nums text-[color:var(--manor-brass-soft)]" title="Всего принято с участка">{mass(plot.totalAcceptedKg)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          {summary.weighbridgeShifts?.length ? <WeighbridgeShiftHistory shifts={summary.weighbridgeShifts} /> : null}

          {liveAreaIssue ? <p role="status" className="border-l-2 border-amber-400 px-3 py-2 text-xs text-amber-700">{liveAreaIssue}. Урожайность появится после сверки; веса талонов не изменены.</p> : null}

          <section className="grid grid-cols-2 border-b border-border sm:grid-cols-4" aria-label="Главные показатели уборки">
            <div className="min-w-0 py-2 pr-2 sm:py-1 sm:pr-3">
              <div className="text-[9px] uppercase leading-none tracking-[0.11em] text-muted-foreground sm:text-[10px]">Итог дня · картофель</div>
              <div className="mt-1 whitespace-nowrap text-base font-semibold leading-none tabular-nums text-[color:var(--manor-brass-soft)] sm:text-lg">{periodMovement?.netAfterRemovalsKg != null ? mass(periodMovement.netAfterRemovalsKg) : "Нет данных"}</div>
              <div className="mt-1 text-[10px] text-muted-foreground" title={summary.period.label}>Все поля · с {summary.period.operationalDayStartHour}:00 · приход − вывоз примесей</div>
              <div className="mt-1 text-[10px] text-muted-foreground">{periodMovement?.removedImpuritiesKg != null
                ? `Приход ${mass(periodMovement.receivedNetKg)} − примеси ${mass(periodMovement.removedImpuritiesKg)}${periodImpurityPercent == null ? "" : ` (${periodImpurityPercent.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}% от нетто)`}`
                : "Не удалось определить культуру или источник примесей"}</div>
              {periodMovement?.adjustmentKg ? <div className="mt-1 text-[10px] text-muted-foreground">В том числе корректировка земли: {mass(periodMovement.adjustmentKg)} · {periodMovement.adjustmentCount} учётный документ, не рейс</div> : null}
            </div>
            <div className="min-w-0 border-l border-border px-2 py-2 sm:px-3 sm:py-1">
              <div className="text-[9px] uppercase leading-none tracking-[0.08em] text-muted-foreground sm:text-[10px]">{selectedField ? "Со всего поля · всего" : "С выбранного участка · всего"}</div>
              <div className="mt-1 whitespace-nowrap text-base font-semibold leading-none tabular-nums text-foreground sm:text-lg">{activeSelection ? mass(selectedScopeTotalAcceptedKg) : "—"}</div>
              <div className="mt-1 truncate text-[10px] text-muted-foreground" title={currentPlotIdentity}>{activeSelection ? currentPlotIdentity : "Комбайнёр должен выбрать участок"}</div>
            </div>
            <div className="min-w-0 border-t border-border py-2 pr-2 sm:border-l sm:border-t-0 sm:px-3 sm:py-1">
              <div className="text-[9px] uppercase leading-none tracking-[0.11em] text-muted-foreground sm:text-[10px]">На складе</div>
              <div className="mt-1 whitespace-nowrap text-base font-semibold leading-none tabular-nums text-foreground sm:text-lg">{mass(stockKg)}</div>
              <div className="mt-1 truncate text-[10px] text-muted-foreground">Чистый остаток картофеля</div>
            </div>
            <button type="button" onClick={() => setCalculatorOpen((value) => !value)} className="min-h-9 min-w-0 border-l border-t border-border px-2 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:border-t-0 sm:px-3 sm:py-1">
              <div className="text-[9px] uppercase leading-none tracking-[0.08em] text-muted-foreground sm:text-[10px]">Живая урожайность</div>
              <div className={`mt-1 leading-none tabular-nums text-foreground ${liveYieldTonnes == null ? "text-xs font-medium sm:text-sm" : "whitespace-nowrap text-sm font-semibold sm:text-lg"}`}>{liveYieldTonnes == null ? "—" : `${liveYieldTonnes.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} т/га`}</div>
              <div className="mt-1 text-[10px] text-muted-foreground" title={liveYieldNote}>{liveYieldNote}</div>
              {selectedPlot?.latestShiftAreaHa != null ? <div className="mt-1 text-[10px] text-muted-foreground">Последняя смена на участке: {selectedPlot.latestShiftAreaHa.toLocaleString("ru-RU")} га</div> : null}
            </button>
          </section>

          {calculatorOpen ? (
            <section className="grid max-w-md grid-cols-[minmax(0,1fr)_minmax(112px,.8fr)] items-end gap-3 rounded-lg bg-card px-3 py-2.5 shadow-manor-sm" aria-label="Калькулятор урожайности">
              <h3 className="col-span-2 text-xs font-semibold text-foreground">Калькулятор урожайности</h3>
              <label className="text-[11px] text-muted-foreground">Убрано, га
                <Input inputMode="decimal" value={harvestedHectares} onChange={(event) => setHarvestedHectares(event.target.value)} placeholder={(selectedField?.harvestedAreaHa ?? selectedPlot?.harvestedAreaHa) ? `Подтверждено: ${(selectedField?.harvestedAreaHa ?? selectedPlot?.harvestedAreaHa)?.toLocaleString("ru-RU")}` : "Например, 2,4"} className="mt-1 h-9" />
              </label>
               <div className="min-w-0"><div className="text-[11px] text-muted-foreground">Урожайность</div><div className="mt-1 truncate text-lg font-semibold tabular-nums text-[color:var(--manor-brass-soft)]">{manualYieldTonnes == null ? "—" : `${manualYieldTonnes.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} т/га`}</div></div>
            </section>
          ) : null}

        </>
      ) : null}

      </div>
      {sectionsEnabled && companyId ? <>
        <div id="summary-panel-combine" role="tabpanel" aria-labelledby="summary-tab-combine" hidden={section !== "combine"}>
          {visited.includes("combine") ? <CombineWorkdayPanel scope={scope} companyId={companyId} enabled={section === "combine"} /> : null}
        </div>
        <div id="summary-panel-traffic" role="tabpanel" aria-labelledby="summary-tab-traffic" hidden={section !== "traffic"}>
          {visited.includes("traffic") ? <DashboardTrafficPanel scope={scope} companyId={companyId} enabled={section === "traffic"} /> : null}
        </div>
      </> : null}

    </div>
  );
}
