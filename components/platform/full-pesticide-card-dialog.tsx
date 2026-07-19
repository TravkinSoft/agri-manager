"use client";

import { AlertTriangle, BookOpen, ExternalLink, Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
};
const ROLE_LABELS: Record<string, string> = { active: "Действующее вещество", safener: "Антидот" };
const STATUS_LABELS: Record<string, string> = {
  active: "Действует",
  expired: "Завершена",
  suspended: "Приостановлена",
  cancelled: "Отменена",
  unknown: "Статус не подтверждён",
};
const SOURCE_LABELS: Record<string, string> = {
  official_label: "Официальная этикетка",
  official_registry: "Официальный реестр",
  manufacturer_site: "Сайт производителя",
  official_distributor: "Официальный дистрибьютор",
};
const CLAIM_LABELS: Record<string, string> = {
  identity: "Название и идентичность",
  manufacturer: "Производитель",
  formulation: "Препаративная форма",
  composition: "Состав",
  concentration: "Концентрация",
  registration: "Регистрация",
  usage_rule: "Правила применения",
  usage_rules: "Правила применения",
  restrictions: "Ограничения",
};
const MISSING_LABELS: Record<string, string> = {
  registration: "регистрация",
  current_registration: "действующая регистрация",
  working_fluid: "норма рабочей жидкости",
  max_treatments: "количество обработок",
  harvest_interval: "срок ожидания",
  reentry: "срок безопасного выхода",
  restrictions: "ограничения",
  manufacturer: "производитель",
  composition: "состав",
  concentration: "концентрация",
  formulation: "препаративная форма",
  usage_rules: "правила применения",
  sources: "источники",
};

function valueOrDash(value: unknown) {
  return value == null || value === "" ? "—" : String(value);
}

function dateLabel(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("ru-RU").format(date);
}

function Field({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="border-b border-[#d4dbe4] py-2 last:border-0">
      <div className="text-xs text-[#68788d]">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-[#17243a]">{valueOrDash(value)}</div>
    </div>
  );
}

function Empty({ children }: { children: string }) {
  return <div className="border border-dashed border-[#b7c2d0] bg-[#f6f8fb] px-4 py-5 text-sm text-[#536276]">{children}</div>;
}

export function FullPesticideCardDialog({
  open,
  onOpenChange,
  loading,
  error,
  card,
  onRetry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  error: string | null;
  card: FullPesticideCardData | null;
  onRetry: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto rounded-none border-[#8292a6] bg-white !text-[#111827]">
        <DialogHeader>
          <DialogTitle className="pr-8 text-xl text-[#16324f]">{card?.product.tradeName || "Полная карточка пестицида"}</DialogTitle>
          <DialogDescription className="text-[#536276]">
            {card ? [card.product.manufacturer, card.product.formulation].filter(Boolean).join(" · ") : "Подтверждённые данные GLBD"}
          </DialogDescription>
        </DialogHeader>

        {loading ? <div className="flex min-h-52 items-center justify-center gap-2 text-sm text-[#536276]"><Loader2 className="h-5 w-5 animate-spin" />Загружаю карточку...</div> : null}
        {!loading && error ? (
          <div className="border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
            <div>{error}</div>
            <Button type="button" variant="outline" size="sm" onClick={onRetry} className="mt-3 rounded-none"><RotateCcw className="mr-2 h-4 w-4" />Повторить</Button>
          </div>
        ) : null}

        {!loading && !error && card ? (
          <Tabs defaultValue="main" className="w-full">
            <TabsList className="h-auto w-full flex-wrap justify-start rounded-none border-b border-[#9aa8ba] bg-[#eef1f5] p-0">
              <TabsTrigger value="main" className="rounded-none">Основное</TabsTrigger>
              <TabsTrigger value="composition" className="rounded-none">Состав</TabsTrigger>
              <TabsTrigger value="registration" className="rounded-none">Регистрация</TabsTrigger>
              <TabsTrigger value="usage" className="rounded-none">Применение</TabsTrigger>
              <TabsTrigger value="sources" className="rounded-none">Источники</TabsTrigger>
              <TabsTrigger value="safety" className="rounded-none">Готовность для ассистента</TabsTrigger>
            </TabsList>

            <TabsContent value="main" className="mt-4">
              <div className="grid gap-x-8 md:grid-cols-2">
                <div><Field label="Официальное название" value={card.product.tradeName} /><Field label="Русское название" value={card.product.nameRu} /><Field label="Английское название" value={card.product.nameEn} /><Field label="Производитель" value={card.product.manufacturer} /></div>
                <div><Field label="Категория" value={CATEGORY_LABELS[card.product.category || ""] || card.product.category} /><Field label="Препаративная форма" value={card.product.formulation} /><Field label="Статус" value={card.product.active ? "Активна" : "Неактивна"} /></div>
              </div>
              <div className="mt-4"><div className="mb-2 text-sm font-semibold text-[#16324f]">Поисковые названия</div><div className="flex flex-wrap gap-2">{card.product.aliases.length ? card.product.aliases.map((alias) => <Badge key={alias} variant="secondary" className="rounded-none">{alias}</Badge>) : <span className="text-sm text-[#536276]">Дополнительных названий нет.</span>}</div></div>
            </TabsContent>

            <TabsContent value="composition" className="mt-4 space-y-3">
              {card.composition.length ? card.composition.map((row) => (
                <div key={row.id} className="grid gap-3 border-b border-[#c3ccd8] py-3 last:border-0 md:grid-cols-[minmax(0,1fr)_180px_180px]">
                  <div><div className="font-medium text-[#17243a]">{row.component?.name_ru || "Компонент"}</div><div className="text-xs text-[#68788d]">{row.component?.name_en || ""}</div></div>
                  <div><div className="text-xs text-[#68788d]">Роль</div><div className="text-sm">{ROLE_LABELS[row.role_in_product] || row.role_in_product}</div></div>
                  <div><div className="text-xs text-[#68788d]">Концентрация</div><div className="text-sm">{row.concentration_text || `${row.concentration_value} ${row.concentration_unit}`}{row.equivalent_basis ? ` (${row.equivalent_basis})` : ""}</div></div>
                </div>
              )) : <Empty>Подтверждённый состав отсутствует.</Empty>}
            </TabsContent>

            <TabsContent value="registration" className="mt-4 space-y-3">
              {card.registrations.length ? card.registrations.map((row) => (
                <div key={row.id} className="grid gap-3 border-b border-[#c3ccd8] py-3 last:border-0 md:grid-cols-4">
                  <Field label="Страна / номер" value={`${row.country_code} · ${row.registration_number}`} />
                  <Field label="Статус" value={STATUS_LABELS[row.registration_status] || row.registration_status} />
                  <Field label="Действует до" value={dateLabel(row.valid_until)} />
                  <Field label="Регистрант" value={row.registrant} />
                </div>
              )) : <Empty>Подтверждённая регистрация не добавлена.</Empty>}
            </TabsContent>

            <TabsContent value="usage" className="mt-4 space-y-4">
              {card.usageRules.length ? card.usageRules.map((row) => (
                <section key={row.id} className="border-b border-[#c3ccd8] pb-4 last:border-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2"><span className="font-semibold text-[#16324f]">{row.crop?.name_ru || "Культура"}</span><Badge variant="outline" className="rounded-none">{row.target?.name_ru || row.target_text}</Badge></div>
                  <div className="grid gap-x-6 md:grid-cols-3">
                    <Field label="Норма препарата" value={`${row.rate_min}${row.rate_max !== row.rate_min ? `–${row.rate_max}` : ""} ${row.rate_unit}`} />
                    <Field label="Рабочая жидкость" value={row.working_fluid_min == null ? null : `${row.working_fluid_min}${row.working_fluid_max !== row.working_fluid_min ? `–${row.working_fluid_max}` : ""} ${row.working_fluid_unit}`} />
                    <Field label="Способ" value={row.application_method} />
                    <Field label="Фаза / условие" value={[row.crop_stage, row.target_stage, row.timing_condition].filter(Boolean).join(" · ")} />
                    <Field label="Обработок / ожидание" value={[row.max_treatments && `${row.max_treatments} обработка`, row.harvest_interval_days != null && `${row.harvest_interval_days} дн.`].filter(Boolean).join(" · ")} />
                    <Field label="Ограничения" value={row.restrictions} />
                  </div>
                </section>
              )) : <Empty>Подтверждённые правила применения отсутствуют.</Empty>}
            </TabsContent>

            <TabsContent value="sources" className="mt-4 space-y-3">
              {card.sources.length ? card.sources.map((source) => (
                <article key={source.id} className="border-b border-[#c3ccd8] py-3 last:border-0">
                  <div className="flex items-start justify-between gap-3"><div><div className="font-medium text-[#17243a]">{source.source_title}</div><div className="mt-1 text-xs text-[#68788d]">Проверено {dateLabel(source.checked_on)}</div></div><Badge variant="outline" className="shrink-0 rounded-none">{SOURCE_LABELS[source.source_type] || source.source_type}</Badge></div>
                  <div className="my-2 flex flex-wrap gap-1.5">{source.claim_fields.map((field) => <span key={field} className="border border-[#c8d1dc] bg-[#f6f8fb] px-2 py-1 text-xs text-[#42566f]">{CLAIM_LABELS[field] || field}</span>)}</div>
                  <a href={source.source_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 text-sm font-medium text-[#174f84] hover:underline">Открыть источник<ExternalLink className="h-3.5 w-3.5" /></a>
                </article>
              )) : <Empty>Подтверждённые источники отсутствуют.</Empty>}
            </TabsContent>

            <TabsContent value="safety" className="mt-4">
              {card.safety ? (
                <div className={`border p-4 ${card.safety.read_allowed ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}>
                  <div className="flex items-center gap-2 font-semibold text-[#16324f]">{card.safety.read_allowed ? <ShieldCheck className="h-5 w-5 text-emerald-700" /> : <AlertTriangle className="h-5 w-5 text-amber-700" />}{card.safety.read_allowed ? "Подтверждённые данные можно читать" : "Карточка заблокирована для ассистента"}</div>
                  <div className="mt-2 text-sm text-[#42566f]">Агрономические рекомендации: <strong>{card.safety.recommendation_allowed ? "разрешены" : "запрещены"}</strong></div>
                  {card.safety.blocked_reason ? <div className="mt-2 text-sm text-[#6f4b00]">{card.safety.blocked_reason}</div> : null}
                  {card.safety.missing_critical_fields.length ? <div className="mt-3"><div className="mb-1 text-xs text-[#68788d]">Не хватает подтверждённых данных</div><div className="flex flex-wrap gap-1.5">{card.safety.missing_critical_fields.map((field) => <Badge key={field} variant="outline" className="rounded-none">{MISSING_LABELS[field] || field}</Badge>)}</div></div> : null}
                </div>
              ) : <Empty>Статус готовности ещё не рассчитан.</Empty>}
            </TabsContent>
          </Tabs>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
