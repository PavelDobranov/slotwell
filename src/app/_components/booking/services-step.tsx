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
import type { Service } from "@/app/_lib/booking/types";

export function ServicesStep({
  services,
  serviceIds,
  noSpecialist,
  onServices,
  onNext,
  showPrimaryAction = true,
}: {
  showPrimaryAction?: boolean;
  services: readonly Service[];
  serviceIds: readonly string[];
  noSpecialist: boolean;
  onServices: (ids: string[]) => void;
  onNext: () => void;
}) {
  const [attempts, setAttempts] = useState(0);
  const group = useRef<HTMLFieldSetElement>(null);
  const invalid = attempts > 0 && serviceIds.length === 0;
  useEffect(() => {
    if (invalid && attempts > 0) group.current?.focus();
  }, [invalid, attempts]);

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
        Може да изберете няколко. Правят се последователно, в едно посещение, от
        един специалист.
      </FieldDescription>
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
      {showPrimaryAction && (
        <>
          <Separator />
          <div className="flex justify-end">
            <Button type="submit">Продължи</Button>
          </div>
        </>
      )}
    </form>
  );
}
