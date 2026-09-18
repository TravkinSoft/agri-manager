"use client";

type OpenTicketCardProps = {
  driverName: string;
  vehicleLabel: string;
  fieldLabel: string;
  weightLabel: string;
  outgoing: boolean;
  disabled: boolean;
  pending: boolean;
  onOpen: () => void;
};

export function OpenTicketCard({
  driverName, vehicleLabel, fieldLabel, weightLabel,
  outgoing, disabled, pending, onOpen,
}: OpenTicketCardProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-busy={pending || undefined}
      aria-label={`${outgoing ? "Вывоз. " : ""}${driverName}. ${vehicleLabel}. ${fieldLabel}. ${weightLabel}`}
      onClick={onOpen}
      className={`block w-full rounded-lg border border-l-4 px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none ${outgoing
        ? "border-orange-400/40 border-l-orange-400 bg-orange-500/20 enabled:hover:bg-orange-500/30"
        : "border-border/70 border-l-border bg-background/60 enabled:hover:bg-background"}`}
    >
      <span className="block break-words text-sm font-bold leading-5 text-foreground">{driverName}</span>
      <span className="mt-0.5 block truncate text-xs leading-4 text-muted-foreground" title={vehicleLabel}>{vehicleLabel}</span>
      <span className="mt-1.5 flex items-baseline justify-between gap-3 text-xs leading-4">
        <span className="min-w-0 truncate text-muted-foreground" title={fieldLabel}>{fieldLabel}</span>
        <span className="shrink-0 whitespace-nowrap font-bold tabular-nums text-foreground">{weightLabel}</span>
      </span>
    </button>
  );
}
