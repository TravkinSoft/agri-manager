"use client";

import { WeatherLab } from "@/components/weather/weather-lab";
import { useAuth } from "@/lib/contexts/auth-context";

export default function WeatherLabPage() {
  const { profile, loading } = useAuth();
  if (loading) return <div className="h-40 animate-pulse rounded-lg bg-card" />;
  if (profile?.role !== "global_admin" && profile?.role !== "agronomist") {
    return <div className="rounded-lg border border-red-900/60 bg-red-50 p-5 text-sm text-red-800">Доступ только для Global Admin и агронома.</div>;
  }
  return <WeatherLab showTechnicalDebug={profile?.role === "global_admin"} />;
}
