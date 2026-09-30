"use client";

import { useEffect, useMemo, useState } from "react";
import { FileDown, Loader2, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { TicketPreviewDialog } from "@/components/weighbridge/ticket-preview-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/contexts/auth-context";
import { downloadTicketPdf, listTicketHistoryPage } from "@/lib/services/weighbridge";
import type { WeighbridgeTicket } from "@/lib/types/weighbridge";
import { formatWeightKg } from "@/lib/weighbridge/weight-format";
import { transportPickerLabel } from "@/lib/weighbridge/transport";

const operationLabels: Record<string, string> = {
  harvest_incoming: "Урожай с поля",
  supplier_receipt: "От контрагента",
  issue_to_field: "Выдача в поле",
  warehouse_transfer: "Перемещение",
  transfer_between_warehouses: "Перемещение",
  shipment_outbound: "Отгрузка",
  disposal: "Списание",
  disposal_writeoff: "Списание",
  weighbridge_impurities: "Примеси",
  impurity_removal: "Примеси",
};

const HISTORY_PAGE_SIZE = 50;

function ticketDate(ticket: WeighbridgeTicket): string {
  const raw = ticket.finalized_at || ticket.voided_at || ticket.updated_at || ticket.created_at;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function ticketWeight(ticket: WeighbridgeTicket): string {
  const value = ticket.accepted_weight_kg ?? ticket.physical_net_kg ?? ticket.net_weight_kg;
  return value == null ? "—" : formatWeightKg(value);
}

function ticketTransport(ticket: WeighbridgeTicket): string {
  return transportPickerLabel({
    name: ticket.vehicle_name_snapshot || "Транспорт не указан",
    plate: ticket.vehicle_plate_snapshot || null,
  });
}

export default function WeighbridgeHistoryPage() {
  const { user, profile, loading: authLoading } = useAuth();
  const [tickets, setTickets] = useState<WeighbridgeTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (authLoading) return;
    if (!profile?.company_id || !user?.id) {
      setLoading(false);
      setError("Не выбран контекст компании.");
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setTickets([]);
    setHasMore(false);
    setNextCursor(null);
    setError(null);
    void listTicketHistoryPage(profile.company_id, user.id, {
      limit: HISTORY_PAGE_SIZE,
      signal: controller.signal,
    })
      .then((page) => {
        if (controller.signal.aborted) return;
        setTickets(page.tickets);
        setHasMore(page.hasMore);
        setNextCursor(page.nextCursor);
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Не удалось загрузить журнал талонов.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [authLoading, profile?.company_id, profile?.id, user?.id, reloadToken]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || !nextCursor || !profile?.company_id || !user?.id) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await listTicketHistoryPage(profile.company_id, user.id, {
        cursor: nextCursor,
        limit: HISTORY_PAGE_SIZE,
      });
      setTickets((current) => {
        const byId = new Map(current.map((ticket) => [ticket.id, ticket]));
        page.tickets.forEach((ticket) => byId.set(ticket.id, ticket));
        return Array.from(byId.values());
      });
      setHasMore(page.hasMore);
      setNextCursor(page.nextCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить следующую страницу журнала.");
    } finally {
      setLoadingMore(false);
    }
  };

  const visibleTickets = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru-RU");
    if (!normalized) return tickets;
    return tickets.filter((ticket) => [
      ticket.ticket_no,
      ticket.vehicle_name_snapshot,
      ticket.vehicle_plate_snapshot,
      ticket.driver_name_snapshot,
      operationLabels[ticket.op_type] || ticket.op_type,
    ].some((value) => String(value || "").toLocaleLowerCase("ru-RU").includes(normalized)));
  }, [query, tickets]);

  return (
    <div className="space-y-4">
      <PageHeader title="Журнал талонов" description="Закрытые и аннулированные документы · только просмотр" />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск по талону, машине, водителю или операции"
          aria-label="Поиск по журналу талонов"
          className="sm:max-w-xl"
        />
        <Button type="button" variant="outline" onClick={() => setReloadToken((value) => value + 1)} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
          Обновить
        </Button>
      </div>

      {error ? (
        <div role="alert" className="rounded-lg border border-red-900/60 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Загружаем журнал…
        </div>
      ) : null}

      {!loading && !error && visibleTickets.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Талоны не найдены.</CardContent></Card>
      ) : null}

      {!loading && visibleTickets.length > 0 ? (
        <>
          <div className="grid gap-2 md:hidden">
            {visibleTickets.map((ticket) => (
              <Card key={ticket.id}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">№ {ticket.ticket_no}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{ticketDate(ticket)}</div>
                    </div>
                    <Badge variant="outline">{ticket.status === "voided" ? "Аннулирован" : "Закрыт"}</Badge>
                  </div>
                  <div className="text-sm">
                    <div className="font-medium">{ticketTransport(ticket)}</div>
                    <div className="text-muted-foreground">{ticket.driver_name_snapshot || "Водитель не указан"}</div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-muted-foreground">{operationLabels[ticket.op_type] || ticket.op_type}</span>
                    <span className="font-semibold">{ticketWeight(ticket)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="button" variant="outline" onClick={() => setSelectedTicketId(ticket.id)}>Открыть</Button>
                    <Button type="button" variant="outline" onClick={() => void downloadTicketPdf(ticket.id)}>
                      <FileDown className="mr-2 h-4 w-4" aria-hidden="true" />PDF
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="hidden overflow-hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Талон</TableHead>
                  <TableHead>Дата / время</TableHead>
                  <TableHead>Операция</TableHead>
                  <TableHead>Транспорт</TableHead>
                  <TableHead>Водитель</TableHead>
                  <TableHead className="text-right">Нетто</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleTickets.map((ticket) => (
                  <TableRow key={ticket.id}>
                    <TableCell className="font-semibold">№ {ticket.ticket_no}</TableCell>
                    <TableCell>{ticketDate(ticket)}</TableCell>
                    <TableCell>{operationLabels[ticket.op_type] || ticket.op_type}</TableCell>
                    <TableCell>{ticketTransport(ticket)}</TableCell>
                    <TableCell>{ticket.driver_name_snapshot || "—"}</TableCell>
                    <TableCell className="text-right font-semibold">{ticketWeight(ticket)}</TableCell>
                    <TableCell><Badge variant="outline">{ticket.status === "voided" ? "Аннулирован" : "Закрыт"}</Badge></TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => setSelectedTicketId(ticket.id)}>Открыть</Button>
                        <Button type="button" size="icon" variant="ghost" onClick={() => void downloadTicketPdf(ticket.id)} aria-label={`Скачать PDF талона ${ticket.ticket_no}`}>
                          <FileDown className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {hasMore ? (
            <div className="flex justify-center">
              <Button type="button" variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                Загрузить ещё
              </Button>
            </div>
          ) : null}
        </>
      ) : null}

      <TicketPreviewDialog
        ticketId={selectedTicketId}
        open={Boolean(selectedTicketId)}
        onOpenChange={(open) => { if (!open) setSelectedTicketId(null); }}
      />
    </div>
  );
}
