"use client";
import { useRef, useState, type FormEvent } from "react";
import { Truck, Settings2, KeyRound, Loader2, Copy, Check } from "lucide-react";
import { TrafficBoard } from "@/components/traffic/traffic-board";
import { trafficRequest, useTraffic } from "@/components/traffic/use-traffic";
import { ROLE_LABEL } from "@/lib/traffic/model";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
const inputClass =
  "min-h-[48px] w-full rounded-xl border border-white/15 bg-[#141c28] px-3 text-base text-slate-100 focus:border-amber-300 focus:outline-none";
export default function TrafficPage() {
  const live = useTraffic(true);
  const [panel, setPanel] = useState<"fleet" | "access" | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [field, setField] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [credential, setCredential] = useState<{
    login: string;
    password: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const managed = live.managerData;
  function open(next: "fleet" | "access") {
    if (!managed) return;
    setError("");
    setCredential(null);
    setCopied(false);
    setRevokeId(null);
    setSelection(managed.snapshot.vehicles.map((v) => v.vehicle_id));
    setField(managed.snapshot.fieldId ?? "");
    setEnabled(managed.snapshot.enabled);
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
      const result = await trafficRequest("/api/traffic", "POST", body, true);
      if (result.credential) {
        setCredential(result.credential);
        setCopied(false);
      } else if (panel === "fleet") setPanel(null);
      setRevokeId(null);
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
      enabled,
      fieldId: field || null,
      vehicleIds: selection,
    });
  }
  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await send({
      action: "issue",
      personId: form.get("person"),
      role: form.get("role"),
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
              Картофель · поле и приёмка
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
            <Settings2 size={17} /> Поток и машины
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
            setCredential(null);
          }
        }}
      >
        <DialogContent
          hideCloseButton
          className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl p-4 sm:p-6"
        >
          <DialogHeader>
            <DialogTitle>
              {panel === "fleet" ? "Поток и машины" : "Доступ сотрудников"}
            </DialogTitle>
            <DialogDescription>
              {panel === "fleet"
                ? "Выберите машины для этого поля. Начальный статус новых машин — «Пустая»."
                : "Персональные кабинеты. Доступ не открывает остальные разделы TravkinFlow."}
            </DialogDescription>
          </DialogHeader>
          {panel === "fleet" && managed ? (
            <form
              onSubmit={(event) => void configure(event)}
              className="space-y-4"
            >
              <label className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl bg-white/5 p-3">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                  className="h-5 w-5 accent-amber-300"
                />
                <span>Оборот машин включён</span>
              </label>
              <label className="block text-sm text-slate-300">
                Поле
                <select
                  aria-label="Поле потока"
                  className={`${inputClass} mt-2`}
                  value={field}
                  onChange={(event) => setField(event.target.value)}
                  disabled={hasBusy}
                >
                  <option value="">Без привязки к полю</option>
                  {managed.fields.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                  {field && !managed.fields.some((f) => f.id === field) ? (
                    <option value={field}>
                      {managed.snapshot.fieldName || "Текущее поле"}
                    </option>
                  ) : null}
                </select>
              </label>
              {hasBusy ? (
                <p className="text-xs leading-relaxed text-amber-200/80">
                  Занятые машины нельзя убрать, а поле нельзя поменять до
                  завершения их оборота. Выключение потока сохраняет статусы.
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
                    Подтверждаю, что новые назначаемые машины сейчас пустые.
                  </span>
                </label>
              ) : null}
              <Button
                type="submit"
                disabled={busy || live.stale}
                className="min-h-[48px] w-full"
              >
                {busy ? "Сохраняем…" : "Сохранить поток"}
              </Button>
            </form>
          ) : panel === "access" && managed ? (
            <div className="space-y-5">
              <p className="break-words rounded-xl bg-white/5 p-3 text-sm text-slate-400">
                Страница входа:{" "}
                <a
                  className="text-amber-200 underline"
                  href="/traffic-operator"
                  target="_blank"
                  rel="noreferrer"
                >
                  {typeof window !== "undefined" ? window.location.origin : ""}
                  /traffic-operator
                </a>
              </p>
              {!live.data?.enabled ? (
                <p className="text-sm text-amber-200">
                  Сначала сохраните поток и включите его.
                </p>
              ) : null}
              <form
                onSubmit={(event) => void issue(event)}
                className="space-y-3"
              >
                <label className="block text-sm text-slate-300">
                  Сотрудник
                  <select
                    name="person"
                    required
                    defaultValue=""
                    className={`${inputClass} mt-2`}
                  >
                    <option value="" disabled>
                      Выберите сотрудника
                    </option>
                    {managed.people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm text-slate-300">
                  Рабочий кабинет
                  <select
                    name="role"
                    className={`${inputClass} mt-2`}
                    defaultValue="harvester"
                  >
                    <option value="harvester">Комбайнёр</option>
                    <option value="receiver">Приёмка картофеля</option>
                  </select>
                </label>
                <Button
                  className="min-h-[48px] w-full"
                  disabled={
                    busy ||
                    live.stale ||
                    !live.data?.enabled ||
                    !managed.people.length
                  }
                >
                  {busy ? "Выдаём доступ…" : "Выдать персональный доступ"}
                </Button>
              </form>
              {credential ? (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                  <p className="font-medium text-emerald-200">Доступ выдан</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Пароль показывается только сейчас. Передайте его этому
                    сотруднику.
                  </p>
                  <dl className="mt-3 space-y-2 break-all text-base">
                    <div>
                      <dt className="text-xs text-slate-500">Логин</dt>
                      <dd>{credential.login}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Пароль</dt>
                      <dd>{credential.password}</dd>
                    </div>
                  </dl>
                  <button
                    type="button"
                    className="mt-3 flex min-h-[48px] items-center gap-2 text-sm text-emerald-200"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(
                          `${window.location.origin}/traffic-operator\nЛогин: ${credential.login}\nПароль: ${credential.password}`,
                        )
                        .then(() => setCopied(true))
                        .catch(() =>
                          setError("Скопируйте логин и пароль вручную"),
                        )
                    }
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}{" "}
                    {copied ? "Скопировано" : "Скопировать для сотрудника"}
                  </button>
                </div>
              ) : null}
              <div className="border-t border-white/10 pt-3">
                <h3 className="mb-2 text-sm text-slate-400">
                  Выданные доступы
                </h3>
                {managed.access.map((access) => (
                  <div key={access.id} className="border-b border-white/5 py-3">
                    <p className="font-medium">
                      {managed.people.find((p) => p.id === access.person_id)
                        ?.full_name || "Сотрудник компании"}
                    </p>
                    <p className="mt-1 text-sm text-slate-400">
                      {ROLE_LABEL[access.role]}
                    </p>
                    <p className="mt-1 break-all text-xs text-slate-500">
                      {access.login}
                    </p>
                    {access.revoked_at ? (
                      <p className="mt-2 text-xs text-slate-500">
                        Доступ отозван
                      </p>
                    ) : revokeId === access.id ? (
                      <div className="mt-2">
                        <p className="text-sm text-rose-200">
                          Закрыть сотруднику этот кабинет?
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            className="min-h-[48px] rounded-lg px-3 text-sm text-rose-300"
                            onClick={() =>
                              void send({
                                action: "revoke",
                                accessId: access.id,
                              })
                            }
                          >
                            Подтвердить отзыв
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            className="min-h-[48px] px-3 text-sm text-slate-400"
                            onClick={() => setRevokeId(null)}
                          >
                            Оставить
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setRevokeId(access.id)}
                        className="mt-1 min-h-[48px] text-sm text-rose-300"
                      >
                        Отозвать доступ
                      </button>
                    )}
                  </div>
                ))}
              </div>
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
              setCredential(null);
            }}
          >
            Закрыть
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
