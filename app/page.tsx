import Link from "next/link";
import {
  ClipboardList,
  Leaf,
  Map,
  Play,
  Scale,
  ShieldCheck,
  Warehouse,
} from "lucide-react";
import { TravkinLogo } from "@/components/layout/travkin-logo";

const features = [
  {
    title: "Поля",
    text: "Структура посевов, участки, площади, культуры и история сезона в одном контуре.",
    icon: Map,
  },
  {
    title: "Операции",
    text: "План, материалы, выдача, выполнение и факт без потери цепочки между агрономом, специалистом и складом.",
    icon: ClipboardList,
  },
  {
    title: "Весовая",
    text: "Талоны, поставки, урожай, партии и складские движения без ручного пересчёта.",
    icon: Scale,
  },
  {
    title: "Склады",
    text: "Остатки, партии, выдачи, возвраты и ledger, который показывает откуда пришёл каждый килограмм.",
    icon: Warehouse,
  },
];

const potatoFlow = [
  "Посадка",
  "Гребнеобразование",
  "Капельное",
  "Фертигация",
  "Уборка",
  "Хранение",
  "Партии",
];

function ProductLogo() {
  return <TravkinLogo />;
}

function ProductMockup() {
  return (
    <div className="mx-auto w-full max-w-6xl overflow-hidden rounded-[28px] border border-border bg-card shadow-2xl shadow-black/40">
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </div>
        <div className="hidden rounded-full border border-border bg-accent/40 px-4 py-1 text-xs text-foreground sm:block">
          TravkinFlow Demo / Season 2026
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="hidden border-r border-border bg-card p-4 lg:block">
          <ProductLogo />
          <div className="mt-8 space-y-2 text-sm">
            {["Структура посевов", "Операции", "Склады", "Весовая"].map((item, index) => (
              <div
                key={item}
                className={`rounded-xl px-3 py-2 ${index === 0 ? "bg-primary text-primary-foreground" : "text-foreground"}`}
              >
                {item}
              </div>
            ))}
          </div>
        </aside>

        <section className="p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.28em] text-emerald-800">Crop structure</div>
              <h3 className="mt-1 text-2xl font-black text-foreground">Поля и операции сезона</h3>
            </div>
            <div className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-800">
              Demo Farm
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[
              ["Поле 1", "321 га", "Овёс / Люцерна / Горох", "7 участков"],
              ["Поле 12", "329 га", "Пшеница", "3 операции"],
              ["Картофель 52-1", "84 га", "Gala / Элита", "Капельное"],
              ["Поле 28", "124 га", "Морковь / Каскад F1", "Фертигация"],
              ["Овощной склад", "18 400 кг", "Партии и остатки", "Ledger OK"],
              ["Весовая", "3 талона", "Урожай и поставки", "Сегодня"],
            ].map(([title, metric, subtitle, badge]) => (
              <div key={title} className="min-h-[132px] rounded-2xl border border-border bg-accent/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="text-lg font-black text-amber-800">{title}</div>
                  <div className="rounded-lg bg-muted px-2 py-1 text-xs font-semibold text-foreground">{metric}</div>
                </div>
                <div className="mt-4 text-sm font-semibold text-foreground">{subtitle}</div>
                <div className="mt-2 inline-flex rounded-full border border-border px-2.5 py-1 text-xs text-foreground">{badge}</div>
              </div>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen bg-card text-foreground">
      <nav className="sticky top-0 z-20 border-b border-border bg-card/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <ProductLogo />
          <div className="hidden items-center gap-2 md:flex">
            <Link href="/auth/login" className="rounded-xl px-4 py-2 text-sm font-semibold text-foreground hover:bg-accent/40">
              Войти
            </Link>
            <Link href="/auth/register" className="rounded-xl px-4 py-2 text-sm font-semibold text-foreground hover:bg-accent/40">
              Создать компанию
            </Link>
            <Link href="/demo" className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary">
              Демо
            </Link>
            <div className="ml-3 flex rounded-xl border border-border p-1 text-xs font-bold text-foreground">
              <span className="rounded-lg bg-primary px-2 py-1 text-primary-foreground">RU</span>
              <span className="px-2 py-1">EN</span>
              <span className="px-2 py-1">KZ</span>
            </div>
          </div>
          <Link href="/demo" className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground md:hidden">
            Демо
          </Link>
        </div>
      </nav>

      <section className="relative overflow-hidden px-4 pb-16 pt-14 sm:px-6 lg:px-8">
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, rgba(250,204,21,0.22), transparent 28%), radial-gradient(circle at 80% 10%, rgba(16,185,129,0.18), transparent 30%), linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
            backgroundSize: "auto, auto, 44px 44px, 44px 44px",
          }}
        />
        <div className="relative mx-auto max-w-7xl">
          <div className="mx-auto max-w-4xl text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-800">
              <ShieldCheck className="h-4 w-4" />
              ERP для хозяйства, построенная вокруг реальных операций
            </div>
            <h1 className="mt-7 text-4xl font-black tracking-tight text-foreground sm:text-6xl lg:text-7xl">
              AgriOS for modern farming operations
            </h1>
            <p className="mx-auto mt-6 max-w-3xl text-lg leading-8 text-foreground sm:text-xl">
              Поля. Операции. Склады. Весовая. Одна система для всего хозяйства.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/auth/login" className="inline-flex h-12 items-center justify-center rounded-xl border border-border px-6 font-bold text-foreground hover:bg-accent/40">
                Войти
              </Link>
              <Link href="/auth/register" className="inline-flex h-12 items-center justify-center rounded-xl border border-border px-6 font-bold text-foreground hover:bg-accent/40">
                Создать компанию
              </Link>
              <Link href="/demo" className="inline-flex h-12 items-center justify-center rounded-xl bg-primary px-6 font-black text-primary-foreground hover:bg-primary">
                <Play className="mr-2 h-4 w-4" />
                Посмотреть демо
              </Link>
            </div>
          </div>

          <div className="mt-12">
            <ProductMockup />
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-card px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <div className="text-sm font-bold uppercase tracking-[0.28em] text-amber-800">Capabilities</div>
              <h2 className="mt-3 text-3xl font-black text-foreground sm:text-4xl">Всё, что двигает хозяйство</h2>
            </div>
            <p className="max-w-xl text-sm leading-6 text-muted-foreground">
              TravkinFlow связывает агрономию, склад, весовую и исполнение в одну производственную цепочку.
            </p>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {features.map(({ title, text, icon: Icon }) => (
              <div key={title} className="rounded-2xl border border-border bg-accent/40 p-5">
                <Icon className="h-6 w-6 text-amber-800" />
                <h3 className="mt-5 text-lg font-black text-foreground">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-yellow-400/30 bg-yellow-400/10 px-4 py-2 text-sm font-bold text-amber-800">
              <Leaf className="h-4 w-4" />
              Картофельный контур
            </div>
            <h2 className="mt-5 text-3xl font-black text-foreground sm:text-4xl">Картофель как отдельный производственный сценарий</h2>
            <p className="mt-5 text-base leading-7 text-muted-foreground">
              Посадка, гребни, капельное, фертигация, уборка, хранение и партии связаны в одну понятную цепочку.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {potatoFlow.map((step, index) => (
              <div key={step} className="flex items-center gap-3 rounded-2xl border border-border bg-accent/40 p-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-sm font-black text-primary-foreground">
                  {index + 1}
                </div>
                <div className="font-bold text-foreground">{step}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-4 border-t border-border pt-8 text-sm text-muted-foreground md:flex-row">
          <ProductLogo />
          <div className="flex flex-wrap gap-4">
            <Link href="/auth/login" className="hover:text-foreground">Войти</Link>
            <Link href="/auth/register" className="hover:text-foreground">Создать компанию</Link>
            <Link href="/demo" className="hover:text-foreground">Демо</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
