import { Checkbox } from "@/app/_components/checkbox";
import { formatServicePrice } from "@/app/_features/demo-booking/format";
import type { Service } from "@/app/_lib/booking/types";
import { formatDuration } from "@/app/_lib/duration";

export function ServiceOption({
  service,
  selected,
  onSelect,
}: {
  service: Service;
  selected: boolean;
  onSelect: (selected: boolean) => void;
}) {
  return (
    <label
      htmlFor={`service-${service.id}`}
      data-checked={selected || undefined}
      className="flex min-h-17 cursor-pointer items-center gap-3.5 rounded-card border border-border bg-card px-4 py-3 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 data-checked:border-primary data-checked:bg-selected data-checked:shadow-[inset_0_0_0_1px_var(--primary)]"
    >
      <Checkbox
        id={`service-${service.id}`}
        nativeButton
        render={<button type="button" />}
        checked={selected}
        onCheckedChange={onSelect}
        className="size-6 rounded-sm border-2"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-base leading-[22px] font-semibold wrap-anywhere">
          {service.name}
        </span>
        <span className="text-[14px] leading-5 text-muted-foreground tabular-nums">
          {formatDuration(service.durationMinutes)}
          {service.priceCents === null &&
            " · цената зависи от дължината на косата"}
        </span>
      </span>
      <span
        data-variable={service.priceCents === null || undefined}
        className="shrink-0 text-base leading-[22px] font-semibold tabular-nums data-variable:font-medium data-variable:text-muted-foreground"
      >
        {formatServicePrice(service.priceCents, true)}
      </span>
    </label>
  );
}
