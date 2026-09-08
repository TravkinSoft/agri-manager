"use client";
import { useState } from "react";
import { TrafficFleetControls } from "@/components/traffic/traffic-fleet-controls";
import { FleetEntityCreator } from "@/components/traffic/fleet-entity-creator";
import type { TrafficVehicle } from "@/lib/traffic/model";
import { EllipsisVertical, History, Truck, Loader2, Plus } from "lucide-react";
import { TrafficBoard } from "@/components/traffic/traffic-board";
import { TrafficAnalyticsPanel } from "@/components/traffic/traffic-analytics-panel";
import { useTraffic } from "@/components/traffic/use-traffic";
import { trafficEventSummary } from "@/lib/traffic/model";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
const PTC_BOARD_V2 = process.env.NEXT_PUBLIC_PTC_BOARD_V2 === "1";
export default function TrafficPage() {
  const live = useTraffic(true);
  return <TrafficManager key={live.scopeKey} live={live} />;
}
function TrafficManager({ live }: { live: ReturnType<typeof useTraffic> }) {
  const [selected, setSelected] = useState<TrafficVehicle | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [panel, setPanel] = useState<"history" | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const managed = live.managerData;
  const companyId = live.data?.companyId;
  const canManageFleet = managed?.canManageFleet === true;
  function openHistory() {
    if (!managed) return;
    setPanel("history");
    setHistoryLoading(true);
    void live.refresh(true).finally(() => setHistoryLoading(false));
  }
  return (
    <div className={PTC_BOARD_V2
      ? "tf2-shell mx-auto w-full min-w-0 max-w-[1500px] touch-pan-y pt-1 lg:px-6 lg:pb-10 lg:pt-5"
      : "mx-auto w-full min-w-0 max-w-6xl touch-pan-y pt-1 lg:px-6 lg:pb-28 lg:pt-5"}>
      <h1 className="sr-only lg:hidden">Оборот машин</h1>
      {PTC_BOARD_V2 ? (
        <header className="mb-5 hidden items-end justify-between gap-4 border-b border-white/[0.07] pb-4 lg:flex">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-300/10 text-amber-300">
              <Truck aria-hidden size={24} />
            </span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300/80">Полевые операции</p>
              <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-slate-100">
                Оборот машин
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Живая линия · загрузка, весовая и приёмка
              </p>
            </div>
          </div>
          {canManageFleet && managed?.canCreateFleetEntities ? (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="tf2-control flex min-h-[48px] items-center gap-2 rounded-xl bg-amber-300 px-4 text-sm font-semibold text-slate-950 hover:bg-amber-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
            >
              <Plus aria-hidden size={17} /> Добавить
            </button>
          ) : null}
        </header>
      ) : (
        <header className="mb-6 hidden lg:block">
          <div className="flex items-center gap-3">
            <Truck className="shrink-0 text-amber-300" size={27} />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
                Оборот машин
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Картофель · загрузка и приёмка
              </p>
            </div>
          </div>
          {canManageFleet && managed?.canCreateFleetEntities ? <div className="mt-5 flex flex-wrap gap-2">
            {managed?.canCreateFleetEntities ? <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="flex min-h-[48px] items-center gap-2 rounded-xl bg-amber-300 px-4 text-sm font-semibold text-slate-950"
            >
              <Plus size={17} /> Добавить
            </button> : null}
          </div> : null}
        </header>
      )}
      {live.loading || (!live.data && !live.error) ? (
        <div
          role="status"
          className="flex items-center justify-center gap-2 py-16 text-slate-400"
        >
          <Loader2 className={PTC_BOARD_V2 ? "animate-spin motion-reduce:animate-none" : "animate-spin"} aria-hidden={PTC_BOARD_V2 || undefined} /> Получаем статусы…
        </div>
      ) : live.data ? (
        <div className={managed?.managerRole === "agronomist" && live.data.analytics
          ? "grid min-w-0 items-start gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]"
          : "min-w-0"}>
          <div className={managed?.managerRole === "agronomist" && live.data.analytics
            ? "min-w-0 lg:col-start-2 lg:row-start-1"
            : "min-w-0"}>
            <TrafficBoard
              key={live.scopeKey}
              snapshot={live.data}
              stale={live.stale}
              error={live.error}
              refresh={live.refresh}
              onAuxiliaryCommitted={live.auxiliaryCommitted}
              fleet={managed?.fleet}
              onManageVehicle={canManageFleet ? setSelected : undefined}
              compactAgronomistMobile={managed?.managerRole === "agronomist"}
              mobileActions={canManageFleet ? <div className="flex items-center">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Меню оборота машин"
                    disabled={!managed}
                    className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 disabled:opacity-40"
                  >
                    <EllipsisVertical aria-hidden size={22} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-w-[calc(100vw-2rem)]">
                  {managed?.canCreateFleetEntities ? <DropdownMenuItem onSelect={() => setCreateOpen(true)} className="min-h-[48px] gap-2">
                    <Plus aria-hidden size={17} /> Добавить машину или водителя
                  </DropdownMenuItem> : null}
                  <DropdownMenuItem onSelect={openHistory} className="min-h-[48px] gap-2">
                    <History aria-hidden size={17} /> Последние 50 изменений
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div> : managed?.snapshot.events.length ? <button
              type="button"
              aria-label="Последние 50 изменений"
              onClick={openHistory}
              className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
            >
              <History aria-hidden size={20} />
              </button> : null}
            />
          </div>
          {managed?.managerRole === "agronomist" && live.data.analytics ? (
            <div className="min-w-0 lg:col-start-1 lg:row-start-1">
              <TrafficAnalyticsPanel analytics={live.data.analytics} />
            </div>
          ) : null}
        </div>
      ) : (
        <div
          role="alert"
          className="rounded-xl bg-amber-500/10 p-4 text-amber-200"
        >
          {live.error}
          <button
            type="button"
            onClick={() => void live.refresh(true)}
            className="mt-3 block min-h-[48px] underline"
          >
            Повторить
          </button>
        </div>
      )}
      {canManageFleet && managed && live.data ? <TrafficFleetControls
        managed={managed} snapshot={live.data} selected={selected} onSelected={setSelected}
        stale={live.stale} refresh={live.refresh}
      /> : null}
      {managed?.canCreateFleetEntities && companyId ? <FleetEntityCreator
        open={createOpen}
        companyId={companyId}
        onOpenChange={setCreateOpen}
        onCreated={() => live.refresh(true)}
      /> : null}
      <Dialog
        open={!!panel}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setPanel(null);
          }
        }}
      >
        <DialogContent
          hideCloseButton
          className={`${PTC_BOARD_V2 ? "tf2-portal-panel tf2-panel " : ""}max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl p-4 sm:p-6`}
        >
          <DialogHeader>
            <DialogTitle>Последние 50 изменений</DialogTitle>
            <DialogDescription>Последние переходы машин между статусами.</DialogDescription>
          </DialogHeader>
          {panel === "history" && managed ? (
            managed.snapshot.events.length ? (
              <div className="divide-y divide-white/5">
                {managed.snapshot.events.map((event) => (
                  <div key={event.id} className="break-words py-3 text-sm">
                    <p className="text-slate-200">
                      {trafficEventSummary(event)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {event.actor_name} · {new Date(event.created_at).toLocaleString("ru-RU")}
                    </p>
                  </div>
                ))}
              </div>
            ) : historyLoading ? (
              <p className="py-6 text-sm text-slate-500">Обновляем историю…</p>
            ) : (
              <p className="py-6 text-sm text-slate-500">Изменений пока нет.</p>
            )
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="min-h-[48px]"
            onClick={() => {
              setPanel(null);
            }}
          >
            Закрыть
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
