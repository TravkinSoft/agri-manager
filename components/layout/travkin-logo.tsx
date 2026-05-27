"use client";

import { cn } from "@/lib/utils";

export function TravkinLogo({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative flex h-9 w-9 items-center justify-center rounded-md border border-[#3a2d06] bg-[#141821] shadow-[0_0_0_1px_rgba(224,177,0,0.15)]">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-5 w-5 text-[#E0B100]"
          fill="currentColor"
        >
          <path d="M12 2.5c-1.9 1.4-3.1 3.1-3.7 4.9.8-.2 1.8-.6 2.6-1.3-.2 1.2-.9 2.5-2.2 3.7-.5.5-1.1.9-1.7 1.2.8.1 2-.1 3-.7-.4 1.2-1.3 2.3-2.7 3.1-.6.3-1.2.6-1.8.7.8.3 2.2.3 3.5-.2-.7 1.2-2 2.1-3.9 2.7 1 .4 2.6.5 4.1 0v3.2a.8.8 0 0 0 1.6 0V2.5Z" />
          <path d="M14.6 5.5c1.4 1.1 2.4 2.4 3 4 .2.7.4 1.5.4 2.3-1-.5-2-1.3-2.8-2.3.1 1.2.7 2.5 1.9 3.7.3.3.6.5.9.8-.8.2-1.8.2-2.9-.1.5 1 1.4 1.9 2.8 2.6-.9.3-2.2.3-3.4-.1l.1-10.9Z" opacity=".85" />
        </svg>
      </div>

      {!compact ? (
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold tracking-wide text-[#F3F4F6]">
            TRAVKINFLOW
          </div>
          <div className="truncate text-[10px] text-[#9CA3AF]">
            Created by farmers for farmers
          </div>
        </div>
      ) : null}
    </div>
  );
}

