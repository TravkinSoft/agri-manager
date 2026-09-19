"use client";

import { shiftOperationLabel, shiftReportKg, shiftReportTime, type WeighbridgeShiftReport } from "@/lib/weighbridge/shift-report";

/** Selected design 2. Preview and saved history render this same immutable report. */
export function WeighbridgeShiftReportView({ report }: { report: WeighbridgeShiftReport }) {
  return (
    <section className="min-w-0 space-y-4 text-sm" aria-label="Отчёт смены весовой" data-report-design="large-summary">
      <div className="text-xs leading-relaxed text-muted-foreground">
        <div className="font-medium text-foreground">{report.companyName}</div>
        <div>Весовщик: {report.operatorName || "Не указан"}</div>
        <div>{shiftReportTime(report.openedAt)} — {report.closedAt ? shiftReportTime(report.closedAt) : `проверка на ${shiftReportTime(report.capturedAt)}`}</div>
      </div>

      <div className="rounded-xl bg-primary p-5 text-primary-foreground sm:p-6" data-shift-result>
        <div className="text-xs font-medium uppercase tracking-wider">Итог смены · картофель</div>
        <div className="my-2 break-words text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">{shiftReportKg(report.potatoPeriodResultKg)}</div>
        <div className="text-xs">Приход минус вывезенные примеси</div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <div className="min-w-0 rounded-xl border border-border bg-card p-3 sm:p-4">
          <div className="text-xs text-muted-foreground">Принято · нетто</div>
          <div className="my-1 break-words text-lg font-semibold tracking-tight tabular-nums sm:text-2xl">{shiftReportKg(report.potatoNetKg)}</div>
          <div className="text-xs text-muted-foreground">Картофель · рейсов: {report.potatoReceiptCount}</div>
        </div>
        <div className="min-w-0 rounded-xl border border-border bg-card p-3 sm:p-4">
          <div className="text-xs text-muted-foreground">Вывезено примесей</div>
          <div className="my-1 break-words text-lg font-semibold tracking-tight tabular-nums sm:text-2xl">{shiftReportKg(report.potatoPeriodImpuritiesKg)}</div>
          <div className="text-xs text-muted-foreground">{report.potatoPeriodImpurityTripCount == null ? "Примеси картофеля за смену" : `Рейсов вывоза: ${report.potatoPeriodImpurityTripCount}`}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2 border-b border-border pb-4 text-xs">
        <strong className="font-medium">Закрыто талонов: {report.closedTicketCount}</strong>
        <span>Открытых: {report.openTicketCount}</span>
        <span>Не синхронизировано: {report.unsyncedTicketCount}</span>
      </div>

      <details className="border-b border-border pb-4">
        <summary className="cursor-pointer py-1 font-medium">По участкам, сортам и складам</summary>
        <div className="mt-3 space-y-2">
          {report.plots.length ? report.plots.map((plot, index) => (
            <div key={`${plot.crop_structure_allocation_id || plot.field_id}-${index}`} className="flex flex-wrap justify-between gap-2 rounded-lg bg-muted/30 p-3">
              <div className="min-w-0">
                <div className="font-medium">{plot.field_name} · {plot.crop_name}</div>
                <div className="text-xs text-muted-foreground">{[plot.variety_name, plot.reproduction_name, plot.warehouse_name].filter(Boolean).join(" · ")}</div>
              </div>
              <div className="text-right"><div className="font-medium tabular-nums">{shiftReportKg(plot.net_kg)}</div><div className="text-xs text-muted-foreground">Рейсов приёмки: {plot.trips}</div></div>
            </div>
          )) : <p className="text-xs text-muted-foreground">В этой смене нет закрытых талонов приёмки урожая.</p>}
          <p className="text-xs text-muted-foreground">Здесь нетто приёмки за смену, не сбор с поля за сезон. Вывоз примесей показан отдельно.</p>
        </div>
      </details>

      <details className="border-b border-border pb-4">
        <summary className="cursor-pointer py-1 font-medium">Операции смены</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead><tr className="border-b border-border"><th className="py-2">Операция</th><th className="px-2 text-right">Талонов</th><th className="text-right">Нетто по талонам</th></tr></thead>
            <tbody>{report.operations.map(op => <tr key={op.op_type} className="border-b border-border"><td className="py-3">{shiftOperationLabel(op.op_type)}</td><td className="px-2 text-right tabular-nums">{op.trips}</td><td className="text-right tabular-nums">{shiftReportKg(op.net_kg)}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Приход, вывоз, отгрузка и перемещения показаны отдельно. Их веса не складываются в урожай.</p>
      </details>

      <details className="border-b border-border pb-4">
        <summary className="cursor-pointer py-1 font-medium">Все талоны · {report.ticketCount}</summary>
        <div className="mt-3 max-h-80 overflow-auto">
          <table className="w-full min-w-[740px] text-left text-xs">
            <thead><tr><th>Талон · время</th><th>Операция · водитель</th><th>Поле · склад</th><th className="text-right">Брутто</th><th className="text-right">Тара</th><th className="text-right">Нетто</th></tr></thead>
            <tbody>{report.tickets.map(ticket => (
              <tr key={ticket.id} className="border-t border-border align-top">
                <td className="py-2 pr-2">{ticket.ticket_no}<div className="text-muted-foreground">{shiftReportTime(ticket.finalized_at || ticket.created_at)}</div>{ticket.is_voided || ticket.status === "voided" ? <div>Аннулирован — исключён из итога</div> : ticket.replacement_ticket_id ? <div>Заменён — исключён из итога</div> : ticket.status !== "finalized" || !ticket.is_finalized ? <div>Не закрыт — исключён из итога</div> : null}</td>
                <td className="px-2 py-2">{shiftOperationLabel(ticket.op_type)}<div>{ticket.driver_name}</div><div className="text-muted-foreground">{ticket.vehicle_name} · {ticket.vehicle_plate}</div></td>
                <td className="px-2 py-2">{ticket.field_name} · {ticket.crop_name}<div>{ticket.variety_name} · {ticket.reproduction_name}</div><div className="text-muted-foreground">{ticket.warehouse_from} → {ticket.warehouse_to}</div></td>
                <td className="px-2 py-2 text-right tabular-nums">{shiftReportKg(ticket.gross_weight_kg)}</td><td className="px-2 py-2 text-right tabular-nums">{shiftReportKg(ticket.tare_weight_kg)}</td><td className="py-2 text-right tabular-nums">{shiftReportKg(ticket.net_weight_kg)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </details>

      <details className="border-b border-border pb-4">
        <summary className="cursor-pointer py-1 font-medium">Корректировки и контроль</summary>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[["Приёмка урожая", report.harvestReceiptCount], ["Вывоз примесей", report.impurityTripCount], ["Аннулировано", report.voidedTicketCount], ["Заменено исправлениями", report.replacedTicketCount], ["С корректировками", report.manualCorrectionCount], ["Не синхронизировано", report.unsyncedTicketCount]].map(([label, value]) => <div key={label} className="rounded-lg bg-muted/30 p-3"><div className="text-xs text-muted-foreground">{label}</div><strong className="font-medium tabular-nums">{value}</strong></div>)}
        </div>
      </details>
      <p className="text-xs text-muted-foreground">Этот же отчёт сохраняется в сводке после подтверждения. Остаток склада в итог смены не входит. После закрытия данные отчёта фиксируются.</p>
    </section>
  );
}
