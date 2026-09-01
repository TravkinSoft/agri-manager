import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type MatteSurfaceElement = "article" | "aside" | "div" | "section";
type MatteSurfaceVariant = "chrome" | "input" | "overlay" | "work" | "work-raised";

const SURFACE_CLASS: Record<MatteSurfaceVariant, string> = {
  chrome: "tf-glass-chrome",
  input: "tf-input-surface",
  overlay: "tf-glass-overlay",
  work: "tf-work-surface",
  "work-raised": "tf-work-surface-raised",
};

type MatteSurfaceProps = HTMLAttributes<HTMLElement> & {
  as?: MatteSurfaceElement;
  surface?: MatteSurfaceVariant;
};

export function MatteSurface({ as: Component = "div", className, surface = "work", ...props }: MatteSurfaceProps) {
  return <Component data-matte-surface={surface} className={cn(SURFACE_CLASS[surface], className)} {...props} />;
}
