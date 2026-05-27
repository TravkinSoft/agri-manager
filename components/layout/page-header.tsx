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
    <div className="mb-6 flex items-center justify-between">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-[#F3F4F6]">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-[#9CA3AF]">{description}</p>
        )}
      </div>
      {children || (action && (
        <Button onClick={action.onClick} className="bg-[#E0B100] text-[#111827] hover:bg-[#C89F00]">
          {ActionIcon && <ActionIcon className="mr-2 h-4 w-4" />}
          {action.label}
        </Button>
      ))}
    </div>
  );
}
