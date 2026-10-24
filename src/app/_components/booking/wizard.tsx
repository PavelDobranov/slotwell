"use client";

import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { CircleAlert, CircleCheck } from "lucide-react";
import { useEffect, useReducer, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/app/_components/alert";

import { BookingSummary } from "@/app/_components/booking/booking-summary";
import { DetailsStep } from "@/app/_components/booking/details-step";
import { RecoveryNotice } from "@/app/_components/booking/recovery-notice";
import { ServicesStep } from "@/app/_components/booking/services-step";
import { SpecialistStep } from "@/app/_components/booking/specialist-step";
import { Stepper, stepLabels } from "@/app/_components/booking/stepper";
import { Success } from "@/app/_components/booking/success";
import { TimeStep } from "@/app/_components/booking/time-step";
import { Button } from "@/app/_components/button";
import {
  availableSlots,
  qualifiedStaff,
} from "@/app/_lib/booking/availability";
import { createDemoSalon } from "@/app/_lib/booking/fixtures";
import { createDemoSession } from "@/app/_lib/booking/session";
import {
  type BookingAction,
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
import { cn } from "@/app/_lib/utils";

export function BookingWizard() {
  const session = useRef<ReturnType<typeof createDemoSession> | null>(null);
  const submissionLocked = useRef(false);
  const [pending, setPending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [pathSwitched, setPathSwitched] = useState(false);
  const [confirmationError, setConfirmationError] = useState("");
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
      salon === null || (submissionLocked.current && action.type === "refresh")
        ? current
        : bookingReducer(current, action, {
            salon,
            now,
            sessionOccupied: session.current?.occupied,
          }),
    initialBookingState,
  );
  function dispatch(action: BookingAction) {
    const now = Date.now();
    if (action.type !== "contact") setConfirmationError("");
    if (action.type !== "contact" && action.type !== "refresh")
      setPathSwitched(
        action.type === "path" &&
          action.path !== state.path &&
          (state.start !== null || state.staffId !== null),
      );
    setAvailabilityTime(now);
    reduce({ action, now });
  }
  async function confirm() {
    if (submissionLocked.current || session.current === null) return;
    submissionLocked.current = true;
    setPending(true);
    setConfirmationError("");
    try {
      const result = await session.current.confirm(state);
      if (result === "success") {
        setConfirmed(true);
      } else if (result === "retryable") {
        submissionLocked.current = false;
        setConfirmationError(
          "Нещо прекъсна заявката. Демо резервация не е направена и нищо не е загубено. Опитай отново.",
        );
      } else {
        submissionLocked.current = false;
        dispatch({ type: result === "unavailable" ? "conflict" : "refresh" });
        setConfirmationError(
          result === "unavailable"
            ? `${state.start === null ? "Избраният час" : formatBusinessTime(state.start)} вече е зает. Демо резервация не е направена. Услугите и данните ти за контакт са запазени. Избери нов час.`
            : "Изборът вече не е валиден. Демо резервация не е направена. Данните ти за контакт са запазени. Провери специалиста и часа отново.",
        );
      }
    } catch {
      submissionLocked.current = false;
      setConfirmationError(
        "Нещо прекъсна заявката. Демо резервация не е направена и нищо не е загубено. Опитай отново.",
      );
    } finally {
      setPending(false);
    }
  }
  const heading = useRef<HTMLHeadingElement>(null);
  const lastFocusedControl = useRef<HTMLElement | null>(null);
  const previousStep = useRef(state.step);
  const previousPath = useRef(state.path);
  useEffect(() => {
    // Keep the one-shot bootstrap intact across Strict Mode effect replay.
    if (session.current === null) {
      const now = Date.now();
      // Demo/test bootstrap only (e.g. Playwright addInitScript). Accept one enum,
      // then remove the hook. Never use URLs, storage, or visitor data for scenarios.
      const bootstrap = window as Window & {
        __SLOTWELL_DEMO_SCENARIO__?: unknown;
      };
      const scenario = bootstrap.__SLOTWELL_DEMO_SCENARIO__;
      delete bootstrap.__SLOTWELL_DEMO_SCENARIO__;
      session.current = createDemoSession(
        createDemoSalon(() => now),
        () => Date.now(),
        undefined,
        scenario === "conflict" || scenario === "retryable"
          ? scenario
          : "normal",
      );
      setReferenceTime(now);
      setAvailabilityTime(now);
    }
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
      (previousPath.current !== state.path && state.step !== "services") ||
      (lastFocusedControl.current !== null &&
        !lastFocusedControl.current.isConnected &&
        document.activeElement === document.body)
    )
      heading.current?.focus();
    previousStep.current = state.step;
    previousPath.current = state.path;
  });

  useEffect(() => {
    if (confirmed) heading.current?.focus();
  }, [confirmed]);

  const order = stepOrder(state.path);
  const today =
    availabilityTime === null ? null : businessDateAt(availabilityTime);
  const noSpecialist =
    salon !== null &&
    state.serviceIds.length > 0 &&
    qualifiedStaff(salon, state.serviceIds).length === 0;

  return (
    <>
      {!confirmed && (
        <Stepper
          path={state.path}
          step={state.step}
          disabled={pending}
          onNavigate={(step) => dispatch({ type: "edit", step })}
        />
      )}
      <fieldset
        disabled={pending}
        aria-busy={pending}
        className={cn(
          "grid min-w-0 items-start gap-8",
          confirmed
            ? "mx-auto max-w-170"
            : "pb-24 lg:grid-cols-[minmax(0,1fr)_22.5rem] lg:pb-0",
        )}
      >
        <section
          onFocusCapture={(event) => {
            lastFocusedControl.current = event.target;
          }}
          aria-labelledby="step-heading"
          className="flex min-w-0 flex-col gap-4 py-2"
        >
          <p className="sr-only">
            {confirmed
              ? "Демонстрацията е завършена"
              : `Стъпка ${order.indexOf(state.step) + 1} от 4`}
          </p>
          {confirmed && (
            <CircleCheck
              aria-hidden="true"
              className="size-11 fill-primary text-primary-foreground"
            />
          )}
          <h2
            id="step-heading"
            ref={heading}
            tabIndex={-1}
            className={
              state.step === "details" && !confirmed
                ? "sr-only"
                : "rounded-sm text-xl font-semibold"
            }
          >
            {confirmed
              ? "Демо резервацията е потвърдена"
              : stepLabels[state.step]}
          </h2>
          {!confirmed && (
            <RecoveryNotice
              state={state}
              pathSwitched={pathSwitched}
              staffName={
                salon?.staff.find(({ id }) => id === state.staffId)?.name
              }
            />
          )}
          {confirmationError && !confirmed && (
            <Alert variant="destructive" className="px-4 py-3">
              <CircleAlert aria-hidden="true" />
              <AlertTitle>
                {state.step === "details"
                  ? "Не успяхме да потвърдим"
                  : "Избери нов час"}
              </AlertTitle>
              <AlertDescription>{confirmationError}</AlertDescription>
            </Alert>
          )}
          {confirmed && salon !== null && state.start !== null ? (
            <Success
              salon={salon}
              state={{ ...state, start: state.start }}
              onNewBooking={() => {
                submissionLocked.current = false;
                setConfirmed(false);
                setConfirmationError("");
                dispatch({ type: "new-booking" });
              }}
            />
          ) : state.step === "services" ? (
            <fieldset disabled={salon === null} className="min-w-0">
              <ServicesStep
                services={salon?.services ?? []}
                serviceIds={state.serviceIds}
                path={state.path}
                noSpecialist={noSpecialist}
                onServices={(ids) => dispatch({ type: "services", ids })}
                onPath={(path) => dispatch({ type: "path", path })}
                onNext={() => dispatch({ type: "next" })}
              />
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
                          sessionOccupied: session.current?.occupied,
                          serviceIds: state.serviceIds,
                          date:
                            state.start === null
                              ? businessDateAt(availabilityTime)
                              : businessDateAt(state.start),
                        }).find(({ start }) => start === state.start)
                          ?.staffIds ?? [])
                      : undefined
                  }
                  onServices={(ids) => dispatch({ type: "services", ids })}
                  onEditTime={() => dispatch({ type: "edit", step: "time" })}
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
                    sessionOccupied: session.current?.occupied,
                    serviceIds: state.serviceIds,
                    staffId:
                      state.path === "staff-first"
                        ? (state.staffId ?? undefined)
                        : undefined,
                  }}
                  start={state.start}
                  selectedDate={state.date}
                  onEditStaff={() => {
                    if (state.path === "time-first") {
                      dispatch({ type: "path", path: "staff-first" });
                    }
                    dispatch({ type: "edit", step: "staff" });
                  }}
                  onDate={(date) => dispatch({ type: "date", date })}
                  onSelect={(start) => dispatch({ type: "time", start })}
                  onNext={() => dispatch({ type: "next" })}
                  onEditServices={() =>
                    dispatch({ type: "edit", step: "services" })
                  }
                />
              ) : state.step === "details" &&
                salon !== null &&
                state.start !== null ? (
                <DetailsStep
                  draft={state.contact}
                  pending={pending}
                  retryable={Boolean(confirmationError)}
                  appointment={{
                    start: state.start,
                    staffName:
                      salon.staff.find(({ id }) => id === state.staffId)
                        ?.name ?? "",
                    ...selectedTotals(state, salon),
                  }}
                  onBack={() => dispatch({ type: "back" })}
                  onConfirm={confirm}
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
                hidden={state.step === "details"}
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
        {!confirmed && (
          <BookingSummary
            salon={salon}
            state={state}
            confirmed={false}
            onEdit={(step) => dispatch({ type: "edit", step })}
          />
        )}
      </fieldset>
    </>
  );
}
