"use client";

import { useState, type FormEvent } from "react";
import { Clock3, EllipsisVertical, Play, Square } from "lucide-react";
import type { TrafficSnapshot } from "@/lib/traffic/model";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { trafficRequest } from "./use-traffic";

export function TrafficShiftControls({
  snapshot,
  stale,
  refresh,
  onCommitted,
}: {
  snapshot: TrafficSnapshot;
  stale: boolean;
  refresh: (fresh?: boolean) => Promise<void>;
  onCommitted: () => Promise<void>;
}) {
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const shift = snapshot.combineShift;
  const open = shift?.status === "open";

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
      await onCommitted();
      setClosing(false);
    } catch (caught) {
      setError((caught as Error).message);
      void refresh(true);
    } finally {
      setBusy(false);
    }
  }

  function closeShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shift || shift.status !== "open") return;
    const form = new FormData(event.currentTarget);
    void commit({
      action: "close",
      shiftId: shift.id,
      hectaresShift: Number(form.get("hectaresShift")),
      hectaresFieldTotal: Number(form.get("hectaresFieldTotal")),
    });
  }

  return (
    <>
      <div data-testid="traffic-combine-shift" className="relative">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Меню смены комбайнёра" disabled={busy || stale || !snapshot.enabled}
              className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl text-slate-300 hover:bg-white/5 disabled:opacity-40">
              <EllipsisVertical aria-hidden size={22} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="font-normal">
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                <Clock3 aria-hidden size={15} className="text-amber-300" /> Смена комбайнёра
              </span>
              <span className={`mt-1 block text-xs ${open ? "text-emerald-300" : "text-slate-400"}`}>
                {open
                  ? `Открыта в ${new Date(shift.openedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`
                  : shift?.closedAt
                    ? `Последняя: ${shift.hectaresShift ?? 0} га · итог ${shift.hectaresFieldTotal ?? 0} га`
                    : "Смена ещё не открыта"}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {open ? (
              <DropdownMenuItem onSelect={() => setClosing(true)} className="min-h-[48px] gap-2">
                <Square aria-hidden size={16} /> Закрыть смену
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => {
                if (window.confirm("Открыть смену комбайнёра сейчас?") === true)
                  void commit({ action: "open" });
              }} className="min-h-[48px] gap-2">
                <Play aria-hidden size={16} /> Открыть смену
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {error ? <span role="alert" className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg bg-rose-950 p-2 text-xs text-rose-200">{error}</span> : null}
      </div>
      <Dialog open={closing} onOpenChange={(value) => { if (!busy) setClosing(value); }}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Закрыть смену</DialogTitle>
            <DialogDescription>
              Простая фактическая сводка комбайнёра. Значения не меняют площадь поля.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={closeShift} className="space-y-4">
            <label className="block text-sm text-slate-200">
              Гектаров за смену
              <input name="hectaresShift" type="number" inputMode="decimal" min="0" max="1000000" step="0.001" required
                className="mt-2 min-h-[48px] w-full rounded-xl border border-white/15 bg-slate-950 px-3 text-base text-white outline-none focus:border-amber-300" />
            </label>
            <label className="block text-sm text-slate-200">
              Итого гектаров на поле
              <input name="hectaresFieldTotal" type="number" inputMode="decimal" min="0" max="1000000" step="0.001" required
                className="mt-2 min-h-[48px] w-full rounded-xl border border-white/15 bg-slate-950 px-3 text-base text-white outline-none focus:border-amber-300" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={busy} onClick={() => setClosing(false)}
                className="min-h-[48px] rounded-xl border border-white/15 text-slate-200 disabled:opacity-50">Отмена</button>
              <button type="submit" disabled={busy}
                className="min-h-[48px] rounded-xl bg-amber-300 font-semibold text-slate-950 disabled:opacity-50">
                {busy ? "Сохраняем…" : "Закрыть смену"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
