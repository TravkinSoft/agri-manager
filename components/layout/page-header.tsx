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
        <h1 className="text-3xl font-bold text-slate-900">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        )}
      </div>
      {children || (action && (
        <Button onClick={action.onClick}>
          {ActionIcon && <ActionIcon className="mr-2 h-4 w-4" />}
          {action.label}
        </Button>
      ))}
    </div>
  );
}
