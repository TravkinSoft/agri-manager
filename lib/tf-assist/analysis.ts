import {
  add,
  grams,
  kg,
  positiveArea,
  project,
  yieldTonnes,
} from "./arithmetic";
import {
  complete,
  label,
  rows,
  str,
  type Answer,
  type Choice,
  type Evidence,
  type Intent,
  type Metric,
  type Question,
  type Row,
  type Snapshot,
  type SourceName,
} from "./contracts";
import { businessTime } from "./business-time";

export const effective = (t: Row): boolean =>
  t.status === "finalized" &&
  t.is_finalized === true &&
  t.is_voided !== true &&
  !t.replacement_ticket_id;
const ev = (table: SourceName, row: Row, value?: string): Evidence => ({
  table,
  id: str(row, "id") || str(row, "vehicle_id") || str(row, "company_id"),
  status:
    str(row, "status") ||
    str(row, "state") ||
    (row.is_finalized ? "finalized" : "recorded"),
  occurredAt:
    str(row, "finalized_at") ||
    str(row, "occurred_at") ||
    str(row, "updated_at") ||
    str(row, "since") ||
    undefined,
  value,
});
const index = (s: Snapshot, t: SourceName) =>
  new Map(rows(s, t).map((r) => [str(r, "id"), r]));
const norm = (v: string): string =>
  v.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/\s+/g, " ").trim();

export function sourceChoices(s: Snapshot, seasonId: string): Choice[] {
  const fields = index(s, "fields"),
    crops = index(s, "crops"),
    varieties = index(s, "varieties"),
    reproductions = index(s, "seed_reproductions");
  return rows(s, "crop_structure")
    .filter((r) => r.season_id === seasonId)
    .map((r) => ({
      id: str(r, "id"),
      label: `${label(fields.get(str(r, "field_id")))} · ${label(crops.get(str(r, "crop_id")))} · ${label(varieties.get(str(r, "variety_id")))} · ${label(reproductions.get(str(r, "reproduction_id")))}${r.archived ? " · архив" : ""}`,
    }));
}

/** Binding uses IDs and validated lineage, never names. Conflicting source evidence is unresolved. */
export function ticketSource(s: Snapshot, ticket: Row): string | null {
  const candidates = new Set<string>();
  if (str(ticket, "crop_structure_allocation_id"))
    candidates.add(str(ticket, "crop_structure_allocation_id"));
  rows(s, "harvest_lot_batches")
    .filter((r) => r.source_ticket_id === ticket.id)
    .forEach((r) => {
      if (str(r, "crop_structure_id"))
        candidates.add(str(r, "crop_structure_id"));
    });
  rows(s, "inventory_batches")
    .filter((r) => r.source_ticket_id === ticket.id)
    .forEach((r) => {
      if (str(r, "crop_structure_id"))
        candidates.add(str(r, "crop_structure_id"));
    });
  if (candidates.size !== 1) return null;
  const id = Array.from(candidates)[0],
    source = rows(s, "crop_structure").find((r) => r.id === id);
  if (
    !source ||
    source.identity_review_required ||
    (ticket.field_id && source.field_id !== ticket.field_id) ||
    (ticket.season_id && source.season_id !== ticket.season_id)
  )
    return null;
  const lines = rows(s, "ticket_lines").filter(
    (l) => l.ticket_id === ticket.id,
  );
  if (
    !lines.length ||
    lines.some(
      (l) =>
        l.is_mixed_harvest === true ||
        ["crop_id", "variety_id", "reproduction_id"].some(
          (k) => l[k] && l[k] !== source[k],
        ),
    )
  )
    return null;
  return id;
}

function pickSource(
  s: Snapshot,
  q: Question,
  choices: Choice[],
): Choice | undefined {
  const message = norm(q.message);
  const fields = index(s, "fields"),
    varieties = index(s, "varieties"),
    reps = index(s, "seed_reproductions");
  const fieldNumber = /пол[еяю]\s*№?\s*(\d+[а-яa-z]?)/i.exec(message)?.[1];
  const namedVarieties = rows(s, "varieties").filter((r) =>
    [str(r, "name"), str(r, "name_ru")].some(
      (n) => n.length > 2 && message.includes(norm(n)),
    ),
  );
  const namedReps = rows(s, "seed_reproductions").filter((r) =>
    [str(r, "name"), str(r, "name_ru")].some(
      (n) => n.length > 2 && message.includes(norm(n)),
    ),
  );
  if (!fieldNumber && !namedVarieties.length && !namedReps.length)
    return q.sourceId ? choices.find((c) => c.id === q.sourceId) : undefined;
  const candidates = choices.filter((c) => {
    const r = rows(s, "crop_structure").find((r) => r.id === c.id)!;
    const field = fields.get(str(r, "field_id"));
    const fieldMatch =
      !fieldNumber ||
      [field && str(field, "field_code"), field && str(field, "name")].some(
        (v) =>
          v &&
          (norm(v) === fieldNumber ||
            new RegExp(`(?:^|\\D)${fieldNumber}(?:$|\\D)`, "i").test(v)),
      );
    return (
      fieldMatch &&
      (!namedVarieties.length ||
        namedVarieties.includes(varieties.get(str(r, "variety_id"))!)) &&
      (!namedReps.length ||
        namedReps.includes(reps.get(str(r, "reproduction_id"))!))
    );
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function buildAnswer(s: Snapshot, q: Question, intent: Intent): Answer {
  const answer: Answer = {
    conclusion: "",
    metrics: [],
    warnings: [
      "Данные прочитаны за указанный интервал; это не атомарный снимок базы.",
    ],
    companyId: s.companyId,
    readInterval: { from: s.startedAt, to: s.endedAt },
    sourceAudit: Object.values(s.sources).map((source) => {
      const { rows: _rows, ...audit } = source!;
      return audit;
    }),
  };
  if (q.companyId !== s.companyId) throw new Error("Tenant mismatch");
  const unavailable = Object.values(s.sources)
    .filter((r) => r?.state !== "complete")
    .map((r) => r!.table);
  if (unavailable.length)
    answer.warnings.push(
      `Недоступные или неполные источники: ${unavailable.join(", ")}. Их отсутствие не означает ноль.`,
    );
  if (intent === "traffic" || intent === "fleet")
    return operationalAnswer(s, answer, intent);
  if (
    !complete(s, [
      "seasons",
      "crop_structure",
      "fields",
      "crops",
      "varieties",
      "seed_reproductions",
    ])
  ) {
    answer.conclusion =
      "Справочники источников недоступны. Точные итоги сейчас подтвердить нельзя.";
    return answer;
  }
  const seasons = rows(s, "seasons");
  const active = seasons.filter((r) => r.archived !== true);
  const season = q.seasonId
    ? seasons.find((r) => r.id === q.seasonId)
    : active.length === 1
      ? active[0]
      : undefined;
  answer.seasons = seasons.map((r) => ({ id: str(r, "id"), label: label(r) }));
  if (!season) {
    answer.conclusion = "Уточните сезон, чтобы не смешивать урожай разных лет.";
    return answer;
  }
  answer.seasonId = str(season, "id");
  const choices = sourceChoices(s, answer.seasonId);
  const choice = pickSource(s, q, choices);
  if (!choice) {
    answer.conclusion = q.sourceId
      ? "Источник неоднозначен или недоступен в выбранной компании и сезоне. Выберите его заново."
      : "Выберите точный участок: поле, сорт и репродукция считаются отдельно.";
    answer.choices = choices;
    if (
      /сейчас|убираем|уборка/i.test(q.message) &&
      complete(s, ["ptc_flows"])
    ) {
      const flow = rows(s, "ptc_flows").find((r) => r.enabled === true);
      const activeSources = flow
        ? rows(s, "crop_structure").filter(
            (r) =>
              r.field_id === flow.field_id &&
              r.season_id === season.id &&
              !r.archived,
          )
        : [];
      answer.conclusion = flow
        ? "ПТЦ включён на указанном поле. Ниже участки этого поля в выбранном сезоне; конкретный убираемый сорт подтвердите по источнику рейсов."
        : "Активная уборка в ПТЦ сейчас не отмечена. Выберите участок для анализа поступлений.";
      if (flow)
        answer.metrics.push({
          label: "Поле текущего ПТЦ",
          value: label(index(s, "fields").get(str(flow, "field_id"))),
          kind: "fact",
          evidence: [ev("ptc_flows", flow)],
        });
      for (const r of activeSources)
        answer.metrics.push({
          label: "Участок структуры",
          value: choices.find((c) => c.id === r.id)!.label,
          kind: "fact",
          evidence: [ev("crop_structure", r)],
        });
    }
    return answer;
  }
  answer.sourceId = choice.id;
  const source = rows(s, "crop_structure").find((r) => r.id === choice.id)!;
  const metric = (
    label: string,
    value: string,
    evidence: Evidence[],
    kind: Metric["kind"] = "fact",
    formula?: string,
  ) => answer.metrics.push({ label, value, evidence, kind, formula });
  if (
    !complete(s, [
      "tickets",
      "ticket_lines",
      "harvest_lot_batches",
      "inventory_batches",
    ])
  ) {
    answer.conclusion =
      "Часть весовых источников недоступна. Итог по урожаю не подтверждён.";
    return answer;
  }
  if (source.identity_review_required) {
    answer.conclusion =
      "Идентичность этого участка требует проверки. Объединять массы пока нельзя.";
    return answer;
  }
  const scoped = rows(s, "tickets").filter(
    (t) => t.op_type === "harvest_incoming" && ticketSource(s, t) === choice.id,
  );
  const receipts = scoped.filter(effective);
  const unresolved = rows(s, "tickets").filter(
    (t) =>
      t.op_type === "harvest_incoming" &&
      effective(t) &&
      (!t.field_id || t.field_id === source.field_id) &&
      (!t.season_id || t.season_id === source.season_id) &&
      !ticketSource(s, t),
  );
  const review = receipts.filter((t) => t.requires_review === true);
  answer.conclusion = `${choice.label}, сезон ${label(season)}: подтверждённые поступления за весь сезон и состояние источника.`;
  if (
    /сегодня|вчера|позавчера|за\s+\d+\s+(?:дн|час)|\d{4}-\d{2}-\d{2}/i.test(
      q.message,
    )
  ) {
    answer.conclusion =
      "Этот срез считает поступления за весь выбранный сезон. Для ответа за день нужен отдельный подтверждённый период; текущий запрос не рассчитан.";
    return answer;
  }
  if (unresolved.length || review.length) {
    answer.conclusion =
      "Есть талоны с неразрешённым источником или требованием проверки. Полный итог и урожайность не подтверждены.";
    metric(
      "Талоны для сверки",
      String(unresolved.length + review.length),
      [...unresolved, ...review].map((t) => ev("tickets", t)),
    );
  }
  const valid = receipts.filter((t) => !t.requires_review);
  let received: number;
  try {
    received = add(
      ...valid.map((t) => {
        const n = grams(t.accepted_weight_kg ?? t.net_weight_kg);
        if (n < 0) throw new Error();
        return n;
      }),
    );
  } catch {
    answer.conclusion =
      "В поступлениях отсутствует корректная масса. Точный расчёт остановлен.";
    return answer;
  }
  const receiptEvidence = valid.map((t) => ({
    ...ev("tickets", t, kg(grams(t.accepted_weight_kg ?? t.net_weight_kg))),
    occurredAt: businessTime(t, rows(s, "tickets")),
  }));
  if (receiptEvidence.some((e) => !e.occurredAt))
    answer.warnings.push(
      "Для части талонов бизнес-дата не подтверждена; период за день по ним определять нельзя.",
    );
  metric(
    unresolved.length || review.length
      ? "Известная часть поступлений"
      : "Принято урожая до складской примеси",
    kg(received),
    receiptEvidence,
    "calculation",
    "Σ accepted_weight_kg (при отсутствии — net_weight_kg) действующих закрытых harvest_incoming",
  );
  metric(
    "Закрытые рейсы",
    String(valid.length),
    receiptEvidence,
    "calculation",
  );
  const open = scoped.filter(
    (t) =>
      t.is_voided !== true &&
      t.is_finalized !== true &&
      ["draft", "active", "ready_to_close"].includes(str(t, "status")),
  );
  metric(
    "Незакрытые рейсы — без прибавления массы",
    String(open.length),
    open.map((t) => ev("tickets", t)),
    "calculation",
  );
  const excluded = scoped.filter(
    (t) => t.is_voided === true || Boolean(t.replacement_ticket_id),
  );
  if (excluded.length)
    metric(
      "Исключены отменённые / заменённые",
      String(excluded.length),
      excluded.map((t) => ev("tickets", t)),
      "calculation",
    );
  metric(
    "Площадь структуры — не убранные гектары",
    `${String(source.area ?? "не указана")} га`,
    [ev("crop_structure", source, String(source.area))],
  );
  const lots = rows(s, "harvest_lot_batches").filter(
    (r) => r.crop_structure_id === choice.id,
  );
  if (complete(s, ["harvest_lots"])) {
    const ids = new Set(lots.map((r) => str(r, "harvest_lot_id")));
    const matches = rows(s, "harvest_lots").filter((r) =>
      ids.has(str(r, "id")),
    );
    metric(
      "Связанные партии урожая",
      matches.map((r) => str(r, "lot_code") || str(r, "id")).join("; ") ||
        "нет подтверждённых связей",
      matches.map((r) => ev("harvest_lots", r)),
    );
  }
  const settlement = cleanSettlement(s, choice.id, received, answer);
  if (settlement) {
    metric(
      "Оформленная чистая масса в общих документах",
      kg(settlement.clean),
      settlement.evidence,
      "calculation",
      "Σ source_total_snapshot_kg − allocated_impurity_kg; только подтверждённое распределение по этому источнику",
    );
    metric(
      "Примесь в этих документах",
      kg(settlement.impurity),
      settlement.evidence,
      "calculation",
    );
    if (settlement.pending > 0)
      metric(
        "Масса без подтверждённого распределения общей примеси",
        kg(settlement.pending),
        [...receiptEvidence, ...settlement.evidence],
        "calculation",
      );
    if (settlement.pending > 0 && settlement.ratios.length) {
      const low = Math.min(...settlement.ratios),
        high = Math.max(...settlement.ratios);
      metric(
        "Прогноз чистой массы уже принятого урожая",
        `${kg(add(settlement.clean, Math.floor(settlement.pending * (1 - high))))} — ${kg(add(settlement.clean, Math.ceil(settlement.pending * (1 - low))))}`,
        [...receiptEvidence, ...settlement.evidence],
        "forecast",
        "Оформленная чистая масса + ещё не оформленная масса с диапазоном наблюдённой примеси того же источника. Это сценарные границы, не доверительный интервал.",
      );
    }
  }
  if (!unresolved.length && !review.length && intent === "yield") {
    const parsedHa =
      /(?:примерно|около|убран[оаы]?)?\s*(\d+(?:[.,]\d+)?)\s*га/i.exec(
        q.message,
      )?.[1];
    const remainingMatch = /остал[а-я]*\s*(\d+(?:[.,]\d+)?)\s*га/i.exec(
      q.message,
    )?.[1];
    const harvestedInput =
      q.harvestedHa || (!remainingMatch ? parsedHa : undefined);
    if (!harvestedInput)
      answer.warnings.push(
        "Для урожайности укажите фактически убранные гектары; площадь структуры вместо них не подставляется.",
      );
    else
      try {
        const ha = positiveArea(harvestedInput);
        metric(
          "Валовая урожайность по принятому урожаю",
          yieldTonnes(received, ha),
          receiptEvidence,
          "calculation",
          `${kg(received)} / ${harvestedInput} га; площадь сообщена пользователем, точность не подтверждена`,
        );
        answer.warnings.push(
          "Урожайность зависит от полноты рейсов и точности указанной убранной площади.",
        );
        if (settlement && settlement.pending === 0 && received > 0)
          metric(
            "Чистая урожайность по оформленным документам",
            yieldTonnes(settlement.clean, ha),
            settlement.evidence,
            "calculation",
            `Оформленная чистая масса / ${harvestedInput} га`,
          );
        const remainingInput = q.remainingHa || remainingMatch;
        if (remainingInput) {
          const remaining = positiveArea(remainingInput),
            predicted = project(received, ha, remaining);
          metric(
            "Сценарий урожая с оставшейся площади",
            kg(predicted),
            receiptEvidence,
            "forecast",
            `При сохранении наблюдаемой урожайности: ${harvestedInput} га убрано, ${remainingInput} га осталось. Это точечный сценарий, не доверительный интервал.`,
          );
          metric(
            "Сценарий полного сбора",
            kg(add(received, predicted)),
            receiptEvidence,
            "forecast",
            "Подтверждённые поступления + сценарий оставшейся площади",
          );
          if (settlement && settlement.ratios.length) {
            const ratioLow = Math.min(...settlement.ratios),
              ratioHigh = Math.max(...settlement.ratios);
            metric(
              "Сценарий чистой массы с оставшейся площади",
              `${kg(Math.floor(predicted * (1 - ratioHigh)))} — ${kg(Math.ceil(predicted * (1 - ratioLow)))}`,
              settlement.evidence,
              "forecast",
              "Границы — минимум и максимум доли примеси в оформленных общих документах этого источника. Не статистический доверительный интервал.",
            );
          } else
            answer.warnings.push(
              "Чистый прогноз не рассчитан: нет проверенного распределения примеси для этого источника.",
            );
        }
      } catch (e) {
        answer.warnings.push(
          e instanceof Error ? e.message : "Проверьте площадь.",
        );
      }
  }
  if (intent === "stock" || intent === "reconcile" || intent === "harvest")
    stockAnswer(s, choice.id, received, receiptEvidence, answer);
  return answer;
}

function cleanSettlement(
  s: Snapshot,
  sourceId: string,
  received: number,
  answer: Answer,
):
  | {
      clean: number;
      impurity: number;
      pending: number;
      ratios: number[];
      evidence: Evidence[];
    }
  | undefined {
  const tables: SourceName[] = [
    "weighbridge_shared_impurity_groups",
    "weighbridge_shared_impurity_members",
    "weighbridge_shared_impurity_source_batches",
  ];
  if (!complete(s, tables)) {
    answer.warnings.push(
      "Подтверждение общей примеси недоступно. Чистая масса не приравнивается к валовой.",
    );
    return;
  }
  const groups = rows(s, tables[0]).filter(
    (g) =>
      g.state === "finalized" &&
      rows(s, "tickets").some((t) => t.id === g.ticket_id && effective(t)),
  );
  const members = rows(s, tables[1]).filter(
    (m) =>
      m.crop_structure_id === sourceId &&
      groups.some((g) => g.id === m.group_id),
  );
  if (!members.length) {
    answer.warnings.push(
      "Нет оформленного распределения общей примеси по этому источнику. Полная чистая масса пока не подтверждена.",
    );
    return;
  }
  if (
    tables.some((t) => s.sources[t]?.schema !== "settlement_v2") ||
    members.some(
      (m) =>
        m.clean_balance_status !== "proportional" ||
        m.yield_status !== "proportional",
    )
  ) {
    answer.warnings.push(
      "Общая примесь оформлена по старому или неразрешённому контракту. Чистые остатки исходных партий не объединяются.",
    );
    return;
  }
  try {
    let gross = 0,
      clean = 0,
      impurity = 0;
    const seen = new Set<string>(),
      evidence: Evidence[] = [],
      ratios: number[] = [];
    for (const m of members) {
      const g = groups.find((g) => g.id === m.group_id)!;
      if (g.settlement_mode !== "proportional_members_v2") throw new Error();
      const sources = rows(s, tables[2]).filter(
        (b) =>
          b.member_id === m.id &&
          b.group_id === g.id &&
          b.crop_structure_id === sourceId,
      );
      if (!sources.length) throw new Error();
      for (const b of sources) {
        const batch = str(b, "inventory_batch_id");
        if (!batch || seen.has(batch) || !b.source_restore_ledger_entry_id)
          throw new Error();
        seen.add(batch);
      }
      const mg = grams(m.source_total_snapshot_kg),
        mi = grams(m.allocated_impurity_kg),
        mc = grams(m.clean_total_kg);
      if (
        mg <= 0 ||
        mi < 0 ||
        mc < 0 ||
        add(mi, mc) !== mg ||
        add(...sources.map((b) => grams(b.source_balance_snapshot_kg))) !==
          mg ||
        add(...sources.map((b) => grams(b.allocated_impurity_kg))) !== mi
      )
        throw new Error();
      gross = add(gross, mg);
      clean = add(clean, mc);
      impurity = add(impurity, mi);
      ratios.push(mi / mg);
      evidence.push(
        ev(tables[1], m, `${kg(mg)} − ${kg(mi)} = ${kg(mc)}`),
        ev(tables[0], g),
        ...sources.map((b) => ev(tables[2], b)),
      );
    }
    if (gross > received) throw new Error();
    return { clean, impurity, pending: received - gross, ratios, evidence };
  } catch {
    answer.warnings.push(
      "Распределение примеси не прошло сверку либо повторно охватывает одну партию. Чистую массу и её прогноз нельзя подтвердить.",
    );
    return;
  }
}

function stockAnswer(
  s: Snapshot,
  sourceId: string,
  received: number,
  receiptEvidence: Evidence[],
  answer: Answer,
): void {
  if (
    !complete(s, [
      "stock_ledger_entries",
      "inventory_batches",
      "harvest_lot_batches",
      "warehouses",
    ])
  ) {
    answer.warnings.push(
      "Складской остаток не подтверждён: чтение источников неполное.",
    );
    return;
  }
  const batches = rows(s, "inventory_batches"),
    byId = index(s, "inventory_batches");
  const direct = new Map<string, Set<string>>();
  for (const b of batches) {
    const ids = new Set<string>();
    if (str(b, "crop_structure_id")) ids.add(str(b, "crop_structure_id"));
    for (const l of rows(s, "harvest_lot_batches").filter(
      (l) => l.inventory_batch_id === b.id,
    ))
      if (str(l, "crop_structure_id")) ids.add(str(l, "crop_structure_id"));
    if (str(b, "source_ticket_id")) {
      const t = rows(s, "tickets").find((t) => t.id === b.source_ticket_id);
      const id = t && ticketSource(s, t);
      if (id) ids.add(id);
    }
    direct.set(str(b, "id"), ids);
  }
  function origins(id: string, visited = new Set<string>()): Set<string> {
    if (visited.has(id)) throw new Error("Цикл в происхождении партий.");
    visited.add(id);
    const b = byId.get(id);
    if (!b) return new Set();
    const ids = new Set(direct.get(id));
    if (str(b, "parent_batch_id"))
      origins(str(b, "parent_batch_id"), visited).forEach((x) => ids.add(x));
    return ids;
  }
  try {
    const poolIds = new Set(
      rows(s, "weighbridge_shared_impurity_groups").map((g) =>
        str(g, "pool_inventory_batch_id"),
      ),
    );
    const selected = new Set<string>();
    let ambiguous = false;
    for (const b of batches) {
      const ids = origins(str(b, "id"));
      if (ids.has(sourceId)) {
        if (ids.size !== 1 || poolIds.has(str(b, "id"))) ambiguous = true;
        else selected.add(str(b, "id"));
      }
    }
    if (ambiguous)
      throw new Error(
        "Есть объединённые или спорные складские партии. Полный остаток источника не подтверждён.",
      );
    const ledger = rows(s, "stock_ledger_entries").filter((l) =>
      selected.has(str(l, "inventory_batch_id") || str(l, "batch_id")),
    );
    const warehouses = index(s, "warehouses"),
      balances = new Map<string, { total: number; evidence: Evidence[] }>();
    let total = 0,
      receiptLedger = 0,
      other = 0;
    const categories = new Map<
      string,
      { total: number; evidence: Evidence[] }
    >();
    for (const entry of ledger) {
      if (!["kg", "кг"].includes(str(entry, "uom").toLowerCase()))
        throw new Error(
          "В складских движениях есть единицы, для которых не подтверждён перевод в массу.",
        );
      const delta = grams(entry.delta_qty_signed),
        evidence = ev("stock_ledger_entries", entry, kg(delta));
      const wid = str(entry, "warehouse_id");
      if (!warehouses.has(wid))
        throw new Error("Не разрешена связь движения со складом.");
      total = add(total, delta);
      if (str(entry, "reason_type").includes("harvest_incoming"))
        receiptLedger = add(receiptLedger, delta);
      else other = add(other, delta);
      const reason = str(entry, "reason_type");
      const category = reason.includes("harvest_incoming")
        ? "Поступления урожая"
        : reason.includes("impurit")
          ? "Примесь и её распределение"
          : reason.includes("transfer")
            ? "Перемещения между складами"
            : reason.includes("shipment") || reason.includes("issue")
              ? "Отгрузки и выдачи"
              : reason.includes("processing")
                ? "Переработка"
                : "Прочие движения";
      const subtotal = categories.get(category) || { total: 0, evidence: [] };
      subtotal.total = add(subtotal.total, delta);
      subtotal.evidence.push(evidence);
      categories.set(category, subtotal);
      const balance = balances.get(wid) || { total: 0, evidence: [] };
      balance.total = add(balance.total, delta);
      balance.evidence.push(evidence);
      balances.set(wid, balance);
    }
    // Preserve signed storno entries; filtering them or voided ticket IDs here corrupts stock.
    answer.metrics.push({
      label: "Физический остаток по связанным складским движениям",
      value: kg(total),
      kind: "calculation",
      evidence: ledger.map((l) => ev("stock_ledger_entries", l)),
      formula:
        "Σ delta_qty_signed всех связанных движений, включая сторно; технические pools исключены",
    });
    for (const [id, balance] of Array.from(balances.entries()))
      answer.metrics.push({
        label: `На складе: ${label(warehouses.get(id))}`,
        value: kg(balance.total),
        kind: "calculation",
        evidence: [ev("warehouses", warehouses.get(id)!), ...balance.evidence],
      });
    for (const [category, subtotal] of Array.from(categories.entries()))
      answer.metrics.push({
        label: `${category} — изменение остатка`,
        value: kg(subtotal.total),
        kind: "calculation",
        evidence: subtotal.evidence,
        formula:
          "Знаковый итог группы движений, включая исправляющие сторно; плюс — увеличение, минус — уменьшение.",
      });
    const gap = add(total, -received, -other);
    answer.metrics.push({
      label: "Разница между приходом весовой и приходом ledger",
      value: kg(gap),
      kind: "calculation",
      evidence: [
        ...receiptEvidence,
        ...ledger.map((l) => ev("stock_ledger_entries", l)),
      ],
      formula: `${kg(total)} остаток − ${kg(received)} весовой приход − (${kg(other)}) остальные знаковые движения; ledger приход ${kg(receiptLedger)}`,
    });
    if (gap || !selected.size)
      answer.warnings.push(
        "Полнота складской связи требует сверки; разница не исправляется автоматически.",
      );
    answer.warnings.push(
      "Физический остаток не равен доступному к отгрузке: резервы и незакрытые расходы здесь не вычитаются.",
    );
  } catch (e) {
    answer.warnings.push(
      e instanceof Error ? e.message : "Остаток не подтверждён.",
    );
  }
}

function operationalAnswer(
  s: Snapshot,
  answer: Answer,
  intent: Intent,
): Answer {
  answer.conclusion =
    intent === "traffic"
      ? "Текущее состояние ПТЦ по выбранной компании."
      : "Техника и зарегистрированный ремонт по выбранной компании.";
  const needed: SourceName[] = [
    "reference_vehicles",
    "fleet_vehicle_repairs",
    "ptc_vehicle_states",
  ];
  if (!complete(s, needed)) {
    answer.conclusion =
      "Оперативные источники недоступны. Состояние машин сейчас не подтверждено.";
    return answer;
  }
  const states = rows(s, "ptc_vehicle_states"),
    repairs = rows(s, "fleet_vehicle_repairs");
  const people = index(s, "company_people"),
    specialists = index(s, "reference_specialists");
  for (const vehicle of rows(s, "reference_vehicles").filter(
    (v) => v.archived !== true,
  )) {
    const state = states.find((r) => r.vehicle_id === vehicle.id),
      repair = repairs.find((r) => r.vehicle_id === vehicle.id);
    if (intent === "traffic" && !state) continue;
    const assigned = state?.assigned === true ? "на линии" : "вне линии";
    const cargo =
      (
        {
          empty: "пустая",
          loaded: "загружена",
          unloading: "на выгрузке",
        } as Record<string, string>
      )[str(state || {}, "state")] || "грузовой статус неизвестен";
    const specialist = specialists.get(
      str(vehicle, "primary_responsible_personnel_id"),
    );
    const person = people.get(str(specialist || {}, "person_id"));
    answer.metrics.push({
      label:
        `${str(vehicle, "custom_name") || label(vehicle)} ${str(vehicle, "license_plate") || str(vehicle, "plate_number")}`.trim(),
      value: `${state ? assigned : "линия неизвестна"}; ${cargo}; ${repair?.in_repair === true ? "в ремонте" : repair ? "ремонт не отмечен" : "ремонт неизвестен"}${person || specialist ? `; ответственный: ${label(person || specialist)}` : ""}`,
      kind: "fact",
      evidence: [
        ev("reference_vehicles", vehicle),
        ...(state ? [ev("ptc_vehicle_states", state)] : []),
        ...(repair ? [ev("fleet_vehicle_repairs", repair)] : []),
        ...(person
          ? [ev("company_people", person)]
          : specialist
            ? [ev("reference_specialists", specialist)]
            : []),
      ],
    });
  }
  for (const flow of rows(s, "ptc_flows"))
    answer.metrics.push({
      label: "Текущая уборка ПТЦ",
      value: `${flow.enabled ? "включена" : "выключена"}; поле: ${label(index(s, "fields").get(str(flow, "field_id")))}`,
      kind: "fact",
      evidence: [ev("ptc_flows", flow)],
    });
  for (const shift of rows(s, "ptc_combine_shifts").filter((r) => !r.closed_at))
    answer.metrics.push({
      label: `Открытая смена: ${str(shift, "operator_name")}`,
      value: `Поле: ${label(index(s, "fields").get(str(shift, "field_id")))}; с ${str(shift, "opened_at")}`,
      kind: "fact",
      evidence: [ev("ptc_combine_shifts", shift)],
    });
  for (const broken of rows(s, "ptc_combine_operator_statuses").filter(
    (r) => r.is_broken === true,
  ))
    answer.metrics.push({
      label: "Комбайнёр отметил поломку",
      value: label(people.get(str(broken, "operator_person_id"))),
      kind: "fact",
      evidence: [ev("ptc_combine_operator_statuses", broken)],
    });
  if (intent === "fleet") {
    const vehicleMachineIds = new Set(
      rows(s, "reference_vehicles").flatMap((v) => [
        str(v, "id"),
        str(v, "source_machine_id"),
      ]),
    );
    for (const machine of rows(s, "reference_machines").filter(
      (m) => m.archived !== true && !vehicleMachineIds.has(str(m, "id")),
    ))
      answer.metrics.push({
        label: label(machine),
        value: `Статус справочника: ${str(machine, "status") || "не указан"}; текущая работа не подтверждена`,
        kind: "fact",
        evidence: [ev("reference_machines", machine)],
      });
  }
  answer.warnings.push(
    "Состояние ПТЦ не является подтверждённым весовым рейсом. Время в состоянии само по себе не доказывает простой. Ответственный машины не подменяет водителя исторического талона.",
  );
  return answer;
}
