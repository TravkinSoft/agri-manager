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
    <div className="mb-4 flex flex-col gap-3 border-b border-border pb-4 sm:mb-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="tf-manor-heading text-3xl sm:text-4xl">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-[color:var(--manor-text-muted)] sm:text-sm">{description}</p>
        )}
      </div>
      {children ||
        (action && (
          <Button
            onClick={action.onClick}
            className="tf-manor-control h-11 w-full bg-primary text-primary-foreground shadow-manor-sm hover:bg-primary/90 sm:h-10 sm:w-auto"
          >
            {ActionIcon && <ActionIcon className="mr-2 h-4 w-4" />}
            {action.label}
          </Button>
        ))}
    </div>
  );
}
