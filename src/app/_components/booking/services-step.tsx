import { CircleAlertIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/app/_components/alert";
import { ServiceOption } from "@/app/_components/booking/service-option";
import { Button } from "@/app/_components/button";
import {
  FieldDescription,
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

  // Keep the picker in category order as the catalog lists it (first appearance wins).
  const categories = [...new Set(services.map((service) => service.category))];

  return (
    <form
      id="booking-services"
      noValidate
      className="flex min-w-0 flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        setAttempts((count) => count + 1);
        if (serviceIds.length > 0) onNext();
      }}
    >
      <FieldDescription
        id="services-description"
        className="text-base leading-6"
      >
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
        className="min-w-0 gap-5 rounded-lg focus:outline-2 focus:outline-offset-4 focus:outline-ring"
      >
        <FieldLegend className="sr-only">Услуги</FieldLegend>
        {invalid && (
          <Alert
            id="services-error"
            variant="error"
            aria-atomic="true"
            className="rounded-card px-4 py-3"
          >
            <CircleAlertIcon aria-hidden="true" />
            <AlertTitle>Изберете поне една услуга</AlertTitle>
            <AlertDescription>
              Така ще ви покажем подходящите специалисти и свободни часове.
            </AlertDescription>
          </Alert>
        )}
        {categories.map((category) => (
          <fieldset key={category} className="flex min-w-0 flex-col gap-2.5">
            <legend className="mb-3 text-[13px] leading-[18px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
              {category}
            </legend>
            <FieldGroup className="gap-2.5">
              {services
                .filter((service) => service.category === category)
                .map((service) => (
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
          </fieldset>
        ))}
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
