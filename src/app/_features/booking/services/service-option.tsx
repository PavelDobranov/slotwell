import { Checkbox } from "@/app/_components/checkbox";
import type { ServiceView } from "@/app/_features/booking/api";
import { formatPersistedPrice } from "@/app/_features/booking/persisted-details";
import { formatDuration } from "@/app/_lib/duration";

export function ServiceOption({
  service,
  selected,
  disabled,
  onToggle,
}: {
  service: ServiceView;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      htmlFor={`service-${service.id}`}
      data-checked={selected || undefined}
      className="flex min-h-17 cursor-pointer items-center gap-3.5 rounded-card border border-border bg-card px-4 py-3 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 data-checked:border-primary data-checked:bg-selected"
    >
      <Checkbox
        id={`service-${service.id}`}
        disabled={disabled}
        checked={selected}
        onCheckedChange={onToggle}
        className="size-6 rounded-sm border-2"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-base leading-[22px] font-semibold wrap-anywhere">
          {service.name}
        </span>
        <span className="text-sm text-muted-foreground tabular-nums">
          {formatDuration(service.durationMinutes)}
        </span>
      </span>
      <span className="shrink-0 text-base font-semibold tabular-nums">
        {formatPersistedPrice(service.priceCents, service.currency)}
      </span>
    </label>
  );
}
