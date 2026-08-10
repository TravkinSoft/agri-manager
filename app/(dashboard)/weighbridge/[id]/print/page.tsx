"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { buildClientAuthHeaders } from "@/lib/supabase/client-auth";
import { formatWeightKg, formatWeightNumber } from "@/lib/weighbridge/weight-format";

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

const unitLabel = (unit: string | null | undefined) => {
  const value = String(unit || "").trim().toLowerCase();
  if (value === "kg" || value === "кг") return "кг";
  if (value === "l" || value === "л") return "л";
  if (value === "m" || value === "м") return "м";
  if (value === "roll") return "бухта";
  if (value === "pcs") return "шт";
  if (value === "pack") return "уп.";
  return value || "ед.";
};

const qty = (value: unknown, unit?: string | null) => `${formatWeightNumber(value, "-")} ${unitLabel(unit)}`;

const productSummary = (lines: any[], limit = 3) => {
  const names = (lines || []).map((line) => String(line.product_name || line.product_name_snapshot || "").trim()).filter(Boolean);
  if (names.length === 0) return "-";
  const shown = names.slice(0, limit).join(", ");
  return names.length > limit ? `${shown} + ещё ${names.length - limit}` : shown;
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
        const headers = await buildClientAuthHeaders();
        const response = await fetch(`/api/weighbridge/tickets/${ticketId}`, { cache: "no-store", headers });
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
  const isHarvest = ticket?.op_type === "harvest_incoming";
  const isSupplierReceipt = ticket?.op_type === "supplier_receipt";
  const isDirectSupplierReceipt = isSupplierReceipt && ticket?.receipt_mode === "direct";
  const isTransfer = ticket?.op_type === "warehouse_transfer";
  const isShipment = ticket?.op_type === "shipment_outbound";
  const ticketNo = ticket?.ticket_no || ticket?.id || "-";
  const companyLabel = String(ticket?.company_name || "").trim() || "Компания";
  const allocationLabel = ticket?.crop_structure_allocation_label || mainLine?.crop_structure_allocation_label || "-";
  const warehouseLabel = ticket?.warehouse_to_name_snapshot || ticket?.warehouse_from_name_snapshot || "-";
  const cropLabel = isHarvest ? mainLine?.product_name || mainLine?.product_name_snapshot || ticket?.crop_name_snapshot || "-" : productSummary(lines);
  const varietyLabel = mainLine?.variety_name || mainLine?.variety_name_snapshot || ticket?.variety_name_snapshot || "-";
  const reproductionLabel = mainLine?.reproduction_name || mainLine?.reproduction_name_snapshot || ticket?.reproduction_name_snapshot || "-";
  const operatorLabel = ticket?.created_by_name_snapshot || "-";
  const weightLabel = ticket?.receipt_mode === "direct" ? "По документу" : "ВЕСОВЫЕ ДАННЫЕ";
  const contextLabel = isSupplierReceipt
    ? ticket?.supplier_name_snapshot || "-"
    : isTransfer
      ? `${ticket?.warehouse_from_name_snapshot || "-"} → ${ticket?.warehouse_to_name_snapshot || "-"}`
      : isShipment
        ? `${ticket?.warehouse_from_name_snapshot || "-"} → ${ticket?.buyer_name_snapshot || "-"}`
        : ticket?.field_name_snapshot || "-";

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

      <div
        className="weighbridge-print-sheet mx-auto min-h-[960px] w-full max-w-[540px] rounded-md border bg-[#f7f1e3] p-4 text-[#1f1b16]"
        style={{ boxShadow: "inset 0 0 40px rgba(80,56,30,0.08)" }}
      >
        <div className="mb-3 border-b border-[#b8a788] pb-2 text-center">
          <div className="text-sm font-semibold tracking-wide">{companyLabel}</div>
          <div className="mt-1 text-3xl font-black">ВЕСОВОЙ ТАЛОН</div>
          <div className="mt-1 text-lg font-bold">№ {ticketNo}</div>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-[#5d4f3d]">Статус:</span> <span className="font-bold">{statusLabel(ticket.status)}</span></div>
          <div><span className="text-[#5d4f3d]">Тип операции:</span> <span className="font-bold">{opLabel(ticket.op_type)}</span></div>
          {isDirectSupplierReceipt ? <div><span className="text-[#5d4f3d]">Контрагент:</span> <span className="font-semibold">{contextLabel}</span></div> : <div><span className="text-[#5d4f3d]">{isHarvest ? "Поле:" : "Контекст:"}</span> <span className="font-semibold">{contextLabel}</span></div>}
          {isDirectSupplierReceipt ? <div><span className="text-[#5d4f3d]">Склад назначения:</span> <span className="font-semibold">{warehouseLabel}</span></div> : <div><span className="text-[#5d4f3d]">Склад:</span> <span className="font-semibold">{warehouseLabel}</span></div>}
          {isHarvest ? <div><span className="text-[#5d4f3d]">Культура:</span> <span className="font-semibold">{cropLabel}</span></div> : lines.length === 0 ? <div><span className="text-[#5d4f3d]">Товары:</span> <span className="font-semibold">{cropLabel}</span></div> : null}
          {isHarvest ? <div><span className="text-[#5d4f3d]">Посевная строка:</span> <span className="font-semibold">{allocationLabel}</span></div> : null}
          {isHarvest ? <div><span className="text-[#5d4f3d]">Сорт:</span> <span className="font-semibold">{varietyLabel}</span></div> : null}
          {isHarvest ? <div><span className="text-[#5d4f3d]">Репродукция:</span> <span className="font-semibold">{reproductionLabel}</span></div> : null}
        </div>

        {!isDirectSupplierReceipt ? <div className="mb-3 rounded border border-[#b8a788] p-3 text-sm">
          <div className="mb-2 text-center text-lg font-bold">ТРАНСПОРТ И ВОДИТЕЛЬ</div>
          <div className="grid grid-cols-2 gap-3">
            <div><span className="text-[#5d4f3d]">Машина:</span> <span className="font-bold">{ticket.vehicle_name_snapshot || "-"}</span></div>
            <div><span className="text-[#5d4f3d]">Водитель:</span> <span className="font-bold">{ticket.driver_name_snapshot || "-"}</span></div>
            <div><span className="text-[#5d4f3d]">Госномер:</span> <span className="font-semibold">{ticket.vehicle_plate_snapshot || "-"}</span></div>
            <div />
          </div>
        </div> : null}

        {!isDirectSupplierReceipt ? <div className="mb-3 rounded border border-[#b8a788] p-2 text-sm">
          <div className="mb-2 text-center text-lg font-bold">{weightLabel}</div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div><div className="text-xs text-[#5d4f3d]">Брутто</div><div className="text-xl font-bold">{formatWeightKg(ticket.gross_weight_kg)}</div></div>
            <div><div className="text-xs text-[#5d4f3d]">Тара</div><div className="text-xl font-bold">{formatWeightKg(ticket.tare_weight_kg)}</div></div>
            <div><div className="text-xs text-[#5d4f3d]">Нетто</div><div className="text-xl font-bold">{formatWeightKg(ticket.net_weight_kg)}</div></div>
          </div>
        </div> : null}

        {lines.length > 0 && (
          <div className="mb-3 rounded border border-[#b8a788] p-2 text-xs">
            <div className="mb-2 text-center text-base font-bold">СТРОКИ ДОКУМЕНТА</div>
            <div className="space-y-1">
              {lines.map((line, index) => (
                <div key={line.id || index} className="grid grid-cols-[22px_1fr_auto] gap-2 border-b border-[#c7b797] pb-1 last:border-0 last:pb-0">
                  <div className="font-bold">{index + 1}.</div>
                  <div>
                    <div className="font-semibold">{line.product_name || line.product_name_snapshot || "-"}</div>
                    {isHarvest ? <div className="text-[#5d4f3d]">
                      {[line.variety_name, line.reproduction_name].filter(Boolean).join(" / ") || "-"}
                    </div> : null}
                    <div className="text-[#5d4f3d]">
                      {[line.warehouse_to_name || line.warehouse_from_name, line.lot_id ? `партия ${line.lot_id}` : "", line.unit_price ? `цена ${Number(line.unit_price).toLocaleString("ru-RU")}` : ""].filter(Boolean).join(" • ") || "-"}
                    </div>
                  </div>
                  <div className="text-right font-bold">
                    {qty(line.quantity ?? line.quantity_kg ?? line.net_line_weight_kg, line.uom)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="text-sm">
          <div><span className="text-[#5d4f3d]">{isDirectSupplierReceipt ? "Дата:" : "Время взвешивания:"}</span> <span className="font-semibold">{fmt(ticket.finalized_at || ticket.updated_at || ticket.created_at)}</span></div>
          <div><span className="text-[#5d4f3d]">Создан:</span> <span className="font-semibold">{fmt(ticket.created_at)}</span></div>
          <div><span className="text-[#5d4f3d]">Весовщик:</span> <span className="font-semibold">{operatorLabel}</span></div>
          {ticket.notes ? <div><span className="text-[#5d4f3d]">Примечание:</span> <span className="font-semibold">{ticket.notes}</span></div> : null}
          {ticket.supplier_document_no ? <div><span className="text-[#5d4f3d]">Номер документа:</span> <span className="font-semibold">{ticket.supplier_document_no}</span></div> : null}
          {!isDirectSupplierReceipt && (ticket.lot_id || ticket.batch_id || mainLine?.lot_id) ? <div><span className="text-[#5d4f3d]">Партия:</span> <span className="font-semibold">{ticket.lot_id || ticket.batch_id || mainLine?.lot_id || "-"}</span></div> : null}
          <div><span className="text-[#5d4f3d]">ID:</span> <span className="font-semibold">{ticket.id}</span></div>
        </div>
      </div>
    </div>
  );
}
