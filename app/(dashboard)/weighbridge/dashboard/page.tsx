"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/contexts/auth-context";
import { listTickets } from "@/lib/services/weighbridge";
import type { WeighbridgeTicket } from "@/lib/types/weighbridge";

function isActiveStatus(status: string | null | undefined) {
  const s = String(status || "").toLowerCase();
  return s === "draft" || s === "active" || s === "ready_to_close";
}

export default function WeighbridgeDashboardPage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState<WeighbridgeTicket[]>([]);

  const isAgronomistObserver = profile?.role === "agronomist";
  const isOperationalRole = profile?.role === "weighman" || profile?.role === "warehouse_operator" || profile?.role === "warehouse";

  useEffect(() => {
    if (authLoading) return;
    if (isOperationalRole) {
      router.replace("/weighbridge");
    }
  }, [authLoading, isOperationalRole, router]);

  useEffect(() => {
    if (authLoading || isOperationalRole) return;
    (async () => {
      if (!profile?.company_id || !profile?.id) return;
      setLoading(true);
      try {
        const rows = await listTickets(profile.company_id, profile.id);
        setTickets(rows);
      } finally {
        setLoading(false);
      }
    })();
  }, [authLoading, profile?.company_id, profile?.id, isOperationalRole]);

  if (authLoading || isOperationalRole) return null;

  const metrics = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const active = tickets.filter((t) => isActiveStatus(t.status)).length;
    const awaitingSecond = tickets.filter(
      (t) =>
        isActiveStatus(t.status) &&
        t.weigh_method === "double_weighing" &&
        (t.net_weight_kg == null || Number(t.net_weight_kg) <= 0),
    ).length;
    const finalizedToday = tickets.filter((t) => String(t.status) === "finalized" && String(t.finalized_at || "").slice(0, 10) === today).length;
    const byType = tickets.reduce<Record<string, number>>((acc, t) => {
      const key = String(t.op_type || "unknown");
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    return { active, awaitingSecond, finalizedToday, byType };
  }, [tickets]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Весовая Dashboard"
        description={
          isAgronomistObserver
            ? "Обзорный режим: оперативная картина по талонам без действий управления."
            : "Оперативная панель весовщика: талоны, взвешивания, движения"
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardContent className="pt-5"><div className="text-sm text-slate-500">Активные талоны</div><div className="text-3xl font-bold">{metrics.active}</div></CardContent></Card>
        <Card><CardContent className="pt-5"><div className="text-sm text-slate-500">Ожидают 2-е взвешивание</div><div className="text-3xl font-bold">{metrics.awaitingSecond}</div></CardContent></Card>
        <Card><CardContent className="pt-5"><div className="text-sm text-slate-500">Финализировано сегодня</div><div className="text-3xl font-bold">{metrics.finalizedToday}</div></CardContent></Card>
        <Card><CardContent className="pt-5"><div className="text-sm text-slate-500">Всего талонов</div><div className="text-3xl font-bold">{tickets.length}</div></CardContent></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{isAgronomistObserver ? "Режим наблюдения" : "Быстрые действия"}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {isAgronomistObserver ? (
              <div className="text-sm text-slate-600">
                Для агронома доступен только обзор. Создание и ведение талонов доступны весовщику.
              </div>
            ) : (
              <>
                <Button asChild><Link href="/weighbridge">Создать талон</Link></Button>
                <Button asChild variant="outline"><Link href="/weighbridge">Активные талоны</Link></Button>
                <Button asChild variant="outline"><Link href="/weighbridge/history">История талонов</Link></Button>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Талоны по типам</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {Object.keys(metrics.byType).length === 0 ? (
              <div className="text-sm text-slate-500">{loading ? "Загрузка..." : "Нет данных"}</div>
            ) : (
              Object.entries(metrics.byType)
                .sort((a, b) => b[1] - a[1])
                .map(([type, count]) => (
                  <div key={type} className="flex justify-between text-sm">
                    <span className="text-slate-600">{type}</span>
                    <span className="font-medium">{count}</span>
                  </div>
                ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Последние движения</CardTitle></CardHeader>
        <CardContent>
          {tickets.length === 0 ? (
            <div className="text-sm text-slate-500">{loading ? "Загрузка..." : "Талоны отсутствуют"}</div>
          ) : (
            <div className="space-y-2">
              {tickets.slice(0, 8).map((ticket) => (
                <div key={ticket.id} className="rounded-md border p-2 flex items-center justify-between text-sm">
                  <span>{ticket.ticket_no} · {ticket.op_type}</span>
                  <span className="text-slate-500">{ticket.status}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
