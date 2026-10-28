"use client";
import { useEffect, useRef, useState } from "react";
import { SummarySectionTabs, type SelectedSummaryShift } from "./summary-section-tabs";
import { CombineWorkdayPanel } from "./combine-workday-panel";
import { DashboardTrafficPanel } from "./dashboard-traffic-panel";
import { WeighbridgeOperationalPanel } from "./weighbridge-operational-panel";
import { useSummaryResource } from "./use-summary-resource";
import type { SummarySection } from "@/lib/dashboard/summary-sections";
import type { SummaryPresence } from "@/lib/dashboard/operational-summary";
import { swipedSummarySection, type SummaryYield } from "@/lib/dashboard/summary-presentation";
import styles from "./operational-dashboard.module.css";
const NO_TABLES: string[] = [];
const YIELD_TABLES = ["tickets", "ticket_lines", "ptc_combine_shifts", "ptc_combine_field_segments", "crop_structure", "weighbridge_impurity_adjustments", "weighbridge_impurity_adjustment_reversals"];

export function OperationalDashboard({ scope, companyId }: { scope: string; companyId: string }) {
  const [section, setSection] = useState<SummarySection>("weighbridge");
  const [visited, setVisited] = useState<SummarySection[]>(["weighbridge"]);
  const [now, setNow] = useState(0);
  const [fieldId, setFieldId] = useState("");
  const [weighbridgeShift, setWeighbridgeShift] = useState<SelectedSummaryShift>();
  const [combineShift, setCombineShift] = useState<SelectedSummaryShift>();
  const touch = useRef<{ x: number; y: number; at: number } | null>(null);
  const yieldResource = useSummaryResource<SummaryYield>(scope, companyId,
    `/api/dashboard/harvest-summary?section=yield&companyId=${encodeURIComponent(companyId)}`, section !== "traffic", YIELD_TABLES, 30_000);
  const yieldProps = { data: yieldResource.data, error: yieldResource.error, fieldId, onFieldChange: setFieldId };
  const presence = useSummaryResource<SummaryPresence>(scope, companyId,
    `/api/dashboard/presence?companyId=${encodeURIComponent(companyId)}&shiftsOnly=true`, true, NO_TABLES, 15_000);
  const [presenceReceivedAt, setPresenceReceivedAt] = useState(0);
  useEffect(() => { setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 10_000); return () => clearInterval(timer); }, []);
  useEffect(() => { setPresenceReceivedAt(Date.now()); }, [presence.data]);
  const healthy = !!presence.data && !presence.error && now - presenceReceivedAt < 45_000;
  const select = (next: SummarySection) => { setSection(next); setVisited(previous => previous.includes(next) ? previous : [...previous, next]); };
  return <div className="mx-auto w-full max-w-[1500px] space-y-2 overflow-x-hidden">
    <SummarySectionTabs value={section} onChange={select} presence={presence.data} presenceHealthy={healthy}
      selectedShifts={{ weighbridge: section === "weighbridge" ? weighbridgeShift : undefined, combine: section === "combine" ? combineShift : undefined }} />
    <div className={styles.gesture} onTouchStart={event => {
      touch.current = null;
      if (event.touches.length !== 1 || (event.target as Element).closest("button,select,input,textarea,a,summary,[role=slider],[data-no-summary-swipe]")) return;
      const point = event.touches[0]; touch.current = { x: point.clientX, y: point.clientY, at: Date.now() };
    }} onTouchMove={event => {
      if (event.touches.length !== 1 || (touch.current && Math.abs(event.touches[0].clientY - touch.current.y) > 30)) touch.current = null;
    }} onTouchCancel={() => { touch.current = null; }} onTouchEnd={event => {
      const start = touch.current; touch.current = null;
      if (!start || event.changedTouches.length !== 1) return;
      const point = event.changedTouches[0];
      const next = swipedSummarySection(section, point.clientX - start.x, point.clientY - start.y, Date.now() - start.at);
      if (next !== section) select(next);
    }}>
    <div className={section === "weighbridge" ? styles.enter : undefined} id="summary-panel-weighbridge" role="tabpanel" tabIndex={0} aria-labelledby="summary-tab-weighbridge" hidden={section !== "weighbridge"}>
      <WeighbridgeOperationalPanel scope={scope} companyId={companyId} enabled={section === "weighbridge"} yieldProps={yieldProps} onShift={setWeighbridgeShift} />
    </div>
    <div className={section === "combine" ? styles.enter : undefined} id="summary-panel-combine" role="tabpanel" tabIndex={0} aria-labelledby="summary-tab-combine" hidden={section !== "combine"}>
      {visited.includes("combine") ? <CombineWorkdayPanel scope={scope} companyId={companyId} enabled={section === "combine"} yieldProps={yieldProps} onShift={setCombineShift} /> : null}
    </div>
    <div className={section === "traffic" ? styles.enter : undefined} id="summary-panel-traffic" role="tabpanel" tabIndex={0} aria-labelledby="summary-tab-traffic" hidden={section !== "traffic"}>
      {visited.includes("traffic") ? <DashboardTrafficPanel scope={scope} companyId={companyId} enabled={section === "traffic"} /> : null}
    </div>
    </div>
  </div>;
}
