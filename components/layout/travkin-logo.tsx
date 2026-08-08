"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

const SYMBOL = "/brand/v1/travkinflow-symbol-006f2efc.png";

export function TravkinLogo({
  compact = false,
  size = "default",
  className,
}: {
  compact?: boolean;
  size?: "default" | "mobile" | "large";
  className?: string;
}) {
  const isLarge = !compact && size === "large";
  const isMobile = !compact && size === "mobile";

  return (
    <div
      role="img"
      aria-label="TravkinFlow"
      className={cn(
        "inline-flex shrink-0 items-center justify-center bg-transparent",
        compact
          ? "h-10 w-14"
          : isLarge
            ? "h-14 w-[270px] gap-2"
            : isMobile
              ? "h-9 w-[166px] gap-1"
              : "h-10 w-[180px] gap-1",
        className
      )}
    >
      <span
        className={cn(
          "relative block shrink-0",
          compact
            ? "h-9 w-14"
            : isLarge
              ? "h-14 w-[100px]"
              : isMobile
                ? "h-8 w-[62px]"
                : "h-9 w-[68px]"
        )}
      >
        <Image
          src={SYMBOL}
          alt=""
          aria-hidden="true"
          fill
          className="object-contain"
          sizes={compact ? "56px" : isLarge ? "100px" : isMobile ? "62px" : "68px"}
          priority
        />
      </span>

      {!compact ? (
        <span
          aria-hidden="true"
          className={cn(
            "flex min-w-0 items-baseline whitespace-nowrap font-semibold leading-none",
            isLarge ? "text-[32px]" : isMobile ? "text-[20px]" : "text-[22px]"
          )}
        >
          <span className="text-[#F3F4F6]">Travkin</span>
          <span className="text-[#E0B100]">Flow</span>
        </span>
      ) : null}
    </div>
  );
}

