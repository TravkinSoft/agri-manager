"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/contexts/auth-context";

export default function WeighbridgePrintPage() {
  const params = useParams<{ id: string }>();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [ticket, setTicket] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [weighings, setWeighings] = useState<any[]>([]);
  const ticketId = String(params?.id || "");

  useEffect(() => {
    async function loadData() {
      if (!ticketId || !profile?.id) return;
      setLoading(true);
      try {
        const response = await fetch(`/api/weighbridge/tickets/${ticketId}?userId=${encodeURIComponent(profile.id)}`);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || "Failed to load ticket");
        setTicket(payload.ticket);
        setLines(payload.lines || []);
        setWeighings(payload.weighings || []);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [ticketId, profile?.id]);

  if (loading) {
    return <div className="p-6 text-sm text-slate-500">Загрузка талона...</div>;
  }

  if (!ticket) {
    return <div className="p-6 text-sm text-red-600">Талон не найден</div>;
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-2xl font-bold">Талон весовой</h1>
        <Button onClick={() => window.print()}>Печать / PDF</Button>
      </div>

      <div className="border rounded-md p-4 space-y-2">
        <div className="text-xl font-semibold">№ {ticket.ticket_no}</div>
        <div>Статус: {ticket.status}</div>
        <div>Тип: {ticket.ticket_type} · Операция: {ticket.op_type}</div>
        <div>Направление: {ticket.direction}</div>
        <div>Брутто: {ticket.gross_weight_kg ?? "-"} кг</div>
        <div>Тара: {ticket.tare_weight_kg ?? "-"} кг</div>
        <div>Нетто: {ticket.net_weight_kg ?? "-"} кг</div>
        <div>Метод: {ticket.weigh_method}</div>
        <div>Создан: {new Date(ticket.created_at).toLocaleString()}</div>
        {ticket.finalized_at && <div>Закрыт: {new Date(ticket.finalized_at).toLocaleString()}</div>}
      </div>

      <div className="border rounded-md p-4">
        <div className="font-semibold mb-2">Строки талона</div>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b">
              <th className="text-left py-1">Продукт</th>
              <th className="text-right py-1">Количество</th>
              <th className="text-left py-1">Ед.</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} className="border-b">
                <td className="py-1">{line.product_name}</td>
                <td className="py-1 text-right">{Number(line.quantity || 0).toFixed(3)}</td>
                <td className="py-1">{line.uom || "kg"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border rounded-md p-4">
        <div className="font-semibold mb-2">События взвешивания</div>
        {weighings.length === 0 ? (
          <div className="text-sm text-slate-500">Нет данных взвешивания.</div>
        ) : (
          <ul className="list-disc ml-5 text-sm space-y-1">
            {weighings.map((item) => (
              <li key={item.id}>
                #{item.weighing_no}: {item.measured_weight_kg} кг · {new Date(item.measured_at).toLocaleString()}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

