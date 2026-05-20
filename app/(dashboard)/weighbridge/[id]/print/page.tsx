"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";

const opLabel = (opType: string) => {
  if (opType === "harvest_incoming") return "Урожай с поля";
  if (opType === "supplier_receipt") return "Поставка от контрагента";
  if (opType === "issue_to_field") return "Выдача в поле";
  if (opType === "warehouse_transfer") return "Склад → склад";
  if (opType === "shipment_outbound") return "Отгрузка";
  if (opType === "disposal") return "Списание / выбытие";
  if (opType === "drying") return "Сушка";
  return opType || "Операция";
};

const statusLabel = (status: string) => {
  if (status === "finalized") return "ЗАКРЫТ";
  if (status === "ready_to_close") return "К ЗАКРЫТИЮ";
  if (status === "active") return "ОТКРЫТ";
  if (status === "voided") return "АННУЛИРОВАН";
  return (status || "-").toUpperCase();
};

const fmt = (value: string | null | undefined) => {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
};

const kg = (value: unknown) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
};

export default function WeighbridgePrintPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);

  const ticketId = String(params?.id || "");
  const autoPrint = searchParams.get("autoprint") === "1";

  useEffect(() => {
    async function loadData() {
      if (!ticketId) return;
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/weighbridge/tickets/${ticketId}`, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || "Не удалось загрузить талон");
        setTicket(payload.ticket || null);
        setLines(payload.lines || []);
      } catch (e: any) {
        setError(e?.message || "Не удалось загрузить талон");
      } finally {
        setLoading(false);
      }
    }
    void loadData();
  }, [ticketId]);

  useEffect(() => {
    if (!autoPrint || loading || !ticket) return;
    const t = setTimeout(() => window.print(), 120);
    return () => clearTimeout(t);
  }, [autoPrint, loading, ticket]);

  const mainLine = useMemo(() => (lines || [])[0] || null, [lines]);
  const ticketNo = ticket?.ticket_no || ticket?.id || "-";
  const allocationLabel = ticket?.crop_structure_allocation_label || mainLine?.crop_structure_allocation_label || "-";
  const warehouseLabel = ticket?.warehouse_to_name_snapshot || ticket?.warehouse_from_name_snapshot || "-";
  const cropLabel = mainLine?.product_name || mainLine?.product_name_snapshot || ticket?.crop_name_snapshot || "-";
  const varietyLabel = mainLine?.variety_name || mainLine?.variety_name_snapshot || ticket?.variety_name_snapshot || "-";
  const reproductionLabel = mainLine?.reproduction_name || mainLine?.reproduction_name_snapshot || ticket?.reproduction_name_snapshot || "-";
  const operatorLabel = ticket?.created_by_name_snapshot || "-";

  if (loading) return <div className="p-6 text-sm text-slate-500">Загрузка талона...</div>;
  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;
  if (!ticket) return <div className="p-6 text-sm text-red-600">Талон не найден</div>;

  return (
    <div className="bg-white p-4">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
          @page { size: 90mm 160mm; margin: 4mm; }
        }
      `}</style>

      <div className="no-print mb-3 flex items-center justify-between">
        <h1 className="text-xl font-bold">Предпросмотр талона</h1>
        <Button onClick={() => window.print()}>Печать / PDF</Button>
      </div>

      <div
        className="mx-auto min-h-[960px] w-full max-w-[540px] rounded-md border bg-[#f7f1e3] p-4 text-[#1f1b16]"
        style={{ boxShadow: "inset 0 0 40px rgba(80,56,30,0.08)" }}
      >
        <div className="mb-3 border-b border-[#b8a788] pb-2 text-center">
          <div className="text-sm font-semibold tracking-wide">ТОО “АСТЫК-STEM”</div>
          <div className="mt-1 text-3xl font-black">ВЕСОВОЙ ТАЛОН</div>
          <div className="mt-1 text-lg font-bold">№ {ticketNo}</div>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-[#5d4f3d]">Статус:</span> <span className="font-bold">{statusLabel(ticket.status)}</span></div>
          <div><span className="text-[#5d4f3d]">Тип операции:</span> <span className="font-bold">{opLabel(ticket.op_type)}</span></div>
          <div><span className="text-[#5d4f3d]">Поле:</span> <span className="font-semibold">{ticket.field_name_snapshot || "-"}</span></div>
          <div><span className="text-[#5d4f3d]">Склад:</span> <span className="font-semibold">{warehouseLabel}</span></div>
          <div><span className="text-[#5d4f3d]">Культура:</span> <span className="font-semibold">{cropLabel}</span></div>
          <div><span className="text-[#5d4f3d]">Посевная строка:</span> <span className="font-semibold">{allocationLabel}</span></div>
          <div><span className="text-[#5d4f3d]">Сорт:</span> <span className="font-semibold">{varietyLabel}</span></div>
          <div><span className="text-[#5d4f3d]">Репродукция:</span> <span className="font-semibold">{reproductionLabel}</span></div>
        </div>

        <div className="mb-3 rounded border border-[#b8a788] p-3 text-sm">
          <div className="mb-2 text-center text-lg font-bold">ТРАНСПОРТ И ВОДИТЕЛЬ</div>
          <div className="grid grid-cols-2 gap-3">
            <div><span className="text-[#5d4f3d]">Машина:</span> <span className="font-bold">{ticket.vehicle_name_snapshot || "-"}</span></div>
            <div><span className="text-[#5d4f3d]">Водитель:</span> <span className="font-bold">{ticket.driver_name_snapshot || "-"}</span></div>
            <div><span className="text-[#5d4f3d]">Госномер:</span> <span className="font-semibold">{ticket.vehicle_plate_snapshot || "-"}</span></div>
            <div />
          </div>
        </div>

        <div className="mb-3 rounded border border-[#b8a788] p-2 text-sm">
          <div className="mb-2 text-center text-lg font-bold">ВЕСОВЫЕ ДАННЫЕ</div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div><div className="text-xs text-[#5d4f3d]">Брутто</div><div className="text-xl font-bold">{kg(ticket.gross_weight_kg)} кг</div></div>
            <div><div className="text-xs text-[#5d4f3d]">Тара</div><div className="text-xl font-bold">{kg(ticket.tare_weight_kg)} кг</div></div>
            <div><div className="text-xs text-[#5d4f3d]">Нетто</div><div className="text-xl font-bold">{kg(ticket.net_weight_kg)} кг</div></div>
          </div>
        </div>

        <div className="text-sm">
          <div><span className="text-[#5d4f3d]">Время взвешивания:</span> <span className="font-semibold">{fmt(ticket.finalized_at || ticket.updated_at || ticket.created_at)}</span></div>
          <div><span className="text-[#5d4f3d]">Создан:</span> <span className="font-semibold">{fmt(ticket.created_at)}</span></div>
          <div><span className="text-[#5d4f3d]">Весовщик:</span> <span className="font-semibold">{operatorLabel}</span></div>
          <div><span className="text-[#5d4f3d]">Примечание:</span> <span className="font-semibold">{ticket.notes || "-"}</span></div>
          <div><span className="text-[#5d4f3d]">Партия:</span> <span className="font-semibold">{ticket.lot_id || ticket.batch_id || mainLine?.lot_id || "-"}</span></div>
          <div><span className="text-[#5d4f3d]">ID:</span> <span className="font-semibold">{ticket.id}</span></div>
        </div>
      </div>
    </div>
  );
}
