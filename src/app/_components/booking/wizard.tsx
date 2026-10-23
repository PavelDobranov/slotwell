"use client";

import { Checkbox } from "@base-ui/react/checkbox";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { CheckIcon } from "lucide-react";
import { useEffect, useReducer, useRef, useState } from "react";

import { DetailsStep } from "@/app/_components/booking/details-step";
import { SpecialistStep } from "@/app/_components/booking/specialist-step";
import { TimeStep } from "@/app/_components/booking/time-step";
import { Button } from "@/app/_components/button";
import {
  availableSlots,
  qualifiedStaff,
} from "@/app/_lib/booking/availability";
import { createDemoSalon } from "@/app/_lib/booking/fixtures";
import {
  type BookingAction,
  type BookingStep,
  bookingReducer,
  initialBookingState,
  selectedTotals,
  stepOrder,
} from "@/app/_lib/booking/state";
import {
  businessDateAt,
  formatBusinessDate,
  formatBusinessTime,
} from "@/app/_lib/booking/time";

const labels: Record<BookingStep, string> = {
  services: "Услуги",
  staff: "Специалист",
  time: "Дата и час",
  details: "Данни и преглед",
};
const euros = new Intl.NumberFormat("bg-BG", {
  style: "currency",
  currency: "EUR",
});

export function BookingWizard() {
  const [referenceTime, setReferenceTime] = useState<number | null>(null);
  const [availabilityTime, setAvailabilityTime] = useState<number | null>(null);
  // The initial render has no live dates; fixtures are created only after mounting.
  const salon =
    referenceTime === null ? null : createDemoSalon(() => referenceTime);
  const [state, reduce] = useReducer(
    (
      current: typeof initialBookingState,
      { action, now }: { action: BookingAction; now: number },
    ) =>
      salon === null
        ? current
        : bookingReducer(current, action, { salon, now }),
    initialBookingState,
  );
  function dispatch(action: BookingAction) {
    const now = Date.now();
    setAvailabilityTime(now);
    reduce({ action, now });
  }
  const heading = useRef<HTMLHeadingElement>(null);
  const lastFocusedControl = useRef<HTMLElement | null>(null);
  const previousStep = useRef(state.step);
  const previousPath = useRef(state.path);
  useEffect(() => {
    const now = Date.now();
    setReferenceTime(now);
    setAvailabilityTime(now);
    // Keep fixtures anchored to this session, but refresh displayed availability.
    const timer = window.setInterval(() => {
      const now = Date.now();
      setAvailabilityTime(now);
      reduce({ action: { type: "refresh" }, now });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (
      previousStep.current !== state.step ||
      previousPath.current !== state.path ||
      (lastFocusedControl.current !== null &&
        !lastFocusedControl.current.isConnected &&
        document.activeElement === document.body)
    )
      heading.current?.focus();
    previousStep.current = state.step;
    previousPath.current = state.path;
  });

  const order = stepOrder(state.path);
  const today =
    availabilityTime === null ? null : businessDateAt(availabilityTime);
  const selected =
    salon?.services.filter(({ id }) => state.serviceIds.includes(id)) ?? [];
  const totals = salon === null ? null : selectedTotals(state, salon);
  const noSpecialist =
    salon !== null &&
    state.serviceIds.length > 0 &&
    qualifiedStaff(salon, state.serviceIds).length === 0;

  return (
    <>
      <nav aria-label="Стъпки на резервацията">
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {order.map((step, index) => (
            <li
              key={step}
              aria-current={step === state.step ? "step" : undefined}
              className="flex items-center gap-3 rounded-md border p-3 text-sm text-muted-foreground aria-[current=step]:border-primary aria-[current=step]:bg-secondary aria-[current=step]:font-semibold aria-[current=step]:text-foreground"
            >
              <span aria-hidden="true" className="font-mono">
                0{index + 1}
              </span>
              {labels[step]}
            </li>
          ))}
        </ol>
      </nav>
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section
          onFocusCapture={(event) => {
            lastFocusedControl.current = event.target;
          }}
          aria-labelledby="step-heading"
          className="flex min-w-0 flex-col gap-4 py-2"
        >
          <p className="text-sm font-medium text-muted-foreground">
            Стъпка {order.indexOf(state.step) + 1} от 4
          </p>
          <h2
            id="step-heading"
            ref={heading}
            tabIndex={-1}
            className="rounded-sm text-2xl font-semibold"
          >
            {labels[state.step]}
          </h2>
          <output className="text-sm text-muted-foreground">
            {state.notice}
          </output>
          {state.step === "services" ? (
            <fieldset
              className="flex min-w-0 flex-col gap-3"
              disabled={salon === null}
            >
              <legend className="mb-3 text-muted-foreground">
                Избери една или повече услуги за посещението си.
              </legend>
              {salon?.services.map((service) => (
                <div
                  key={service.id}
                  className="flex min-h-14 cursor-pointer items-center gap-3 rounded-md border p-4 has-[[data-checked]]:border-primary has-[[data-checked]]:bg-secondary"
                >
                  <Checkbox.Root
                    id={`service-${service.id}`}
                    nativeButton
                    render={<button type="button" />}
                    checked={state.serviceIds.includes(service.id)}
                    onCheckedChange={(checked) =>
                      dispatch({
                        type: "services",
                        ids: checked
                          ? [...state.serviceIds, service.id]
                          : state.serviceIds.filter((id) => id !== service.id),
                      })
                    }
                    className="flex size-5 shrink-0 items-center justify-center rounded-sm border border-input bg-background text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <Checkbox.Indicator>
                      <CheckIcon aria-hidden="true" className="size-4" />
                    </Checkbox.Indicator>
                  </Checkbox.Root>
                  <label
                    htmlFor={`service-${service.id}`}
                    className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1"
                  >
                    <span className="font-medium">{service.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {service.durationMinutes} мин ·{" "}
                      {euros.format(service.priceCents / 100)}
                    </span>
                  </label>
                </div>
              ))}
              <p className="text-sm text-muted-foreground">
                За да продължиш, избери поне една услуга.
              </p>
              {noSpecialist && (
                <output>
                  Няма специалист за тази комбинация от услуги. Промени избора
                  си.
                </output>
              )}
              <Button
                className="self-start"
                disabled={state.serviceIds.length === 0}
                onClick={() => dispatch({ type: "next" })}
              >
                Продължи
              </Button>
            </fieldset>
          ) : (
            <>
              <fieldset className="flex min-w-0 flex-col gap-3">
                <legend id="path-label" className="mb-3 font-medium">
                  Как предпочиташ да избереш?
                </legend>
                <RadioGroup
                  aria-labelledby="path-label"
                  value={state.path}
                  onValueChange={(path) => {
                    if (path === "staff-first" || path === "time-first")
                      dispatch({ type: "path", path });
                  }}
                  className="flex flex-col gap-3 sm:flex-row"
                >
                  {(
                    [
                      ["staff-first", "Първо специалист"],
                      ["time-first", "Първо дата и час"],
                    ] as const
                  ).map(([path, label]) => (
                    <div
                      key={path}
                      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border p-3"
                    >
                      <Radio.Root
                        id={path}
                        nativeButton
                        render={<button type="button" />}
                        value={path}
                        className="flex size-5 shrink-0 items-center justify-center rounded-full border border-input bg-background text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        <Radio.Indicator className="size-2.5 rounded-full bg-current" />
                      </Radio.Root>
                      <label htmlFor={path} className="cursor-pointer">
                        {label}
                      </label>
                    </div>
                  ))}
                </RadioGroup>
              </fieldset>
              {salon !== null &&
              availabilityTime !== null &&
              state.step === "staff" ? (
                <SpecialistStep
                  salon={salon}
                  serviceIds={state.serviceIds}
                  staffId={state.staffId}
                  availableStaffIds={
                    state.path === "time-first"
                      ? (availableSlots({
                          salon,
                          now: availabilityTime,
                          serviceIds: state.serviceIds,
                          date:
                            state.start === null
                              ? businessDateAt(availabilityTime)
                              : businessDateAt(state.start),
                        }).find(({ start }) => start === state.start)
                          ?.staffIds ?? [])
                      : undefined
                  }
                  onSelect={(id) => dispatch({ type: "staff", id })}
                  onNext={() => dispatch({ type: "next" })}
                  onEditServices={() =>
                    dispatch({ type: "edit", step: "services" })
                  }
                />
              ) : state.step === "time" &&
                salon !== null &&
                availabilityTime !== null ? (
                <TimeStep
                  availability={{
                    salon,
                    now: availabilityTime,
                    serviceIds: state.serviceIds,
                    staffId:
                      state.path === "staff-first"
                        ? (state.staffId ?? undefined)
                        : undefined,
                  }}
                  start={state.start}
                  selectedDate={state.date}
                  onDate={(date) => dispatch({ type: "date", date })}
                  onSelect={(start) => dispatch({ type: "time", start })}
                  onNext={() => dispatch({ type: "next" })}
                  onEditServices={() =>
                    dispatch({ type: "edit", step: "services" })
                  }
                />
              ) : state.step === "details" ? (
                <DetailsStep
                  draft={state.contact}
                  onChange={(draft) => dispatch({ type: "contact", draft })}
                />
              ) : (
                <p className="text-muted-foreground">
                  {noSpecialist
                    ? "Няма специалист за тази комбинация от услуги. Върни се и промени избора си."
                    : "Изборът на конкретен специалист и свободен час ще бъде добавен в следващите стъпки на прототипа."}
                </p>
              )}
              <Button
                variant="outline"
                className="self-start"
                onClick={() => dispatch({ type: "back" })}
              >
                Назад
              </Button>
            </>
          )}
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {today === null ? (
              "Подготвяме датата на салона…"
            ) : (
              <>
                Днес: <time dateTime={today}>{formatBusinessDate(today)}</time>
              </>
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            Всички часове са местни за салона в София (Europe/Sofia).
          </p>
          <noscript>
            За избор на услуги е необходимо да включиш JavaScript.
          </noscript>
        </section>
        <aside
          aria-labelledby="summary-heading"
          className="flex flex-col gap-4 rounded-lg border bg-muted p-6"
        >
          <h2 id="summary-heading" className="text-lg font-semibold">
            Твоят избор
          </h2>
          {selected.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Все още няма избрани услуги.
            </p>
          ) : (
            <>
              <ul className="flex flex-col gap-2 text-sm">
                {selected.map((service) => (
                  <li key={service.id}>{service.name}</li>
                ))}
              </ul>
              <p className="font-medium" aria-live="polite">
                Общо: {totals?.durationMinutes} мин ·{" "}
                {euros.format((totals?.priceCents ?? 0) / 100)}
              </p>
              {state.staffId !== null && (
                <p className="text-sm">
                  {salon?.staff.find(({ id }) => id === state.staffId)?.name}
                </p>
              )}
              {state.start !== null && (
                <p className="text-sm">
                  {formatBusinessDate(businessDateAt(state.start))} ·{" "}
                  {formatBusinessTime(state.start)}–
                  {formatBusinessTime(
                    state.start + (totals?.durationMinutes ?? 0) * 60_000,
                  )}
                </p>
              )}
              {state.step === "details" && (
                <>
                  <p className="text-sm">
                    Място: {salon?.name}, {salon?.address}
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => dispatch({ type: "edit", step: "staff" })}
                  >
                    Промени специалиста
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => dispatch({ type: "edit", step: "time" })}
                  >
                    Промени датата и часа
                  </Button>
                </>
              )}
              {state.step !== "services" && (
                <Button
                  variant="outline"
                  onClick={() => dispatch({ type: "edit", step: "services" })}
                >
                  Промени услугите
                </Button>
              )}
            </>
          )}
        </aside>
      </div>
    </>
  );
}
