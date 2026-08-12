"use client";

import { useEffect, useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WeighbridgeTicketPaper } from "@/components/weighbridge/weighbridge-ticket-paper";
import { downloadTicketPdf, getTicketDetails } from "@/lib/services/weighbridge";
import type { WeighbridgeTicket } from "@/lib/types/weighbridge";

type TicketPayload = { ticket: WeighbridgeTicket };

export function TicketPreviewDialog({
  ticketId,
  open,
  onOpenChange,
}: {
  ticketId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [payload, setPayload] = useState<TicketPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !ticketId) return;
    let active = true;
    setLoading(true);
    setError("");
    setPayload(null);
    void getTicketDetails(ticketId)
      .then((result) => {
        if (active) setPayload(result as TicketPayload);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "Не удалось открыть талон");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [open, ticketId]);

  const ticket = payload?.ticket || null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader className="sr-only">
          <DialogTitle>{ticket ? `Весовой талон ${ticket.ticket_no}` : "Весовой талон"}</DialogTitle>
          <DialogDescription>Просмотр документа без перехода со склада</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex min-h-48 items-center justify-center gap-2 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" />Загрузка талона...</div>
          ) : error ? (
            <div className="rounded-md border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>
          ) : ticket ? (
            <WeighbridgeTicketPaper ticket={ticket} />
          ) : null}
        </div>

        <DialogFooter className="shrink-0 border-t border-slate-800 pt-4 sm:justify-between">
          <Button variant="outline" disabled={!ticket} onClick={() => ticket && downloadTicketPdf(ticket.id)}><FileDown className="mr-2 h-4 w-4" />PDF</Button>
          <DialogClose asChild>
            <Button onClick={() => onOpenChange(false)}>Закрыть</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
