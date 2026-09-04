"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchableCombobox } from "@/components/weighbridge/searchable-combobox";
import { supabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  loadVehicleDriverAssignment, publishVehicleDriverAssignment, saveVehicleDriverAssignment,
  type VehicleDriverAssignmentResult,
} from "@/lib/vehicles/driver-assignment-client";

export interface VehicleDriverAssignmentProps {
  vehicleId: string;
  companyId?: string | null;
  driverName?: string | null;
  vehicleLabel?: string;
  disabled?: boolean;
  onAssigned?: (result: VehicleDriverAssignmentResult) => void;
  className?: string;
  iconOnly?: boolean;
}

const NO_DRIVER = "__no_driver__";
const conflictMessage = "Привязку уже изменили. Показан текущий водитель — выберите нужного и сохраните ещё раз.";

export function VehicleDriverAssignment({ vehicleId, companyId, driverName, vehicleLabel, disabled = false,
  onAssigned, className, iconOnly = false }: VehicleDriverAssignmentProps) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<VehicleDriverAssignmentResult | null>(null);
  const [selected, setSelected] = useState(NO_DRIVER);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const busy = useRef(false);
  const openScope = useRef<string | null>(null);
  const scope = `${companyId ?? ""}:${vehicleId}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;

  const cancelRequest = () => { epoch.current++; request.current?.abort(); request.current = null; busy.current = false; };
  const close = () => { openScope.current = null; cancelRequest(); setOpen(false); setSaving(false); setLoading(false); };
  const load = async (message = "") => {
    cancelRequest();
    const generation = epoch.current;
    const owner = new AbortController();
    request.current = owner;
    setLoading(true); setSaving(false); setData(null); setError(message);
    try {
      const result = await loadVehicleDriverAssignment(vehicleId, companyId, owner.signal);
      if (owner.signal.aborted || generation !== epoch.current || scope !== currentScope.current) return;
      setData(result); setSelected(result.vehicle.driverPersonId ?? NO_DRIVER);
    } catch (caught) {
      if (owner.signal.aborted || generation !== epoch.current || scope !== currentScope.current) return;
      setError([message, caught instanceof Error ? caught.message : "Не удалось загрузить водителей"].filter(Boolean).join(" "));
    } finally {
      if (generation === epoch.current && scope === currentScope.current) setLoading(false);
    }
  };

  useEffect(() => {
    close(); setData(null); setError("");
    // A previous vehicle/company request cannot update this reused control.
    return cancelRequest;
    // Scope alone owns the request lifecycle; handlers deliberately capture that scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  useEffect(() => {
    if (!open || openScope.current !== scope) return;
    let identity: string | null | undefined;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const next = session?.user.id ?? null;
      if (event === "SIGNED_OUT" || (identity !== undefined && next !== identity)) {
        close(); setData(null);
      }
      identity = next;
    });
    void load();
    return () => { subscription.unsubscribe(); cancelRequest(); };
    // No subscription or driver-list request for closed vehicle rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope]);

  // A dangling legacy assignment still needs an explicit clear even if its
  // person can no longer be resolved to a current driver.
  const unchanged = selected === NO_DRIVER
    ? data?.vehicle.assignmentId === null
    : selected === data?.vehicle.driverPersonId;
  const save = async () => {
    if (busy.current || loading || disabled || !data?.canEdit || scope !== currentScope.current) return;
    if (unchanged) return;
    busy.current = true; setSaving(true); setError("");
    const generation = ++epoch.current;
    request.current?.abort();
    const owner = new AbortController();
    request.current = owner;
    try {
      const result = await saveVehicleDriverAssignment({ companyId: data.companyId, vehicleId,
        driverPersonId: selected === NO_DRIVER ? null : selected,
        expectedAssignmentId: data.vehicle.assignmentId }, owner.signal);
      if (owner.signal.aborted || generation !== epoch.current || scope !== currentScope.current) return;
      setData(result); setOpen(false);
      publishVehicleDriverAssignment(result);
      try { onAssigned?.(result); } catch { /* The assignment is already committed. */ }
    } catch (caught) {
      if (owner.signal.aborted || generation !== epoch.current || scope !== currentScope.current) return;
      if ((caught as { status?: number })?.status === 409) {
        await load(conflictMessage);
      } else {
        setError(caught instanceof Error ? caught.message : "Не удалось сохранить водителя");
      }
    } finally {
      if (generation === epoch.current && scope === currentScope.current) { busy.current = false; setSaving(false); }
    }
  };

  const label = vehicleLabel || vehicleId;
  const actionLabel = `${driverName ? "Сменить водителя" : "Назначить водителя"}: ${label}`;
  const options = [
    { value: NO_DRIVER, label: "Без водителя" },
    ...(data?.drivers ?? []).map(driver => ({ value: driver.id, label: driver.name })),
  ];
  if (data?.vehicle.driverPersonId && !options.some(option => option.value === data.vehicle.driverPersonId)) {
    options.push({ value: data.vehicle.driverPersonId, label: data.vehicle.driverName || "Текущий водитель" });
  }
  return <>
    <Button type="button" variant="ghost" disabled={disabled || !vehicleId} aria-label={actionLabel} title={actionLabel}
      className={cn("min-h-[48px] min-w-[48px] max-w-full touch-manipulation", iconOnly ? "h-12 w-12 shrink-0 p-0" : "justify-start gap-2 px-2", className)}
      onClick={event => { event.stopPropagation(); openScope.current = scope; setOpen(true); }}>
      <UserRound className="h-4 w-4 shrink-0" aria-hidden="true" />
      {!iconOnly ? <span className="truncate">{driverName || "Назначить водителя"}</span> : null}
    </Button>
    <Dialog open={open} onOpenChange={next => { if (!next) close(); }}>
      <DialogContent hideCloseButton className="w-[calc(100%-2rem)] max-w-md rounded-xl border-slate-700 bg-slate-950 p-4 text-slate-100 data-[state=closed]:hidden"
        onClick={event => event.stopPropagation()}>
        <DialogHeader className="pr-10 text-left">
          <DialogTitle>Водитель машины</DialogTitle>
          <DialogDescription className="break-words text-slate-400">{vehicleLabel || [data?.vehicle.name, data?.vehicle.plate].filter(Boolean).join(" · ") || vehicleId}</DialogDescription>
        </DialogHeader>
        <Button type="button" variant="ghost" aria-label="Закрыть выбор водителя" className="absolute right-1 top-1 h-12 w-12 p-0" onClick={close}>
          <X className="h-5 w-5" aria-hidden="true" />
        </Button>
        {loading ? <p role="status" className="flex min-h-[48px] items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Загружаем водителей…</p> : null}
        {data ? <SearchableCombobox mobile value={selected} options={options} onValueChange={setSelected}
          placeholder="Выберите водителя" searchPlaceholder="Найти водителя" emptyLabel="Водитель не найден"
          ariaLabel="Водитель машины" disabled={saving || disabled || !data.canEdit} /> : null}
        <p className="text-sm text-slate-400">Закреплён за машиной до ручной смены. Старые талоны не изменятся.</p>
        {data && !data.canEdit ? <p className="text-sm text-amber-300">Нет прав на смену водителя.</p> : null}
        {error ? <p role="alert" className="text-sm text-amber-300">{error}</p> : null}
        {!loading && !data ? <Button type="button" variant="outline" className="min-h-[48px]" onClick={() => void load()}>Повторить загрузку</Button> : null}
        <Button type="button" className="min-h-[48px] w-full" disabled={loading || saving || disabled || !data?.canEdit || unchanged} onClick={() => void save()}>
          {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Сохраняем…</> : "Сохранить"}
        </Button>
      </DialogContent>
    </Dialog>
  </>;
}
