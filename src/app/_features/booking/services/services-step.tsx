"use client";

import { TriangleAlertIcon } from "lucide-react";

import { Alert, AlertTitle } from "@/app/_components/alert";
import { Button } from "@/app/_components/button";
import { Skeleton } from "@/app/_components/skeleton";
import type { ServiceView } from "@/app/_features/booking/api";
import { useBooking } from "@/app/_features/booking/context";
import { ServiceOption } from "@/app/_features/booking/services/service-option";

/** Services grouped by category, keeping the server's first-seen order. */
function byCategory(services: ServiceView[]): [string, ServiceView[]][] {
  const groups = new Map<string, ServiceView[]>();
  for (const service of services) {
    const group = groups.get(service.category);
    if (group) group.push(service);
    else groups.set(service.category, [service]);
  }
  return [...groups];
}

export function ServicesStep() {
  const { state, dispatch, catalog, draftLocked } = useBooking();

  return (
    <section aria-labelledby="services-heading" className="flex flex-col gap-4">
      <h2 id="services-heading" className="text-xl font-semibold">
        Изберете услуги
      </h2>
      {catalog.isPending ? (
        <output className="flex flex-col gap-3" aria-busy="true">
          <span className="sr-only">Зареждаме услугите…</span>
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-17 w-full rounded-card" />
          ))}
        </output>
      ) : catalog.data?.services.length === 0 ? (
        <Alert variant="warning">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>Няма налични услуги в момента</AlertTitle>
        </Alert>
      ) : (
        catalog.data &&
        byCategory(catalog.data.services).map(([category, services]) => (
          <fieldset key={category} className="flex min-w-0 flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-muted-foreground">
              {category}
            </legend>
            {services.map((service) => {
              const selected = state.serviceIds.includes(service.id);
              return (
                <ServiceOption
                  key={service.id}
                  service={service}
                  selected={selected}
                  disabled={draftLocked}
                  onToggle={() =>
                    dispatch({
                      type: "services",
                      ids: selected
                        ? state.serviceIds.filter((id) => id !== service.id)
                        : [...state.serviceIds, service.id],
                    })
                  }
                />
              );
            })}
          </fieldset>
        ))
      )}
      <Button
        className="self-end"
        disabled={state.serviceIds.length === 0}
        onClick={() => dispatch({ type: "next" })}
      >
        Продължи към избор на специалист
      </Button>
    </section>
  );
}
