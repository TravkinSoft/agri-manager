"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Truck, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  FleetEntityCreationError,
  saveFleetEntity,
  type FleetEntityCreationResult,
} from "@/lib/fleet/entity-creation-client";
import type { FleetDuplicateCandidate, FleetEntityCreateCommand, FleetEntityKind } from "@/lib/fleet/entity-creation";
import { publishTrafficChanged } from "@/lib/traffic/changes";
import { cn } from "@/lib/utils";

type DuplicateWarning = {
  code: "exact_duplicate" | "potential_duplicate";
  candidates: FleetDuplicateCandidate[];
};

export function FleetEntityCreator({
  open,
  companyId,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  companyId: string;
  onOpenChange: (open: boolean) => void;
  onCreated?: (result: FleetEntityCreationResult) => void | Promise<void>;
}) {
  const [kind, setKind] = useState<FleetEntityKind>("vehicle");
  const [vehicleName, setVehicleName] = useState("");
  const [plate, setPlate] = useState("");
  const [fullName, setFullName] = useState("");
  const [warning, setWarning] = useState<DuplicateWarning | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const request = useRef<AbortController | null>(null);
  const { toast } = useToast();

  function resetFeedback() {
    setWarning(null);
    setError("");
  }

  function resetAll() {
    request.current?.abort();
    request.current = null;
    setKind("vehicle");
    setVehicleName("");
    setPlate("");
    setFullName("");
    setWarning(null);
    setError("");
    setPending(false);
  }

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!open) resetAll();
    // Resetting is intentionally tied only to the controlled dialog state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function changeOpen(next: boolean) {
    if (!next && pending) return;
    if (!next) resetAll();
    onOpenChange(next);
  }

  async function submit(confirmPotentialDuplicate = false) {
    if (pending) return;
    const name = vehicleName.trim();
    const vehiclePlate = plate.trim();
    const driverName = fullName.trim();
    if (kind === "vehicle" && (!name || !vehiclePlate)) {
      setError("Укажите название и номер машины");
      return;
    }
    if (kind === "driver" && driverName.split(/\s+/).filter(Boolean).length < 2) {
      setError("Укажите хотя бы фамилию и имя");
      return;
    }

    const command: FleetEntityCreateCommand = kind === "vehicle"
      ? { kind, companyId, name, plate: vehiclePlate, confirmPotentialDuplicate }
      : { kind, companyId, fullName: driverName, confirmPotentialDuplicate };
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setPending(true);
    setError("");
    try {
      const result = await saveFleetEntity(command, controller.signal);
      if (controller.signal.aborted) return;
      onOpenChange(false);
      resetAll();
      publishTrafficChanged(result.companyId);
      try { await onCreated?.(result); } catch { /* The canonical insert is already committed. */ }
      toast({
        title: result.kind === "vehicle" ? "Машина добавлена" : "Водитель добавлен",
        description: result.kind === "vehicle"
          ? "Машина находится в списке «Не на линии»."
          : "Водителя уже можно назначить машине.",
      });
    } catch (caught) {
      if (controller.signal.aborted) return;
      if (caught instanceof FleetEntityCreationError && caught.code) {
        setWarning({ code: caught.code, candidates: caught.candidates });
        setError("");
      } else {
        setError(caught instanceof Error ? caught.message : "Не удалось создать запись");
      }
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  const exact = warning?.code === "exact_duplicate";
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogContent hideCloseButton
      data-testid="fleet-entity-creator"
      className="flex max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-md flex-col overflow-y-auto rounded-2xl border-slate-700 bg-slate-950 p-4 text-slate-100 sm:p-5">
      <DialogHeader className="pr-10 text-left">
        <DialogTitle>Добавить в автопарк</DialogTitle>
        <DialogDescription className="text-slate-400">Запись сразу будет общей для TravkinFlow.</DialogDescription>
      </DialogHeader>
      <Button type="button" variant="ghost" aria-label="Закрыть" disabled={pending}
        className="absolute right-1 top-1 h-12 w-12 p-0" onClick={() => changeOpen(false)}>
        <X aria-hidden size={20} />
      </Button>

      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Что добавить">
        {([[
          "vehicle", "Машину", Truck,
        ], [
          "driver", "Водителя", UserRound,
        ]] as const).map(([value, label, Icon]) => (
          <button key={value} type="button" aria-pressed={kind === value} disabled={pending}
            onClick={() => { setKind(value); resetFeedback(); }}
            className={cn(
              "flex min-h-[48px] items-center justify-center gap-2 rounded-xl border px-3 text-sm font-medium",
              kind === value
                ? "border-amber-300 bg-amber-300 text-slate-950"
                : "border-white/15 bg-white/5 text-slate-300",
            )}>
            <Icon aria-hidden size={18} />{label}
          </button>
        ))}
      </div>

      <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit(false); }}>
        {kind === "vehicle" ? <>
          <div className="space-y-2">
            <Label htmlFor="fleet-vehicle-name">Название машины</Label>
            <Input id="fleet-vehicle-name" autoFocus autoComplete="off" inputMode="text"
              placeholder="Например, КАМАЗ 45142-011" value={vehicleName} disabled={pending}
              onChange={event => { setVehicleName(event.target.value); resetFeedback(); }}
              className="min-h-[48px] text-base" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fleet-vehicle-plate">Номер машины</Label>
            <Input id="fleet-vehicle-plate" autoComplete="off" inputMode="text"
              placeholder="Например, 308 AR 15" value={plate} disabled={pending}
              onChange={event => { setPlate(event.target.value); resetFeedback(); }}
              className="min-h-[48px] text-base uppercase" />
          </div>
        </> : <div className="space-y-2">
          <Label htmlFor="fleet-driver-name">ФИО водителя</Label>
          <Input id="fleet-driver-name" autoFocus autoComplete="name" inputMode="text"
            placeholder="Например, Цалко Андрей" value={fullName} disabled={pending}
            onChange={event => { setFullName(event.target.value); resetFeedback(); }}
            className="min-h-[48px] text-base" />
        </div>}

        {warning ? <div role="alert" className={cn(
          "rounded-xl border p-3",
          exact ? "border-rose-400/40 bg-rose-400/10" : "border-amber-300/40 bg-amber-300/10",
        )}>
          <div className="flex items-start gap-2">
            <AlertTriangle aria-hidden className={cn("mt-0.5 shrink-0", exact ? "text-rose-300" : "text-amber-300")} size={18} />
            <div className="min-w-0">
              <p className="font-semibold">{exact ? "Такая запись уже есть" : "Возможно, это дубль"}</p>
              <p className="mt-1 text-sm text-slate-300">{exact
                ? "Новый дубль создать нельзя. Измените данные или используйте существующую запись."
                : "Проверьте найденные записи. Если это действительно другая машина или другой человек, создание можно продолжить."}</p>
            </div>
          </div>
          {warning.candidates.length ? <div className="mt-3 divide-y divide-white/10 rounded-lg bg-black/20 px-3">
            {warning.candidates.map(candidate => <div key={`${candidate.kind}:${candidate.id}`} className="py-2">
              <p className="break-words text-sm font-medium">{candidate.title}</p>
              {candidate.subtitle ? <p className="mt-0.5 break-words text-sm text-slate-300">{candidate.subtitle}</p> : null}
              <p className="mt-1 text-xs text-slate-400">{candidate.reason}</p>
            </div>)}
          </div> : null}
        </div> : null}

        {error ? <p role="alert" className="rounded-xl bg-rose-400/10 p-3 text-sm text-rose-200">{error}</p> : null}

        {warning && !exact ? <div className="grid gap-2 sm:grid-cols-2">
          <Button type="button" variant="outline" className="min-h-[48px]" disabled={pending}
            onClick={resetFeedback}>Изменить данные</Button>
          <Button type="button" className="min-h-[48px]" disabled={pending}
            onClick={() => void submit(true)}>
            {pending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />Создаём…</> : "Создать всё равно"}
          </Button>
        </div> : <Button type="submit" className="min-h-[48px] w-full" disabled={pending || !!exact}>
          {pending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />Проверяем…</> : exact ? "Дубль не создан" : "Добавить"}
        </Button>}
      </form>
    </DialogContent>
  </Dialog>;
}
