"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

const FULL_LOGO = "/brand/v1/travkinflow-logo.png";
const SYMBOL = "/brand/v1/travkinflow-symbol.png";

export function TravkinLogo({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-[#b69a55]/45 bg-[#d8d5ce] shadow-[0_0_18px_rgba(224,177,0,0.12)]",
        compact ? "h-9 w-12 px-1" : "h-11 w-[208px] px-2 py-1",
        className
      )}
    >
      <Image
        src={compact ? SYMBOL : FULL_LOGO}
        alt="TravkinFlow"
        width={compact ? 740 : 1078}
        height={compact ? 309 : 227}
        className="max-h-full w-auto max-w-full object-contain"
        sizes={compact ? "48px" : "208px"}
        priority
      />
    </div>
  );
}

