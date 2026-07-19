"use client";

import type { ReactNode } from "react";
import {
  AlertTriangle,
  Beaker,
  BookOpen,
  ExternalLink,
  FileCheck2,
  Leaf,
  Loader2,
  Pencil,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { localizeUnit } from "@/lib/i18n/helpers";

export type FullPesticideCardData = {
  product: {
    id: string;
    tradeName: string;
    nameRu: string | null;
    nameEn: string | null;
    manufacturer: string | null;
    formulation: string | null;
    category: string | null;
    subcategory: string | null;
    active: boolean;
    aliases: string[];
  };
  composition: Array<{
    id: string;
    role_in_product: string;
    concentration_value: number | null;
    concentration_unit: string | null;
    concentration_text: string | null;
    equivalent_basis: string | null;
    component: { name_ru: string; name_en: string | null; component_type: string } | null;
  }>;
  registrations: Array<{
    id: string;
    country_code: string;
    registration_number: string;
    registration_status: string;
    valid_from: string | null;
    valid_until: string | null;
    registrant: string | null;
  }>;
  usageRules: Array<Record<string, any>>;
  sources: Array<{
    id: string;
    source_type: string;
    source_url: string;
    source_title: string;
    claim_fields: string[];
    checked_on: string;
    confidence: number | null;
    verification_status: string;
  }>;
  safety: {
    read_allowed: boolean;
    recommendation_allowed: boolean;
    missing_critical_fields: string[];
    blocked_reason: string | null;
    verified_at: string | null;
  } | null;
};

const CATEGORY_LABELS: Record<string, string> = {
  herbicide: "Гербицид",
  fungicide: "Фунгицид",
  insecticide: "Инсектицид",
  seed_treatment: "Протравитель",
  acaricide: "Акарицид",
  desiccant: "Десикант",
};
const STATUS_LABELS: Record<string, string> = {
  active: "Действует",
  expired: "Срок действия завершён",
  suspended: "Приостановлена",
  cancelled: "Отменена",
  unknown: "Статус не подтверждён",
};
const COUNTRY_LABELS: Record<string, string> = {
  KZ: "Казахстан",
  RU: "Россия",
  BY: "Беларусь",
  KG: "Кыргызстан",
  UZ: "Узбекистан",
};
const SOURCE_LABELS: Record<string, string> = {
  official_label: "Официальная инструкция или этикетка",
  official_registry: "Государственный реестр",
  manufacturer_site: "Сайт производителя",
  official_distributor: "Официальный дистрибьютор",
  distributor_catalog: "Каталог дистрибьютора",
  zeldom: "Zeldom (дополнительный источник)",
};
const VERIFICATION_LABELS: Record<string, string> = {
  verified: "Проверен",
  approved: "Подтверждён",
  expired: "Исторический источник",
  pending: "Ожидает проверки",
  rejected: "Отклонён",
};
const CLAIM_LABELS: Record<string, string> = {
  identity: "название и идентичность",
  manufacturer: "производитель",
  formulation: "препаративная форма",
  composition: "состав",
  concentration: "концентрация",
  registration: "регистрация",
  usage_rule: "применение",
  usage_rules: "применение",
  restrictions: "ограничения",
};
const MISSING_LABELS: Record<string, string> = {
  registration: "регистрация",
  current_registration: "действующая регистрация",
  working_fluid: "расход рабочего раствора",
  max_treatments: "количество обработок",
  harvest_interval: "срок ожидания",
  reentry: "срок выхода людей",
  restrictions: "ограничения",
  manufacturer: "производитель",
  composition: "состав",
  concentration: "концентрация",
  formulation: "препаративная форма",
  usage_rules: "правила применения",
  sources: "источники",
};

type CompositionGroup = "active" | "safener" | "biological" | "other";

const COMPOSITION_GROUP_LABELS: Record<CompositionGroup, string> = {
  active: "Действующие вещества",
  safener: "Антидот",
  biological: "Биологические компоненты",
  other: "Другие подтверждённые компоненты",
};

function hasValue(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function dateLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat("ru-RU").format(date);
}

function numberLabel(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value || "");
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(number);
}

function unitLabel(value: unknown): string {
  return localizeUnit(value, "ru") || String(value || "");
}

function rangeLabel(min: unknown, max: unknown, unit: unknown): string | null {
  if (!hasValue(min)) return null;
  const minText = numberLabel(min);
  const maxText = hasValue(max) && Number(max) !== Number(min) ? `–${numberLabel(max)}` : "";
  const localizedUnit = unitLabel(unit);
  return `${minText}${maxText}${localizedUnit ? ` ${localizedUnit}` : ""}`;
}

function concentrationLabel(row: FullPesticideCardData["composition"][number]): string | null {
  if (hasValue(row.concentration_value)) {
    return `${numberLabel(row.concentration_value)} ${unitLabel(row.concentration_unit)}`.trim();
  }
  if (!row.concentration_text) return null;
  return row.concentration_text
    .replace(/g\s*\/\s*l/gi, "г/л")
    .replace(/g\s*\/\s*kg/gi, "г/кг")
    .replace(/mg\s*\/\s*l/gi, "мг/л")
    .replace(/kg\s*\/\s*l/gi, "кг/л");
}

function compositionGroup(row: FullPesticideCardData["composition"][number]): CompositionGroup {
  const role = String(row.role_in_product || "").toLowerCase();
  const type = String(row.component?.component_type || "").toLowerCase();
  if (role === "safener" || type === "safener") return "safener";
  if (role.includes("biological") || type.includes("biological")) return "biological";
  if (role === "active" || type === "active_ingredient") return "active";
  return "other";
}

function textList(values: unknown[]): string | null {
  const parts = values.map((value) => String(value || "").trim()).filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

function treatmentLabel(value: unknown): string | null {
  if (!hasValue(value)) return null;
  const count = Number(value);
  if (!Number.isFinite(count)) return String(value);
  const remainder10 = count % 10;
  const remainder100 = count % 100;
  const noun = remainder10 === 1 && remainder100 !== 11 ? "обработка" : remainder10 >= 2 && remainder10 <= 4 && (remainder100 < 12 || remainder100 > 14) ? "обработки" : "обработок";
  return `${numberLabel(count)} ${noun}`;
}

function dayLabel(value: unknown): string | null {
  if (!hasValue(value)) return null;
  return `${numberLabel(value)} дн.`;
}

function hourLabel(value: unknown): string | null {
  if (!hasValue(value)) return null;
  return `${numberLabel(value)} ч`;
}

function confidenceLabel(value: number | null): string | null {
  if (!hasValue(value)) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return `${Math.round(number <= 1 ? number * 100 : number)}%`;
}

function SectionHeading({ icon, title, description }: { icon: ReactNode; title: string; description?: string }) {
  return (
    <div className="mb-3 flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center border border-[#b8c3d0] bg-[#f4f6f8] text-[#174f84]">{icon}</div>
      <div>
        <h3 className="text-base font-semibold text-[#17243a]">{title}</h3>
        {description ? <p className="mt-0.5 text-sm text-[#617086]">{description}</p> : null}
      </div>
    </div>
  );
}

function Empty({ children }: { children: string }) {
  return <div className="border border-dashed border-[#b7c2d0] bg-[#f6f8fb] px-4 py-4 text-sm text-[#536276]">{children}</div>;
}

function Detail({ label, value, strong = false }: { label: string; value: ReactNode; strong?: boolean }) {
  if (!hasValue(value)) return null;
  return (
    <div className="min-w-0">
      <div className="text-xs text-[#68788d]">{label}</div>
      <div className={`mt-0.5 text-sm text-[#17243a] ${strong ? "font-semibold" : "font-medium"}`}>{value}</div>
    </div>
  );
}

function productRussianName(card: FullPesticideCardData): string | null {
  const name = String(card.product.nameRu || "").trim();
  if (!name || name.localeCompare(card.product.tradeName, "ru", { sensitivity: "base" }) === 0) return null;
  return name;
}

export function FullPesticideCardDialog({
  open,
  onOpenChange,
  loading,
  error,
  card,
  onRetry,
  adminMode = false,
  onEdit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  error: string | null;
  card: FullPesticideCardData | null;
  onRetry: () => void;
  adminMode?: boolean;
  onEdit?: () => void;
}) {
  const registration = card?.registrations.find((row) => row.registration_status === "active") || card?.registrations[0] || null;
  const russianName = card ? productRussianName(card) : null;
  const missingFields = card?.safety?.missing_critical_fields || [];
  const missingLabels = missingFields.map((field) => MISSING_LABELS[field] || field.replaceAll("_", " "));
  const readiness = !card?.safety || !card.safety.read_allowed
    ? { label: "Недостаточно данных", tone: "rose" as const }
    : card.safety.recommendation_allowed
      ? { label: "Данные подтверждены", tone: "emerald" as const }
      : { label: "Карточка заполнена частично", tone: "amber" as const };
  const compositionGroups = card
    ? (["active", "safener", "biological", "other"] as CompositionGroup[])
        .map((key) => ({ key, rows: card.composition.filter((row) => compositionGroup(row) === key) }))
        .filter((group) => group.rows.length)
    : [];
  const restrictions = card?.usageRules.filter((row) =>
    hasValue(row.max_treatments)
    || hasValue(row.harvest_interval_days)
    || hasValue(row.reentry_hours)
    || hasValue(row.restrictions)
  ) || [];

  const readinessClass = readiness.tone === "emerald"
    ? "border-emerald-300 bg-emerald-50 text-emerald-900"
    : readiness.tone === "amber"
      ? "border-amber-300 bg-amber-50 text-amber-950"
      : "border-rose-300 bg-rose-50 text-rose-900";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-1rem)] max-w-5xl overflow-y-auto border-[#8292a6] bg-white p-0 !text-[#111827] sm:w-full">
        <div className="border-b border-[#c5ced9] bg-[#f4f6f8] px-4 py-4 sm:px-6 sm:py-5">
          <DialogHeader className="text-left">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap gap-2">
                  {card?.product.category ? <Badge variant="outline" className="rounded-sm border-[#8fa0b4] bg-white text-[#27435f]">{CATEGORY_LABELS[card.product.category] || card.product.category}</Badge> : null}
                  {card ? <Badge variant="outline" className={`rounded-sm ${card.product.active ? "border-emerald-400 bg-emerald-50 text-emerald-800" : "border-slate-400 bg-slate-100 text-slate-700"}`}>{card.product.active ? "Активна" : "Неактивна"}</Badge> : null}
                  {card ? <Badge variant="outline" className={`rounded-sm ${readinessClass}`}>{readiness.label}</Badge> : null}
                </div>
                <DialogTitle className="pr-8 text-2xl text-[#16324f] sm:text-3xl">{card?.product.tradeName || "Полная карточка пестицида"}</DialogTitle>
                <DialogDescription className="mt-1 text-sm text-[#536276]">
                  {card ? russianName || "Агрономическая карточка препарата" : "Агрономическая карточка препарата"}
                </DialogDescription>
              </div>
              {adminMode && onEdit && card ? (
                <Button type="button" variant="outline" size="sm" onClick={onEdit} className="w-full shrink-0 rounded-sm border-[#8fa0b4] bg-white text-[#16324f] sm:w-auto">
                  <Pencil className="mr-2 h-4 w-4" />Редактировать
                </Button>
              ) : null}
            </div>
          </DialogHeader>

          {card ? (
            <div className="mt-4 grid gap-3 border-t border-[#d4dbe4] pt-4 sm:grid-cols-2 lg:grid-cols-4">
              <Detail label="Производитель" value={card.product.manufacturer} strong />
              <Detail label="Препаративная форма" value={card.product.formulation} />
              <Detail label="Регистрация" value={registration ? STATUS_LABELS[registration.registration_status] || registration.registration_status : null} />
              <Detail label="Действует до" value={dateLabel(registration?.valid_until)} />
            </div>
          ) : null}
          {card?.product.aliases.length ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[#617086]">
              <span>Другие названия:</span>
              {card.product.aliases.map((alias) => <span key={alias} className="border border-[#c8d1dc] bg-white px-2 py-1 text-[#42566f]">{alias}</span>)}
            </div>
          ) : null}
        </div>

        <div className="px-4 py-5 sm:px-6 sm:py-6">
          {loading ? <div className="flex min-h-52 items-center justify-center gap-2 text-sm text-[#536276]"><Loader2 className="h-5 w-5 animate-spin" />Загружаю карточку...</div> : null}
          {!loading && error ? (
            <div className="border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
              <div>{error}</div>
              <Button type="button" variant="outline" size="sm" onClick={onRetry} className="mt-3 rounded-sm"><RotateCcw className="mr-2 h-4 w-4" />Повторить</Button>
            </div>
          ) : null}

          {!loading && !error && card ? (
            <div className="space-y-8">
              <section aria-labelledby="pesticide-composition">
                <SectionHeading icon={<Beaker className="h-4 w-4" />} title="Состав" description="Компоненты и подтверждённые концентрации" />
                {compositionGroups.length ? (
                  <div className="space-y-5">
                    {compositionGroups.map((group) => (
                      <div key={group.key}>
                        <h4 id={group.key === "active" ? "pesticide-composition" : undefined} className="mb-2 text-sm font-semibold text-[#42566f]">{COMPOSITION_GROUP_LABELS[group.key]}</h4>
                        <div className="divide-y divide-[#d4dbe4] border-y border-[#d4dbe4]">
                          {group.rows.map((row) => (
                            <div key={row.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                              <div className="font-medium text-[#17243a]">{row.component?.name_ru || row.component?.name_en || "Компонент"}</div>
                              {concentrationLabel(row) ? <div className="shrink-0 text-sm font-semibold text-[#174f84]">{concentrationLabel(row)}</div> : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <Empty>Подтверждённый состав пока отсутствует.</Empty>}
              </section>

              <section aria-labelledby="pesticide-usage">
                <SectionHeading icon={<Leaf className="h-4 w-4" />} title="Применение" description="Подтверждённые правила для конкретных культур и объектов" />
                {card.usageRules.length ? (
                  <div className="space-y-3">
                    {card.usageRules.map((row) => {
                      const rate = rangeLabel(row.rate_min, row.rate_max, row.rate_unit);
                      const workingFluid = rangeLabel(row.working_fluid_min, row.working_fluid_max, row.working_fluid_unit);
                      const timing = textList([row.crop_stage, row.target_stage, row.timing_condition]);
                      const ruleRestrictions = textList([
                        treatmentLabel(row.max_treatments),
                        hasValue(row.harvest_interval_days) ? `срок ожидания ${dayLabel(row.harvest_interval_days)}` : null,
                        row.restrictions,
                      ]);
                      return (
                        <article key={row.id} className="rounded-md border border-[#bac5d2] bg-white p-4 shadow-sm">
                          <div className="flex flex-col gap-2 border-b border-[#d4dbe4] pb-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <div className="text-base font-semibold text-[#16324f]">{row.crop?.name_ru || "Культура не указана"}</div>
                              {row.target?.name_ru || row.target_text ? <div className="mt-1 text-sm text-[#536276]">{row.target?.name_ru || row.target_text}</div> : null}
                            </div>
                            {row.target_type ? <Badge variant="outline" className="w-fit rounded-sm border-[#b7c2d0] bg-[#f6f8fb] text-[#536276]">Вредный объект</Badge> : null}
                          </div>
                          <div className="mt-4 grid gap-4 sm:grid-cols-2">
                            <div className="border-l-4 border-[#d6a800] bg-[#fffbea] px-3 py-2">
                              <Detail label="Норма препарата" value={rate} strong />
                            </div>
                            {workingFluid ? (
                              <div className="border-l-4 border-[#2d789f] bg-[#f0f7fb] px-3 py-2">
                                <Detail label="Расход рабочего раствора" value={workingFluid} strong />
                              </div>
                            ) : null}
                          </div>
                          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            <Detail label="Способ обработки" value={row.application_method} />
                            <Detail label="Фаза или срок применения" value={timing} />
                            <Detail label="Количество обработок и ожидание" value={ruleRestrictions} />
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : <Empty>Подтверждённые правила применения пока отсутствуют.</Empty>}
              </section>

              <section aria-labelledby="pesticide-registration">
                <SectionHeading icon={<FileCheck2 className="h-4 w-4" />} title="Регистрация" />
                {card.registrations.length ? (
                  <div className="divide-y divide-[#d4dbe4] border-y border-[#d4dbe4]">
                    {card.registrations.map((row) => (
                      <div key={row.id} className="grid gap-3 py-3 sm:grid-cols-2 lg:grid-cols-5">
                        <Detail label="Страна" value={COUNTRY_LABELS[row.country_code] || row.country_code} strong />
                        <Detail label="Регистрационный номер" value={row.registration_number} />
                        <Detail label="Статус" value={STATUS_LABELS[row.registration_status] || row.registration_status} />
                        <Detail label="Действует до" value={dateLabel(row.valid_until)} />
                        <Detail label="Регистрант" value={row.registrant} />
                      </div>
                    ))}
                  </div>
                ) : <Empty>Подтверждённая регистрация пока не добавлена.</Empty>}
              </section>

              {restrictions.length ? (
                <section aria-labelledby="pesticide-restrictions">
                  <SectionHeading icon={<AlertTriangle className="h-4 w-4" />} title="Ограничения" description="Только подтверждённые условия для конкретного правила применения" />
                  <div className="divide-y divide-[#d4dbe4] border-y border-[#d4dbe4]">
                    {restrictions.map((row) => (
                      <div key={`restriction-${row.id}`} className="py-3">
                        <div className="mb-3 text-sm font-semibold text-[#16324f]">{textList([row.crop?.name_ru, row.target?.name_ru || row.target_text])}</div>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                          <Detail label="Количество обработок" value={treatmentLabel(row.max_treatments)} />
                          <Detail label="Срок ожидания" value={dayLabel(row.harvest_interval_days)} />
                          <Detail label="Выход людей" value={hourLabel(row.reentry_hours)} />
                          <Detail label="Другие ограничения" value={row.restrictions} />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              <section aria-labelledby="pesticide-sources">
                <Accordion type="single" collapsible className="border-y border-[#b7c2d0]">
                  <AccordionItem value="sources" className="border-0">
                    <AccordionTrigger id="pesticide-sources" className="px-1 text-left text-base font-semibold text-[#17243a] hover:no-underline">
                      <span className="flex items-center gap-3"><BookOpen className="h-4 w-4 text-[#174f84]" />Источники ({card.sources.length})</span>
                    </AccordionTrigger>
                    <AccordionContent className="px-1">
                      {card.sources.length ? (
                        <div className="divide-y divide-[#d4dbe4]">
                          {card.sources.map((source) => (
                            <article key={source.id} className="py-4 first:pt-0">
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                  <div className="font-medium text-[#17243a]">{source.source_title}</div>
                                  <div className="mt-1 text-xs text-[#68788d]">{SOURCE_LABELS[source.source_type] || source.source_type}{dateLabel(source.checked_on) ? ` · проверено ${dateLabel(source.checked_on)}` : ""}</div>
                                </div>
                                <a href={source.source_url} target="_blank" rel="noreferrer noopener" className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-[#174f84] hover:underline">
                                  Открыть источник<ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              </div>
                              {adminMode ? (
                                <div className="mt-3 border-l-2 border-[#9aa8ba] pl-3 text-xs text-[#536276]">
                                  <div>Подтверждает: {source.claim_fields.map((field) => CLAIM_LABELS[field] || field).join(", ") || "не указано"}</div>
                                  <div className="mt-1">Уверенность: {confidenceLabel(source.confidence) || "не указана"} · {VERIFICATION_LABELS[source.verification_status] || source.verification_status}</div>
                                </div>
                              ) : null}
                            </article>
                          ))}
                        </div>
                      ) : <Empty>Подтверждённые источники пока отсутствуют.</Empty>}
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </section>

              <section className={`rounded-md border p-4 ${readinessClass}`} aria-label="Статус полноты данных">
                <div className="flex items-start gap-3">
                  {readiness.tone === "emerald" ? <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />}
                  <div className="min-w-0">
                    <div className="font-semibold">{readiness.label}</div>
                    <p className="mt-1 text-sm">
                      {card.safety?.recommendation_allowed
                        ? "Рекомендации доступны."
                        : missingLabels.length
                          ? `Рекомендации пока недоступны: не подтверждены ${missingLabels.join(", ")}.`
                          : "Рекомендации пока недоступны: недостаточно подтверждённых данных."}
                    </p>
                    {card.safety?.blocked_reason ? <p className="mt-2 text-sm">{card.safety.blocked_reason}</p> : null}
                    {adminMode ? (
                      <div className="mt-3 border-t border-current/20 pt-3 text-xs">
                        <div className="font-semibold">Проверка данных</div>
                        {dateLabel(card.safety?.verified_at) ? <div className="mt-1">Последняя проверка: {dateLabel(card.safety?.verified_at)}</div> : null}
                        {missingLabels.length ? <div className="mt-1">Требует подтверждения: {missingLabels.join(", ")}</div> : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
