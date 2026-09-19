"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchableCombobox } from "@/components/weighbridge/searchable-combobox";
import { trafficRequest } from "@/components/traffic/use-traffic";
import { publishTrafficChanged } from "@/lib/traffic/changes";

const vehicle = z.object({ id: z.string().uuid(), name: z.string(), plate: z.string().nullable(),
  driverId: z.string().uuid().nullable(), driverName: z.string().nullable(), assignmentId: z.string().uuid().nullable(),
  version: z.number().int(), state: z.string(), assigned: z.boolean(),
});
const optionsSchema = z.object({ companyId: z.string().uuid(), source: vehicle, targets: z.array(vehicle) });
const receiptSchema = z.object({ companyId: z.string().uuid(), sourceVehicleId: z.string().uuid(), vehicleId: z.string().uuid(),
  driverId: z.string().uuid(), state: z.enum(["empty", "loaded", "unloading"]), ptcEventId: z.string().uuid().nullable(),
  ptcCycle: z.number().int(), ticketIds: z.array(z.string().uuid()), replacementId: z.string().uuid(),
});
export type DriverVehicleReplacementReceipt = z.infer<typeof receiptSchema>;
const label = (v: z.infer<typeof vehicle>) => `${v.name} · ${v.plate || "без номера"}`;

export function DriverVehicleReplacement({ companyId, vehicleId, driverId, disabled, autoOpen = false, onClosed, onReplaced }: {
  companyId?: string; vehicleId?: string; driverId?: string; disabled?: boolean; autoOpen?: boolean;
  onClosed?: () => void; onReplaced?: (receipt: DriverVehicleReplacementReceipt) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(autoOpen);
  const [options, setOptions] = useState<z.infer<typeof optionsSchema> | null>(null);
  const [targetId, setTargetId] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const key = useRef<string | null>(null);
  const locked = useRef(false);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    setOptions(null); setError(""); setTargetId(""); key.current = null;
    const params = new URLSearchParams();
    if (companyId) params.set("companyId", companyId);
    if (vehicleId) params.set("vehicleId", vehicleId);
    if (driverId) params.set("driverId", driverId);
    void trafficRequest(`/api/vehicles/replace-for-driver?${params}`, "GET", undefined, false, abort.signal)
      .then(data => { if (!abort.signal.aborted) setOptions(optionsSchema.parse(data)); })
      .catch(caught => { if (!abort.signal.aborted) setError((caught as Error).message); });
    return () => abort.abort();
  }, [open, companyId, vehicleId, driverId]);
  function close() { if (!locked.current) { setOpen(false); onClosed?.(); } }
  const target = options?.targets.find(v => v.id === targetId);
  async function replace() {
    if (locked.current || disabled || !options?.source.driverId || !target) return;
    locked.current = true; setPending(true); setError("");
    key.current ??= crypto.randomUUID();
    let receipt: DriverVehicleReplacementReceipt;
    try {
      receipt = receiptSchema.parse(await trafficRequest("/api/vehicles/replace-for-driver", "POST", {
        companyId: options.companyId, driverId: options.source.driverId, sourceVehicleId: options.source.id,
        vehicleId: target.id, sourceVersion: options.source.version, targetVersion: target.version,
        sourceAssignmentId: options.source.assignmentId, targetAssignmentId: target.assignmentId, key: key.current,
      }));
      if (receipt.companyId !== options.companyId || receipt.vehicleId !== target.id || receipt.driverId !== options.source.driverId
        || receipt.sourceVehicleId !== options.source.id || receipt.replacementId !== key.current) throw new Error("Нет подтверждения замены. Обновите ПТС");
    } catch (caught) {
      setError((caught as Error).message); setPending(false); locked.current = false; return;
    }
    // The server receipt is final; a failed optional refresh is not a failed replacement.
    publishTrafficChanged(receipt.companyId, "fleet");
    setPending(false); locked.current = false; setOpen(false); onClosed?.();
    await onReplaced?.(receipt);
  }
  return <>
    {!autoOpen ? <Button type="button" variant="outline" disabled={disabled || (!vehicleId && !driverId)} onClick={() => setOpen(true)}>
      Заменить машину у водителя
    </Button> : null}
    <Dialog open={open} onOpenChange={value => { if (!value) close(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Заменить машину у водителя</DialogTitle>
          <DialogDescription>Водитель, груз и текущий этап сохранятся. Машина изменится в ПТС и открытом талоне. Закрытые рейсы не меняются.</DialogDescription>
        </DialogHeader>
        {options ? <div className="space-y-4">
          <p className="break-words text-sm"><strong>{options.source.driverName}</strong><br />Сейчас: {label(options.source)}</p>
          <SearchableCombobox value={targetId} onValueChange={id => { setTargetId(id); key.current = null; }}
            options={options.targets.map(v => ({ value: v.id, label: label(v), description: v.driverName ? `Вне линии · закреплён ${v.driverName}` : "Не на линии" }))}
            disabled={pending} placeholder="Выберите новую машину" searchPlaceholder="Марка или госномер" emptyLabel="Свободных машин вне линии нет" ariaLabel="Новая машина водителя" />
          {target ? <p className="rounded-md border p-3 text-sm">Подтвердите: {options.source.driverName} → {label(target)}.
            {target.driverName && target.driverId !== options.source.driverId ? ` Текущее закрепление за ${target.driverName} будет снято.` : ""}
            {" "}Прежняя машина уйдёт в «Не на линии».</p> : null}
          <Button type="button" className="w-full" disabled={pending || !target || disabled} onClick={() => void replace().catch(() => undefined)}>
            {pending ? "Сохраняем замену…" : "Подтвердить замену"}
          </Button>
        </div> : !error ? <p role="status">Проверяем машины…</p> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <Button type="button" variant="outline" disabled={pending} onClick={close}>Отмена</Button>
      </DialogContent>
    </Dialog>
  </>;
}
