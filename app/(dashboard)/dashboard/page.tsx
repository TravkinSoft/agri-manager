"use client";

import dynamic from "next/dynamic";
import { useAuth } from "@/lib/contexts/auth-context";
import { HarvestDashboard, HarvestDashboardSkeleton } from "@/components/dashboard/harvest-dashboard";

// Keep unrelated legacy tables and warehouse services out of the initial bundle.
const LegacyDashboard = dynamic(() => import("@/components/dashboard/legacy-dashboard"), {
  loading: () => <HarvestDashboardSkeleton />,
});

export default function DashboardPage() {
  const { profile, loading } = useAuth();
  if (loading) return <HarvestDashboardSkeleton />;
  if (["agronomist", "director", "accountant", "legal_operator", "company_admin", "global_admin"].includes(String(profile?.role || ""))) return <HarvestDashboard />;
  return <LegacyDashboard />;
}
