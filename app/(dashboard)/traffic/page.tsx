"use client";
import { useRef, useState, type FormEvent } from "react";
import { Truck, Settings2, KeyRound, Loader2 } from "lucide-react";
import { TrafficBoard } from "@/components/traffic/traffic-board";
import { trafficRequest, useTraffic } from "@/components/traffic/use-traffic";
import { ROLE_LABEL, operatorRole } from "@/lib/traffic/model";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
export default function TrafficPage() {
  const live = useTraffic(true);
  const [panel, setPanel] = useState<"fleet" | "access" | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const managed = live.managerData;
  function open(next: "fleet" | "access") {
    if (!managed) return;
    setError("");
    setSelection(managed.snapshot.vehicles.map((v) => v.vehicle_id));
    setPanel(next);
  }
  async function send(body: unknown) {
    if (lock.current) return;
    if (live.stale) {
      setError(
        "Сначала обновите данные — сейчас нет подтверждённой связи с сервером",
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await trafficRequest("/api/traffic", "POST", body, true);
      if (panel === "fleet") setPanel(null);
      await live.refresh(true);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  async function configure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await send({
      action: "configure",
      enabled: true,
      // Preserve legacy context, without offering or changing field assignments.
      fieldId: managed?.snapshot.fieldId ?? null,
      vehicleIds: selection,
    });
  }
  const available = new Map(
    (managed?.fleet ?? []).map((v) => [
      v.id,
      { id: v.id, name: v.name, plate: v.license_plate || v.plate_number },
    ]),
  );
  // Keep assigned-but-archived vehicles in settings, so no hidden selection is dropped.
  managed?.snapshot.vehicles.forEach((v) => {
    if (!available.has(v.vehicle_id))
      available.set(v.vehicle_id, {
        id: v.vehicle_id,
        name: v.name,
        plate: v.plate,
      });
  });
  const hasBusy =
    managed?.snapshot.vehicles.some((v) => v.state !== "empty") ?? false;
  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl px-4 pb-28 pt-5 sm:px-6">
      <header className="mb-6">
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
          <button
            type="button"
            disabled={!managed}
            onClick={() => open("fleet")}
            className="flex min-h-[48px] items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-slate-200 disabled:opacity-40"
          >
            <Settings2 size={17} /> Выбрать машины
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
      {live.loading ? (
        <div
          role="status"
          className="flex items-center justify-center gap-2 py-16 text-slate-400"
        >
          <Loader2 className="animate-spin" /> Получаем статусы…
        </div>
      ) : live.data ? (
        <TrafficBoard
          snapshot={live.data}
          stale={live.stale}
          error={live.error}
          refresh={live.refresh}
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
      <Dialog
        open={!!panel}
        onOpenChange={(isOpen) => {
          if (!isOpen && !busy) {
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
              {panel === "fleet" ? "Машины в работе" : "Доступ сотрудников"}
            </DialogTitle>
            <DialogDescription>
              {panel === "fleet"
                ? "Выберите машины. После сохранения они доступны комбайнёру. Новые машины начинают со статуса «Пустая»."
                : "Персональные кабинеты. Доступ не открывает остальные разделы TravkinFlow."}
            </DialogDescription>
          </DialogHeader>
          {panel === "fleet" && managed ? (
            <form
              onSubmit={(event) => void configure(event)}
              className="space-y-4"
            >
              {hasBusy ? (
                <p className="text-xs leading-relaxed text-amber-200/80">
                  Загруженную машину или машину на выгрузке можно убрать из
                  списка только после разгрузки.
                </p>
              ) : null}
              <fieldset>
                <legend className="mb-2 text-sm text-slate-300">
                  Машины · выбрано {selection.length}
                </legend>
                <div className="max-h-[36dvh] space-y-1 overflow-y-auto rounded-xl border border-white/10 p-1">
                  {Array.from(available.values()).map((vehicle) => {
                    const state = managed.snapshot.vehicles.find(
                      (v) => v.vehicle_id === vehicle.id,
                    );
                    const disabled = !!state && state.state !== "empty";
                    return (
                      <label
                        key={vehicle.id}
                        className={`flex min-h-[64px] cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ${selection.includes(vehicle.id) ? "bg-amber-300/5" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={selection.includes(vehicle.id)}
                          disabled={disabled}
                          onChange={(event) =>
                            setSelection((old) =>
                              event.target.checked
                                ? [...old, vehicle.id]
                                : old.filter((id) => id !== vehicle.id),
                            )
                          }
                          className="h-5 w-5 shrink-0 accent-amber-300"
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-slate-300">
                            {vehicle.name}
                          </span>
                          <span className="block break-words text-lg font-semibold text-white">
                            {vehicle.plate || "Номер не указан"}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                  {!available.size ? (
                    <p className="p-4 text-sm text-slate-500">
                      Нет действующих машин. Добавьте их в штатный справочник
                      автопарка.
                    </p>
                  ) : null}
                </div>
              </fieldset>
              {selection.some(
                (id) =>
                  !managed.snapshot.vehicles.some((v) => v.vehicle_id === id),
              ) ? (
                <label className="flex min-h-[48px] items-start gap-3 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    required
                    className="mt-1 h-5 w-5 shrink-0 accent-amber-300"
                  />
                  <span>
                    Добавляемые машины сейчас пустые.
                  </span>
                </label>
              ) : null}
              <Button
                type="submit"
                disabled={busy || live.stale}
                className="min-h-[48px] w-full"
              >
                {busy ? "Сохраняем…" : "Сохранить машины"}
              </Button>
            </form>
          ) : panel === "access" && managed ? (
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
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-rose-300">
              {error}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="min-h-[48px]"
            disabled={busy}
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
