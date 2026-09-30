"use client";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/contexts/auth-context";
import { OperatorPresenceSignal } from "./operator-presence-signal";

export function OperatorHeartbeat() {
  const { profile } = useAuth();
  const pathname = usePathname();
  const enabled = !profile?.is_impersonating && profile?.status === "active" && (
    (profile?.role === "weighman" && pathname === "/weighbridge") ||
    (profile?.role === "mechanic_operator" && pathname === "/traffic-operator")
  );
  return <OperatorPresenceSignal enabled={enabled} identityKey={`${profile?.id || ""}:${profile?.company_id || ""}`} />;
}
