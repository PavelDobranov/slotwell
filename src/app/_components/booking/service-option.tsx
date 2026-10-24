import { Checkbox } from "@/app/_components/checkbox";
import { euros } from "@/app/_lib/booking/format";
import type { Service } from "@/app/_lib/booking/types";

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
      className="flex min-h-16 cursor-pointer items-center gap-3 rounded-lg border border-border bg-background p-3.5 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 data-checked:border-primary data-checked:bg-muted data-checked:shadow-[inset_0_0_0_1px_var(--primary)] sm:gap-3.5 sm:p-4"
    >
      <Checkbox
        id={`service-${service.id}`}
        nativeButton
        render={<button type="button" />}
        checked={selected}
        onCheckedChange={onSelect}
        className="size-5 sm:size-4.5"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-medium">{service.name}</span>
        <span className="text-[13px] text-muted-foreground tabular-nums">
          {service.durationMinutes} мин
        </span>
      </span>
      <span className="shrink-0 text-[15px] font-medium tabular-nums">
        {euros.format(service.priceCents / 100)}
      </span>
    </label>
  );
}
