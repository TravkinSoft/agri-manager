"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  ClipboardList,
  Lock,
  Map,
  Scale,
  ShieldCheck,
  Sprout,
  Warehouse,
} from "lucide-react";

type DemoModule = "fields" | "operations" | "warehouses" | "weighbridge" | "copilot";

const modules: Array<{ id: DemoModule; label: string; icon: typeof Map }> = [
  { id: "fields", label: "Поля", icon: Map },
  { id: "operations", label: "Операции", icon: ClipboardList },
  { id: "warehouses", label: "Склады", icon: Warehouse },
  { id: "weighbridge", label: "Весовая", icon: Scale },
  { id: "copilot", label: "Copilot", icon: Bot },
];

const fieldCards = [
  { name: "Поле 1", area: "321 га", crops: ["Овёс 186 га", "Люцерна 100 га", "Горох 10 га", "+ ещё 4"] },
  { name: "Поле 28", area: "124 га", crops: ["Морковь / Каскад F1", "Фертигация", "СЗР: план"] },
  { name: "Картофель 52-1", area: "84 га", crops: ["Gala / Элита", "Капельное", "Посадка: закрыта"] },
  { name: "Поле 12", area: "329 га", crops: ["Пшеница", "Гербицидная обработка", "Уборка: план"] },
];

const operations = [
  { title: "Посадка картофеля", field: "Картофель 52-1", status: "В работе", material: "Семенной картофель, Диаммофоска" },
  { title: "Фунгицидная обработка", field: "Поле 28", status: "Материалы готовы", material: "Ревус Топ, PH Power" },
  { title: "Культивация", field: "Поле 1", status: "Запланирована", material: "Без материалов" },
  { title: "Уборка пшеницы", field: "Поле 12", status: "План", material: "Связь с весовой" },
];

const warehouseRows = [
  ["Овощной склад", "Картофель Gala", "18 400 кг", "3 партии"],
  ["Семенной склад", "Семенной картофель", "42 000 кг", "2 партии"],
  ["Универсальный склад", "Ammonium Nitrate", "31 700 кг", "ledger OK"],
  ["Склад СЗР", "Ревус Топ", "1 260 л", "партия REV-26"],
];

const tickets = [
  ["WB-2026-000031", "Поставка от KazAgro Trade", "Agriful Anti-salt, Ammonium Nitrate", "Закрыт"],
  ["WB-2026-000032", "Урожай с поля 12", "Пшеница 28 600 кг", "Закрыт"],
  ["WB-2026-000033", "Внутреннее перемещение", "Семенной картофель 12 000 кг", "Активный"],
];

function DemoLogo() {
  return (
    <Link href="/" className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-yellow-400/35 bg-yellow-400/10 text-yellow-300">
        <Sprout className="h-5 w-5" />
      </div>
      <div>
        <div className="text-sm font-black tracking-wide text-white">TRAVKINFLOW</div>
        <div className="text-[11px] text-slate-400">Demo Farm</div>
      </div>
    </Link>
  );
}

function ReadOnlyButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled
      className="inline-flex h-9 cursor-not-allowed items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] px-3 text-xs font-bold text-slate-500"
      title="Демо-режим: действие отключено"
    >
      <Lock className="mr-1.5 h-3.5 w-3.5" />
      {children}
    </button>
  );
}

function FieldsDemo() {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {fieldCards.map((field) => (
          <div key={field.name} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="text-xl font-black text-yellow-300">{field.name}</div>
              <div className="rounded-lg bg-slate-800 px-2 py-1 text-xs font-bold text-slate-100">{field.area}</div>
            </div>
            <div className="mt-4 space-y-2">
              {field.crops.map((crop) => (
                <div key={crop} className="rounded-lg bg-slate-950/35 px-3 py-2 text-sm text-slate-200">{crop}</div>
              ))}
            </div>
            <div className="mt-4">
              <ReadOnlyButton>Запланировать</ReadOnlyButton>
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-100">
        В демо показаны структура, культуры и участки. Редактор структуры отключён.
      </div>
    </div>
  );
}

function OperationsDemo() {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {operations.map((operation) => (
        <div key={`${operation.title}-${operation.field}`} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-lg font-black text-white">{operation.title}</div>
              <div className="mt-1 text-sm font-semibold text-yellow-300">{operation.field}</div>
            </div>
            <div className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-bold text-emerald-200">
              {operation.status}
            </div>
          </div>
          <div className="mt-4 rounded-xl bg-slate-950/35 p-3 text-sm text-slate-300">
            Материалы: {operation.material}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <ReadOnlyButton>Принять</ReadOnlyButton>
            <ReadOnlyButton>Выдать материалы</ReadOnlyButton>
            <ReadOnlyButton>Закрыть факт</ReadOnlyButton>
          </div>
        </div>
      ))}
    </div>
  );
}

function WarehousesDemo() {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10">
      <div className="grid grid-cols-4 bg-slate-950/60 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-400">
        <div>Склад</div>
        <div>Товар</div>
        <div>Остаток</div>
        <div>Партии</div>
      </div>
      {warehouseRows.map((row) => (
        <div key={`${row[0]}-${row[1]}`} className="grid grid-cols-4 border-t border-white/10 px-4 py-4 text-sm text-slate-200">
          {row.map((cell, index) => (
            <div key={cell} className={index === 0 ? "font-bold text-white" : ""}>{cell}</div>
          ))}
        </div>
      ))}
      <div className="border-t border-white/10 p-4">
        <ReadOnlyButton>Новая складская операция</ReadOnlyButton>
      </div>
    </div>
  );
}

function WeighbridgeDemo() {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm uppercase tracking-[0.22em] text-slate-400">Операторский терминал</div>
            <div className="mt-2 text-3xl font-black text-white">12 400 кг</div>
          </div>
          <div className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-bold text-emerald-200">
            Смена открыта
          </div>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {["Поставка от контрагента", "Урожай с поля", "Внутреннее перемещение", "Отгрузка"].map((type) => (
            <div key={type} className="rounded-xl border border-white/10 bg-slate-950/35 p-4 font-bold text-slate-100">
              {type}
            </div>
          ))}
        </div>
        <div className="mt-5">
          <ReadOnlyButton>Создать талон</ReadOnlyButton>
        </div>
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
        <div className="font-black text-white">История талонов</div>
        <div className="mt-4 space-y-3">
          {tickets.map(([id, direction, goods, status]) => (
            <div key={id} className="rounded-xl bg-slate-950/35 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="font-bold text-yellow-300">{id}</div>
                <div className="text-xs text-emerald-200">{status}</div>
              </div>
              <div className="mt-2 text-sm text-white">{direction}</div>
              <div className="mt-1 text-xs text-slate-400">{goods}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CopilotDemo() {
  const answer = useMemo(
    () => [
      "Короткий вывод: по демо-хозяйству активны 4 операции.",
      "Факты: картофель 84 га, поле 28 требует фертигацию, склад СЗР держит Ревус Топ 1 260 л.",
      "Следующий шаг: проверить готовность материалов по фунгицидной обработке.",
    ],
    []
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
        <div className="font-black text-white">Примеры вопросов</div>
        <div className="mt-4 space-y-3">
          {["Что по картофелю?", "Какие операции стоят?", "Сколько осталось обработать?", "Какие материалы заканчиваются?"].map((prompt) => (
            <div key={prompt} className="rounded-xl bg-slate-950/35 p-3 text-sm text-slate-200">{prompt}</div>
          ))}
        </div>
      </div>
      <div className="rounded-2xl border border-yellow-400/20 bg-yellow-400/10 p-5">
        <div className="flex items-center gap-2 font-black text-yellow-100">
          <Bot className="h-5 w-5" />
          Copilot response
        </div>
        <div className="mt-4 space-y-3">
          {answer.map((line) => (
            <div key={line} className="rounded-xl bg-slate-950/45 p-3 text-sm leading-6 text-slate-100">{line}</div>
          ))}
        </div>
        <div className="mt-5">
          <ReadOnlyButton>Отправить вопрос</ReadOnlyButton>
        </div>
      </div>
    </div>
  );
}

function ModuleContent({ active }: { active: DemoModule }) {
  if (active === "fields") return <FieldsDemo />;
  if (active === "operations") return <OperationsDemo />;
  if (active === "warehouses") return <WarehousesDemo />;
  if (active === "weighbridge") return <WeighbridgeDemo />;
  return <CopilotDemo />;
}

export default function DemoPage() {
  const [active, setActive] = useState<DemoModule>("fields");
  const activeModule = modules.find((item) => item.id === active) || modules[0];
  const ActiveIcon = activeModule.icon;

  return (
    <main className="min-h-screen bg-[#090d12] text-white">
      <header className="border-b border-white/10 bg-[#0b1017]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <DemoLogo />
          <div className="flex items-center gap-2">
            <Link href="/" className="hidden rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-white/10 sm:inline-flex">
              <ArrowLeft className="mr-2 h-4 w-4" />
              На главную
            </Link>
            <Link href="/auth/login" className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-white/10">
              Войти
            </Link>
            <Link href="/auth/register" className="rounded-xl bg-yellow-400 px-4 py-2 text-sm font-black text-slate-950 hover:bg-yellow-300">
              Создать компанию
            </Link>
            <div className="hidden rounded-xl border border-white/10 p-1 text-xs font-bold text-slate-300 md:flex">
              <span className="rounded-lg bg-yellow-400 px-2 py-1 text-slate-950">RU</span>
              <span className="px-2 py-1">EN</span>
              <span className="px-2 py-1">KZ</span>
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-5 flex flex-col justify-between gap-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 md:flex-row md:items-center">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-300" />
            <div>
              <div className="font-black text-emerald-100">TravkinFlow Demo работает только на просмотр</div>
              <div className="mt-1 text-sm text-emerald-100/75">
                Создание, удаление, редактирование, выдача, закрытие талонов и изменение операций отключены.
              </div>
            </div>
          </div>
          <div className="rounded-full border border-white/10 bg-slate-950/30 px-3 py-1 text-xs font-bold text-emerald-100">
            Без логина и без доступа к чужой компании
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="rounded-2xl border border-white/10 bg-[#0d141d] p-3">
            <div className="px-3 py-2 text-xs font-bold uppercase tracking-[0.22em] text-slate-500">Demo modules</div>
            <div className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-1">
              {modules.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActive(id)}
                  className={`flex h-11 items-center rounded-xl px-3 text-left text-sm font-bold transition ${
                    active === id ? "bg-yellow-400 text-slate-950" : "text-slate-300 hover:bg-white/10"
                  }`}
                >
                  <Icon className="mr-2 h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>
          </aside>

          <section className="min-w-0 rounded-2xl border border-white/10 bg-[#101720] p-4 sm:p-5">
            <div className="mb-5 flex flex-col justify-between gap-3 border-b border-white/10 pb-5 md:flex-row md:items-center">
              <div>
                <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.22em] text-yellow-300">
                  <ActiveIcon className="h-4 w-4" />
                  {activeModule.label}
                </div>
                <h1 className="mt-2 text-2xl font-black text-white sm:text-3xl">TravkinFlow Demo Farm</h1>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                {[
                  ["98", "полей"],
                  ["20 477", "га"],
                  ["7", "складов"],
                ].map(([value, label]) => (
                  <div key={label} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                    <div className="text-base font-black text-white">{value}</div>
                    <div className="text-slate-500">{label}</div>
                  </div>
                ))}
              </div>
            </div>

            <ModuleContent active={active} />
          </section>
        </div>
      </section>
    </main>
  );
}
