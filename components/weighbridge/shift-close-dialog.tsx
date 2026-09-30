"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getWeighbridgeShiftPreview } from "@/lib/services/weighbridge";
import { canCloseWeighbridgeReport, type WeighbridgeShiftReport } from "@/lib/weighbridge/shift-report";
import { WeighbridgeShiftReportView } from "./shift-report";

export function WeighbridgeShiftCloseDialog({ open, onOpenChange, companyId, shiftId, onConfirm, onOpenShift }: {
  open: boolean; onOpenChange: (open: boolean) => void; companyId: string; shiftId: string | null;
  onConfirm: (reviewToken: string) => Promise<void>; onOpenShift: () => Promise<void>;
}) {
  const [report, setReport] = useState<WeighbridgeShiftReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    setReport(null);
    if (!open || !shiftId || !companyId) return;
    const controller = new AbortController();
    setLoading(true);
    getWeighbridgeShiftPreview(companyId, shiftId, controller.signal).then(value => {
      if (!controller.signal.aborted) setReport(value);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause?.message || "Не удалось загрузить итог. Повторите проверку.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, companyId, shiftId, revision]);

  async function confirm() {
    if (!report || busy || loading || report.shiftId !== shiftId || !canCloseWeighbridgeReport(report)) return;
    setBusy(true); setError("");
    try { await onConfirm(report.reviewToken); }
    catch (cause: any) {
      setError(cause?.payload?.code === "SHIFT_PREVIEW_CHANGED"
        ? "Талоны изменились. Ниже обновлённый отчёт — проверьте его и подтвердите ещё раз."
        : cause?.message || "Не удалось закрыть смену. Повторите проверку.");
      setRevision(value => value + 1);
    } finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={value => { if (!busy) { setError(""); onOpenChange(value); } }}><DialogContent className="flex max-h-[90vh] max-h-[90dvh] w-[calc(100%_-_1rem)] flex-col rounded-xl sm:max-w-2xl">
    <DialogHeader><DialogTitle>Проверка итогов перед закрытием</DialogTitle><DialogDescription>Всё за смену — перед вами. Ничего вводить не нужно.</DialogDescription></DialogHeader>
    <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
      {error ? <p role="alert" className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm">{error}</p> : null}
      {!shiftId ? <p>Смена сейчас закрыта.</p> : loading ? <p role="status" className="flex items-center gap-2 py-8"><Loader2 className="h-4 w-4 animate-spin" />Сверяем все талоны смены…</p> : report && report.shiftId === shiftId ? <>
        <WeighbridgeShiftReportView report={report} />
        {!canCloseWeighbridgeReport(report) ? <p role="alert" className="rounded border border-amber-500/40 p-3 text-sm">{report.openTicketCount > 0 ? "Сначала завершите открытые талоны. " : ""}{report.unsyncedTicketCount > 0 ? "Дождитесь синхронизации талонов. " : ""}{report.potatoPeriodResultKg == null ? "Не определена культура или масса примесей — проверьте талоны." : ""}{report.closedAt ? "Эта смена уже закрыта." : ""}</p> : null}
      </> : null}
    </div>
    <DialogFooter className="flex-wrap gap-2 border-t border-border pt-3"><Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Отмена</Button>{shiftId ? <><Button variant="outline" disabled={loading || busy} onClick={() => { setError(""); setRevision(value => value + 1); }}>Обновить итог</Button><Button disabled={busy || loading || report?.shiftId !== shiftId || !canCloseWeighbridgeReport(report)} onClick={() => void confirm()}>{busy ? "Сохраняем отчёт…" : "Подтвердить и закрыть смену"}</Button></> : <Button onClick={() => void onOpenShift()}>Открыть смену</Button>}</DialogFooter>
  </DialogContent></Dialog>;
}
