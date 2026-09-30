"use client";

import Link from "next/link";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PesticideCardLinkProps = {
  productId?: string | null;
  className?: string;
  label?: string;
};

export function PesticideCardLink({
  productId,
  className,
  label = "Открыть карточку препарата",
}: PesticideCardLinkProps) {
  if (!productId) return null;

  return (
    <Button
      asChild
      type="button"
      variant="ghost"
      size="icon"
      className={cn("h-8 w-8 shrink-0", className)}
      title={label}
    >
      <Link
        href={`/references?pesticide=${encodeURIComponent(productId)}`}
        target="_blank"
        rel="noreferrer"
        aria-label={label}
      >
        <BookOpen className="h-4 w-4" />
      </Link>
    </Button>
  );
}
