import { CircleAlertIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ServiceOption } from "@/app/_components/booking/service-option";
import { Button } from "@/app/_components/button";
import {
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldSet,
} from "@/app/_components/field";
import { Separator } from "@/app/_components/separator";
import { ToggleGroup, ToggleGroupItem } from "@/app/_components/toggle-group";
import { serviceTotals } from "@/app/_lib/booking/fixtures";
import { euros } from "@/app/_lib/booking/format";
import type { BookingPath } from "@/app/_lib/booking/state";
import type { Service } from "@/app/_lib/booking/types";

export function ServicesStep({
  services,
  serviceIds,
  path,
  noSpecialist,
  onServices,
  onPath,
  onNext,
  showPrimaryAction = true,
}: {
  showPrimaryAction?: boolean;
  services: readonly Service[];
  serviceIds: readonly string[];
  path: BookingPath;
  noSpecialist: boolean;
  onServices: (ids: string[]) => void;
  onPath: (path: BookingPath) => void;
  onNext: () => void;
}) {
  const [attempts, setAttempts] = useState(0);
  const group = useRef<HTMLFieldSetElement>(null);
  const invalid = attempts > 0 && serviceIds.length === 0;
  useEffect(() => {
    if (invalid && attempts > 0) group.current?.focus();
  }, [invalid, attempts]);
  const totals = serviceTotals(
    services.filter(({ id }) => serviceIds.includes(id)),
  );

  return (
    <form
      id="booking-services"
      noValidate
      className="flex min-w-0 flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        setAttempts((count) => count + 1);
        if (serviceIds.length > 0) onNext();
      }}
    >
      <FieldDescription id="services-description">
        Избери една или повече услуги. Всички се изпълняват от един специалист в
        едно посещение.
      </FieldDescription>
      <ToggleGroup
        variant="segmented"
        aria-label="Как предпочиташ да избереш?"
        value={[path]}
        onValueChange={([value]) => {
          if (value === "staff-first" || value === "time-first") onPath(value);
        }}
        className="max-w-full flex-wrap"
      >
        <ToggleGroupItem value="staff-first">Първо специалист</ToggleGroupItem>
        <ToggleGroupItem value="time-first">Първо дата и час</ToggleGroupItem>
      </ToggleGroup>
      <FieldSet
        ref={group}
        tabIndex={-1}
        aria-invalid={invalid || undefined}
        aria-describedby={
          invalid
            ? "services-error services-description"
            : "services-description"
        }
        data-invalid={invalid || undefined}
        className="min-w-0 gap-2 rounded-lg focus:outline-2 focus:outline-offset-4 focus:outline-ring"
      >
        <FieldLegend>Услуги</FieldLegend>
        <FieldGroup className="gap-2">
          {services.map((service) => (
            <ServiceOption
              key={service.id}
              service={service}
              selected={serviceIds.includes(service.id)}
              onSelect={(selected) => {
                setAttempts(0);
                onServices(
                  selected
                    ? [...serviceIds, service.id]
                    : serviceIds.filter((id) => id !== service.id),
                );
              }}
            />
          ))}
        </FieldGroup>
        {invalid && (
          <FieldError id="services-error" className="flex items-center gap-1.5">
            <CircleAlertIcon aria-hidden="true" className="size-4 shrink-0" />
            Избери поне една услуга, за да продължиш.
          </FieldError>
        )}
      </FieldSet>
      {noSpecialist && (
        <output>
          Няма специалист за тази комбинация от услуги. Промени избора си.
        </output>
      )}
      <Separator />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p data-testid="services-total" className="text-sm tabular-nums">
          {serviceIds.length} {serviceIds.length === 1 ? "услуга" : "услуги"} ·{" "}
          {totals.durationMinutes} мин ·{" "}
          <strong className="font-semibold">
            {euros.format(totals.priceCents / 100)}
          </strong>
        </p>
        {showPrimaryAction && <Button type="submit">Продължи</Button>}
      </div>
    </form>
  );
}
