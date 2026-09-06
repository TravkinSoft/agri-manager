"use client";
import { useState } from "react";
import { TrafficFleetControls } from "@/components/traffic/traffic-fleet-controls";
import { FleetEntityCreator } from "@/components/traffic/fleet-entity-creator";
import type { TrafficVehicle } from "@/lib/traffic/model";
import { History, Truck, Settings2, KeyRound, Loader2, Plus } from "lucide-react";
import { TrafficBoard } from "@/components/traffic/traffic-board";
import { useTraffic } from "@/components/traffic/use-traffic";
import { ROLE_LABEL, STATE_LABEL, operatorRole } from "@/lib/traffic/model";
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
export default function TrafficPage() {
  const live = useTraffic(true);
  return <TrafficManager key={live.scopeKey} live={live} />;
}
function TrafficManager({ live }: { live: ReturnType<typeof useTraffic> }) {
  const [selected, setSelected] = useState<TrafficVehicle | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [panel, setPanel] = useState<"access" | "history" | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const managed = live.managerData;
  const companyId = live.data?.companyId;
  function open(next: "fleet" | "access" | "history") {
    if (!managed) return;
    if (next === "fleet") { setDrawerOpen(true); return; }
    setPanel(next);
    if (next === "history") {
      setHistoryLoading(true);
      void live.refresh(true).finally(() => setHistoryLoading(false));
    }
  }
  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl touch-pan-y pt-1 lg:px-6 lg:pb-28 lg:pt-5">
      <h1 className="sr-only lg:hidden">Оборот машин</h1>
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
        <div className="mt-5 flex flex-wrap gap-2">
          {managed?.canCreateFleetEntities ? <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex min-h-[48px] items-center gap-2 rounded-xl bg-amber-300 px-4 text-sm font-semibold text-slate-950"
          >
            <Plus size={17} /> Добавить
          </button> : null}
          <button
            type="button"
            disabled={!managed}
            onClick={() => open("fleet")}
            className="flex min-h-[48px] items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-slate-200 disabled:opacity-40"
          >
            <Settings2 size={17} /> Не на линии
          </button>
          <button
            type="button"
            disabled={!managed}
            onClick={() => open("access")}
            className="flex min-h-[48px] items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-slate-200 disabled:opacity-40"
          >
            <KeyRound size={17} /> Доступ сотрудников
          </button>
        </div>
      </header>
      {live.loading || (!live.data && !live.error) ? (
        <div
          role="status"
          className="flex items-center justify-center gap-2 py-16 text-slate-400"
        >
          <Loader2 className="animate-spin" /> Получаем статусы…
        </div>
      ) : live.data ? (
        <TrafficBoard
          key={live.scopeKey}
          snapshot={live.data}
          stale={live.stale}
          error={live.error}
          refresh={live.refresh}
          onManageVehicle={setSelected}
          mobileActions={<div className="flex items-center">
            {managed?.canCreateFleetEntities ? <button
              type="button"
              aria-label="Добавить машину или водителя"
              onClick={() => setCreateOpen(true)}
              className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg text-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
            >
              <Plus aria-hidden size={22} />
            </button> : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Настройки оборота машин"
                  disabled={!managed}
                  className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 disabled:opacity-40"
                >
                  <Settings2 aria-hidden size={20} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-w-[calc(100vw-2rem)]">
                <DropdownMenuItem onSelect={() => open("fleet")} className="min-h-[48px] gap-2">
                  <Truck aria-hidden size={17} /> Не на линии
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => open("access")} className="min-h-[48px] gap-2">
                  <KeyRound aria-hidden size={17} /> Доступ сотрудников
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => open("history")} className="min-h-[48px] gap-2">
                  <History aria-hidden size={17} /> Последние 50 изменений
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>}
        />
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
      {managed && live.data ? <TrafficFleetControls
        managed={managed} snapshot={live.data} selected={selected} onSelected={setSelected}
        drawerOpen={drawerOpen} onDrawerOpen={setDrawerOpen} stale={live.stale} refresh={live.refresh}
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
          className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl p-4 sm:p-6"
        >
          <DialogHeader>
            <DialogTitle>
              {panel === "access"
                  ? "Доступ сотрудников"
                  : "Последние 50 изменений"}
            </DialogTitle>
            <DialogDescription>
              {panel === "access"
                  ? "Персональные кабинеты. Доступ не открывает остальные разделы TravkinFlow."
                  : "Последние переходы машин между статусами."}
            </DialogDescription>
          </DialogHeader>
          {panel === "access" && managed ? (
            <div className="space-y-4">
              <p className="text-sm leading-relaxed text-slate-300">
                Сотрудники входят по обычной почте и паролю TravkinFlow.
                Администратор приглашает человека в компанию через раздел
                «Пользователи» и связывает его с записью сотрудника.
              </p>
              <div className="rounded-xl bg-white/5 p-3 text-sm text-slate-400">
                <p>Механизатор → кабинет «Комбайнёр».</p>
                <p className="mt-2">
                  Бригадир овощной → кабинет «Приёмка картофеля».
                </p>
              </div>
              {managed.canManageUsers ? (
                <a
                  href="/users"
                  className="flex min-h-[48px] items-center justify-center rounded-xl bg-amber-300 px-4 text-sm font-semibold text-slate-950"
                >
                  Пригласить через «Пользователи»
                </a>
              ) : (
                <p className="text-sm text-amber-200">
                  Для приглашения или изменения роли обратитесь к администратору
                  компании.
                </p>
              )}
              <a
                href="/traffic-operator"
                target="_blank"
                rel="noreferrer"
                className="flex min-h-[48px] items-center text-sm text-amber-200 underline"
              >
                Открыть вход в рабочий кабинет
              </a>
              <section className="border-t border-white/10 pt-3">
                <h3 className="text-sm text-slate-400">Аккаунты операторов</h3>
                {managed.accounts.length ? (
                  managed.accounts.map((account) => {
                    const people = managed.people.filter(
                      (person) => person.user_id === account.id,
                    );
                    const linked = people.length === 1;
                    const role = operatorRole(account.role);
                    return (
                      <div
                        key={account.id}
                        className="border-b border-white/5 py-3"
                      >
                        <p className="break-words font-medium">
                          {linked
                            ? people[0].full_name
                            : account.full_name || "Сотрудник"}
                        </p>
                        <p className="mt-1 text-sm text-slate-400">
                          {role ? ROLE_LABEL[role] : "Кабинет не назначен"}
                        </p>
                        <p className="mt-2 text-xs text-slate-400">
                          {account.status !== "active"
                            ? "Аккаунт ещё не активен"
                            : linked
                              ? "Аккаунт активен · сотрудник связан"
                              : "Нужна проверка связи с сотрудником"}
                        </p>
                      </div>
                    );
                  })
                ) : (
                  <p className="mt-3 text-sm text-slate-500">
                    Пока нет аккаунтов с рабочими ролями.
                  </p>
                )}
              </section>
            </div>
          ) : panel === "history" && managed ? (
            managed.snapshot.events.length ? (
              <div className="divide-y divide-white/5">
                {managed.snapshot.events.map((event) => (
                  <div key={event.id} className="break-words py-3 text-sm">
                    <p className="text-slate-200">
                      {event.vehicle_plate || event.vehicle_name} ·{" "}
                      {STATE_LABEL[event.from_state]} → {STATE_LABEL[event.to_state]}
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
