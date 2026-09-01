"use client";

import { cloneElement, useEffect, useState, type ReactElement } from "react";
import { isVisualSystemV2Enabled, type VisualSystemScope as VisualSystemScopeName } from "@/lib/ui/visual-system";

type ScopeChildProps = {
  className?: string;
  [key: string]: unknown;
};

type VisualSystemScopeProps = {
  scope: VisualSystemScopeName;
  reference?: "weather-mobile-dock";
  forceLegacy?: boolean;
  children: ReactElement<ScopeChildProps>;
};

export function VisualSystemScope({ scope, reference, forceLegacy = false, children }: VisualSystemScopeProps) {
  const enabled = !forceLegacy && isVisualSystemV2Enabled(scope);
  const [effects, setEffects] = useState<"full" | "reduced">("full");

  useEffect(() => {
    if (!enabled) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const transparency = window.matchMedia("(prefers-reduced-transparency: reduce)");
    const update = () => setEffects(motion.matches || transparency.matches ? "reduced" : "full");
    update();
    motion.addEventListener("change", update);
    transparency.addEventListener("change", update);
    return () => {
      motion.removeEventListener("change", update);
      transparency.removeEventListener("change", update);
    };
  }, [enabled]);

  return cloneElement(children, {
    "data-visual-system": enabled ? "v2" : "legacy",
    "data-visual-scope": scope,
    "data-effects": enabled ? effects : "reduced",
    ...(reference ? { "data-visual-reference": reference } : {}),
  });
}
