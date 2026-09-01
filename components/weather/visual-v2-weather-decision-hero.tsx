import { CloudRain, Navigation, Thermometer, Wind } from "lucide-react";
import { MatteSurface } from "@/components/ui/matte-surface";

type VisualV2WeatherDecisionHeroProps = {
  location: string;
  freshness: string;
  stale: boolean;
  decision: string;
  decisionDetail: string;
  temperature: string;
  wind: string;
  precipitation: string;
  profile: string;
};

export function VisualV2WeatherDecisionHero(props: VisualV2WeatherDecisionHeroProps) {
  return (
    <MatteSurface as="section" surface="chrome" aria-labelledby="weather-decision-title" className="tf-weather-decision-hero overflow-hidden p-4 sm:p-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)] lg:items-end">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--tf-accent-primary)]"><Navigation aria-hidden="true" className="h-4 w-4" />{props.location}</p>
          <p className="mt-2 text-xs text-[color:var(--tf-text-muted)]">{props.freshness}{props.stale ? " · показаны последние сохранённые данные" : ""}</p>
          <h2 id="weather-decision-title" className="mt-4 text-xl font-semibold tracking-tight sm:text-2xl">{props.decision}</h2>
          <p className="mt-1 text-sm text-[color:var(--tf-text-secondary)]">{props.decisionDetail}</p>
          <p className="mt-3 inline-flex min-h-10 items-center rounded-[var(--tf-radius-pill)] border border-[color:var(--tf-border-hairline)] bg-[var(--tf-surface-work)] px-3 text-xs text-[color:var(--tf-text-secondary)]">Профиль: <b className="ml-1 text-[color:var(--tf-text-primary)]">{props.profile}</b></p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="min-w-0 rounded-[var(--tf-radius-control)] border border-[color:var(--tf-border-hairline)] bg-[var(--tf-surface-work)] p-3"><Thermometer aria-hidden="true" className="h-4 w-4 text-[color:var(--tf-accent-primary)]" /><span className="mt-2 block text-xs text-[color:var(--tf-text-muted)]">Температура</span><b className="tf-tabular mt-0.5 block break-words text-base">{props.temperature}</b></div>
          <div className="min-w-0 rounded-[var(--tf-radius-control)] border border-[color:var(--tf-border-hairline)] bg-[var(--tf-surface-work)] p-3"><Wind aria-hidden="true" className="h-4 w-4 text-[color:var(--tf-accent-primary)]" /><span className="mt-2 block text-xs text-[color:var(--tf-text-muted)]">Ветер</span><b className="tf-tabular mt-0.5 block break-words text-base">{props.wind}</b></div>
          <div className="min-w-0 rounded-[var(--tf-radius-control)] border border-[color:var(--tf-border-hairline)] bg-[var(--tf-surface-work)] p-3"><CloudRain aria-hidden="true" className="h-4 w-4 text-[color:var(--tf-accent-primary)]" /><span className="mt-2 block text-xs text-[color:var(--tf-text-muted)]">Осадки</span><b className="tf-tabular mt-0.5 block break-words text-base">{props.precipitation}</b></div>
        </div>
      </div>
    </MatteSurface>
  );
}
