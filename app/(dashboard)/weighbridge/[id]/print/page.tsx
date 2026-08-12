"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { WeighbridgeTicketPaper } from "@/components/weighbridge/weighbridge-ticket-paper";
import { buildClientAuthHeaders } from "@/lib/supabase/client-auth";
import type { WeighbridgeTicket } from "@/lib/types/weighbridge";

export default function WeighbridgePrintPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<WeighbridgeTicket | null>(null);
  const ticketId = String(params?.id || "");
  const autoPrint = searchParams.get("autoprint") === "1";

  useEffect(() => {
    async function loadData() {
      if (!ticketId) return;
      setLoading(true);
      setError(null);
      try {
        const headers = await buildClientAuthHeaders();
        const response = await fetch(`/api/weighbridge/tickets/${ticketId}`, { cache: "no-store", headers });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || "Не удалось загрузить талон");
        setTicket(payload.ticket ? { ...payload.ticket, lines: payload.lines || payload.ticket.lines || [] } : null);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Не удалось загрузить талон");
      } finally {
        setLoading(false);
      }
    }
    void loadData();
  }, [ticketId]);

  useEffect(() => {
    if (!autoPrint || loading || !ticket) return;
    const timer = window.setTimeout(() => window.print(), 120);
    return () => window.clearTimeout(timer);
  }, [autoPrint, loading, ticket]);

  if (loading) return <div className="p-6 text-sm text-slate-500">Загрузка талона...</div>;
  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;
  if (!ticket) return <div className="p-6 text-sm text-red-600">Талон не найден</div>;

  return (
    <div className="weighbridge-print-root bg-white p-4">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body * { visibility: hidden !important; }
          .weighbridge-print-root, .weighbridge-print-root * { visibility: visible !important; }
          .weighbridge-print-root {
            position: absolute !important;
            inset: 0 auto auto 0 !important;
            width: 100% !important;
            padding: 0 !important;
            background: #fff !important;
          }
          .weighbridge-print-sheet {
            box-shadow: none !important;
            border-radius: 0 !important;
          }
          body { background: #fff !important; }
          @page { size: 90mm 160mm; margin: 4mm; }
        }
      `}</style>
      <div className="no-print mb-3 flex items-center justify-between">
        <h1 className="text-xl font-bold">Предпросмотр талона</h1>
        <Button onClick={() => window.print()}>Печать / PDF</Button>
      </div>
      <WeighbridgeTicketPaper ticket={ticket} />
    </div>
  );
}
