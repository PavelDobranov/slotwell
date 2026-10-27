"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, TriangleAlertIcon } from "lucide-react";
import { useEffect, useReducer } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/app/_components/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/app/_components/avatar";
import { Button } from "@/app/_components/button";
import { Checkbox } from "@/app/_components/checkbox";
import { RadioGroup, RadioGroupItem } from "@/app/_components/radio-group";
import { Skeleton } from "@/app/_components/skeleton";
import {
  CatalogApiError,
  fetchCatalog,
  fetchQualifiedStaff,
  type ServiceView,
} from "@/app/_lib/booking/api";
import { formatDuration, formatServicePrice } from "@/app/_lib/booking/format";
import {
  initialPersistedState,
  persistedReducer,
} from "@/app/_lib/booking/persisted-state";

function loadErrorMessage(error: unknown): string {
  if (error instanceof CatalogApiError && error.code === "network")
    return "Няма връзка със сървъра. Провери връзката си и опитай отново.";
  return "Нещо се обърка при зареждането. Опитай отново.";
}

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

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part.charAt(0))
    .join("");
}

export function PersistedBooking() {
  const [state, dispatch] = useReducer(persistedReducer, initialPersistedState);

  const catalog = useQuery({
    queryKey: ["catalog"],
    queryFn: ({ signal }) => fetchCatalog(signal),
  });

  const staff = useQuery({
    queryKey: ["qualified-staff", state.serviceIds],
    queryFn: ({ signal }) => fetchQualifiedStaff(state.serviceIds, signal),
    enabled: state.step === "staff" && state.serviceIds.length > 0,
  });

  // Reconcile the chosen staff against the server's qualified set once it loads;
  // the reducer drops an invalid choice without inventing a replacement.
  useEffect(() => {
    if (staff.data)
      dispatch({
        type: "qualified-staff",
        staffIds: staff.data.map((member) => member.id),
      });
  }, [staff.data]);

  const business = catalog.data?.business;
  const selectedServices =
    catalog.data?.services.filter(({ id }) => state.serviceIds.includes(id)) ??
    [];
  const selectedStaff = staff.data?.find(({ id }) => id === state.staffId);

  return (
    <main
      id="book"
      tabIndex={-1}
      className="mx-auto flex w-full max-w-170 flex-1 flex-col gap-6 px-4 pt-6 pb-10 lg:pt-10"
    >
      <header className="flex flex-col gap-1">
        <p className="text-sm font-medium text-muted-foreground">
          Запазване на час
        </p>
        {catalog.isPending ? (
          <Skeleton className="h-9 w-64" />
        ) : (
          <h1 className="text-[28px] leading-[34px] font-semibold lg:text-4xl lg:leading-[42px]">
            {business?.name ?? "Запазване на час"}
          </h1>
        )}
        {business && (
          <p className="text-base text-muted-foreground">{business.address}</p>
        )}
      </header>

      {catalog.isError ? (
        <Alert variant="error" aria-atomic="true">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>Неуспешно зареждане</AlertTitle>
          <AlertDescription className="col-start-2 flex flex-col items-start gap-3">
            <p>{loadErrorMessage(catalog.error)}</p>
            <Button variant="outline" onClick={() => catalog.refetch()}>
              Опитай отново
            </Button>
          </AlertDescription>
        </Alert>
      ) : state.step === "services" ? (
        <section
          aria-labelledby="services-heading"
          className="flex flex-col gap-4"
        >
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
          ) : catalog.data.services.length === 0 ? (
            <Alert variant="warning">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertTitle>Няма налични услуги в момента</AlertTitle>
            </Alert>
          ) : (
            byCategory(catalog.data.services).map(([category, services]) => (
              <fieldset key={category} className="flex min-w-0 flex-col gap-2">
                <legend className="mb-1 text-sm font-medium text-muted-foreground">
                  {category}
                </legend>
                {services.map((service) => {
                  const selected = state.serviceIds.includes(service.id);
                  return (
                    <label
                      key={service.id}
                      htmlFor={`service-${service.id}`}
                      data-checked={selected || undefined}
                      className="flex min-h-17 cursor-pointer items-center gap-3.5 rounded-card border border-border bg-card px-4 py-3 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 data-checked:border-primary data-checked:bg-selected"
                    >
                      <Checkbox
                        id={`service-${service.id}`}
                        checked={selected}
                        onCheckedChange={() =>
                          dispatch({
                            type: "services",
                            ids: selected
                              ? state.serviceIds.filter(
                                  (id) => id !== service.id,
                                )
                              : [...state.serviceIds, service.id],
                          })
                        }
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
                        {formatServicePrice(service.priceCents, true)}
                      </span>
                    </label>
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
      ) : (
        <section
          aria-labelledby="staff-heading"
          className="flex flex-col gap-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="staff-heading" className="text-xl font-semibold">
              Изберете специалист
            </h2>
            <Button
              variant="link"
              className="px-0"
              onClick={() => dispatch({ type: "edit", step: "services" })}
            >
              Промени услугите
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Избрани услуги:{" "}
            {selectedServices.map(({ name }) => name).join(", ")}. Изберете кой
            да ги извърши — изборът е ваш дори когато е възможен само един
            специалист.
          </p>

          {staff.isPending ? (
            <output className="flex flex-col gap-3" aria-busy="true">
              <span className="sr-only">Търсим подходящ специалист…</span>
              {[0, 1].map((key) => (
                <Skeleton key={key} className="h-18 w-full rounded-card" />
              ))}
            </output>
          ) : staff.isError ? (
            <Alert variant="error" aria-atomic="true">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertTitle>Неуспешно зареждане</AlertTitle>
              <AlertDescription className="col-start-2 flex flex-col items-start gap-3">
                <p>{loadErrorMessage(staff.error)}</p>
                <Button variant="outline" onClick={() => staff.refetch()}>
                  Опитай отново
                </Button>
              </AlertDescription>
            </Alert>
          ) : staff.data.length === 0 ? (
            <Alert variant="warning">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertTitle>
                Няма специалист за всички избрани услуги заедно
              </AlertTitle>
              <AlertDescription className="col-start-2 flex flex-col items-start gap-3">
                <p>Върнете се и променете избора на услуги.</p>
                <Button
                  variant="outline"
                  onClick={() => dispatch({ type: "edit", step: "services" })}
                >
                  Към услугите
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <RadioGroup
              className="gap-3"
              aria-label="Специалисти"
              value={state.staffId}
              onValueChange={(id) => {
                if (typeof id === "string") dispatch({ type: "staff", id });
              }}
            >
              {staff.data.map((member) => {
                const id = `staff-${member.id}`;
                const selected = state.staffId === member.id;
                return (
                  <label
                    key={member.id}
                    htmlFor={id}
                    data-checked={selected || undefined}
                    className="flex min-h-18 cursor-pointer items-center gap-3.5 rounded-card border border-border bg-card px-4 py-3 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 data-checked:border-primary data-checked:bg-selected"
                  >
                    <Avatar className="size-11 shrink-0" aria-hidden="true">
                      {member.imageUrl && (
                        <AvatarImage src={member.imageUrl} alt="" />
                      )}
                      <AvatarFallback className="bg-accent text-base font-semibold text-accent-foreground">
                        {initials(member.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span
                        id={`${id}-name`}
                        className="text-base leading-[22px] font-semibold wrap-anywhere"
                      >
                        {member.name}
                      </span>
                      <span
                        id={`${id}-description`}
                        className="text-sm text-muted-foreground wrap-anywhere"
                      >
                        {member.description}
                      </span>
                    </span>
                    <RadioGroupItem
                      id={id}
                      value={member.id}
                      aria-labelledby={`${id}-name`}
                      aria-describedby={`${id}-description`}
                      className="size-5.5"
                    />
                  </label>
                );
              })}
            </RadioGroup>
          )}

          {selectedStaff && (
            <Alert variant="info" aria-atomic="true">
              <Check aria-hidden="true" />
              <AlertTitle>Избрахте {selectedStaff.name}</AlertTitle>
              <AlertDescription>
                Избирането на дата, час и въвеждането на данни за контакт
                предстои. Засега тази страница не прави реална резервация.
              </AlertDescription>
            </Alert>
          )}
        </section>
      )}
    </main>
  );
}
