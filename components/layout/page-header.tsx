import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";
import { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: {
    label: string;
    icon?: LucideIcon;
    onClick?: () => void;
  };
  children?: ReactNode;
}

export function PageHeader({ title, description, action, children }: PageHeaderProps) {
  const ActionIcon = action?.icon;

  return (
    <div className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-[#F3F4F6] sm:text-3xl">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-[#9CA3AF] sm:text-sm">{description}</p>
        )}
      </div>
      {children ||
        (action && (
          <Button
            onClick={action.onClick}
            className="h-11 w-full bg-[#E0B100] text-[#111827] hover:bg-[#C89F00] sm:h-10 sm:w-auto"
          >
            {ActionIcon && <ActionIcon className="mr-2 h-4 w-4" />}
            {action.label}
          </Button>
        ))}
    </div>
  );
}
