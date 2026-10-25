"use client";

import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  LoaderCircle,
} from "lucide-react";
import { useEffect, useReducer, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/app/_components/alert";

import { BookingHeader } from "@/app/_components/booking/booking-header";
import { BookingSummary } from "@/app/_components/booking/booking-summary";
import { DetailsStep } from "@/app/_components/booking/details-step";
import { MobileProgress } from "@/app/_components/booking/mobile-progress";
import { RecoveryNotice } from "@/app/_components/booking/recovery-notice";
import { ServicesStep } from "@/app/_components/booking/services-step";
import { SpecialistStep } from "@/app/_components/booking/specialist-step";
import {
  bookingProgress,
  milestoneLabels,
  Stepper,
  stepLabels,
} from "@/app/_components/booking/stepper";
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
  const [reviewRequested, setReviewRequested] = useState(false);
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
    // Any explicit edit/navigation requires a fresh contact review. A clock
    // refresh keeps review only while the reducer still has valid choices.
    if (action.type !== "refresh") setReviewRequested(false);
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

  const progress = bookingProgress(state, reviewRequested);
  const reviewing = progress.current === 3;
  const today =
    availabilityTime === null ? null : businessDateAt(availabilityTime);
  const order = stepOrder(state.path);
  const firstSelectionStep = state.step === order[2] ? order[1] : null;
  const selectedStaff = salon?.staff.find(({ id }) => id === state.staffId);
  const firstSelection =
    firstSelectionStep === "staff" && selectedStaff
      ? { label: "Избран специалист", value: selectedStaff.name }
      : firstSelectionStep === "time" && state.start !== null && salon
        ? {
            label: "Избран час",
            value: `${formatBusinessDate(businessDateAt(state.start))} · ${formatBusinessTime(state.start)}–${formatBusinessTime(state.start + selectedTotals(state, salon).durationMinutes * 60_000)}`,
          }
        : null;
  const nextStep = order[order.indexOf(state.step) + 1];
  const nextLabel = reviewing
    ? "Демонстрация · няма плащане"
    : state.step === "details"
      ? "Следва: преглед"
      : `Следва: ${stepLabels[nextStep]}`;
  const actionForm =
    state.step === "services"
      ? "booking-services"
      : state.step === "details" && !reviewing
        ? "booking-contact"
        : undefined;
  const noSpecialist =
    salon !== null &&
    state.serviceIds.length > 0 &&
    qualifiedStaff(salon, state.serviceIds).length === 0;

  return (
    <>
      <BookingHeader
        subtitle={
          confirmed ? (
            <span className="lg:hidden">Демо резервацията е потвърдена</span>
          ) : (
            <MobileProgress
              current={progress.current + 1}
              total={milestoneLabels.length}
              label={milestoneLabels[progress.current]}
            />
          )
        }
        disabled={pending}
        onBack={
          confirmed || state.step === "services"
            ? undefined
            : () => {
                if (reviewing) {
                  setReviewRequested(false);
                  requestAnimationFrame(() => heading.current?.focus());
                } else dispatch({ type: "back" });
              }
        }
      >
        {!confirmed && (
          <Stepper
            state={state}
            review={reviewing}
            disabled={pending}
            onNavigate={(step) => {
              dispatch({ type: "edit", step });
              requestAnimationFrame(() => heading.current?.focus());
            }}
          />
        )}
      </BookingHeader>
      <main
        id="booking"
        tabIndex={-1}
        className="flex w-full flex-1 flex-col gap-5 px-4 pt-5 pb-7 lg:gap-6 lg:px-12 lg:pt-10 lg:pb-14"
      >
        <h1 className="sr-only">Запази време за себе си</h1>
        <fieldset
          disabled={pending}
          aria-busy={pending}
          className={cn(
            "grid min-w-0 items-start gap-8",
            confirmed
              ? "mx-auto max-w-170"
              : "gap-y-0 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-x-12 lg:gap-y-6",
          )}
        >
          <section
            onFocusCapture={(event) => {
              lastFocusedControl.current = event.target;
            }}
            aria-labelledby="step-heading"
            className="mb-6 flex min-w-0 flex-col gap-4 py-2 lg:mb-0"
          >
            <p className="sr-only">
              {confirmed
                ? "Демонстрацията е завършена"
                : `Стъпка ${progress.current + 1} от 4`}
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
                  : "rounded-sm text-[28px] leading-[34px] font-semibold lg:text-4xl lg:leading-[42px]"
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
                  showPrimaryAction={false}
                  services={salon?.services ?? []}
                  serviceIds={state.serviceIds}
                  noSpecialist={noSpecialist}
                  onServices={(ids) => dispatch({ type: "services", ids })}
                  onNext={() => dispatch({ type: "next" })}
                />
              </fieldset>
            ) : (
              <>
                {(state.step === "staff" || state.step === "time") && (
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
                          <label
                            htmlFor={path}
                            className="flex min-h-11 cursor-pointer items-center"
                          >
                            {label}
                          </label>
                        </div>
                      ))}
                    </RadioGroup>
                  </fieldset>
                )}
                {firstSelection !== null && firstSelectionStep !== null && (
                  <section
                    aria-label="Първият ти избор"
                    className="flex min-w-0 items-center gap-3 rounded-card bg-accent py-2.5 pr-2 pl-4 text-accent-foreground"
                  >
                    <CircleCheck
                      aria-hidden="true"
                      className="size-5 shrink-0"
                    />
                    <p className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-[13px] leading-[18px]">
                        {firstSelection.label}
                      </span>
                      <span className="text-sm leading-[21px] font-semibold wrap-anywhere">
                        {firstSelection.value}
                      </span>
                    </p>
                    <Button
                      variant="link"
                      className="underline"
                      onClick={() =>
                        dispatch({ type: "edit", step: firstSelectionStep })
                      }
                    >
                      Промени
                    </Button>
                  </section>
                )}
                {salon !== null &&
                availabilityTime !== null &&
                state.step === "staff" ? (
                  <SpecialistStep
                    showPrimaryAction={false}
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
                    showPrimaryAction={false}
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
                    showPrimaryAction={false}
                    draft={state.contact}
                    checked={reviewing}
                    onChecked={(checked) => {
                      // Revalidate against the live clock before entering review.
                      if (checked) dispatch({ type: "refresh" });
                      setReviewRequested(checked);
                    }}
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
                  className="hidden self-start lg:inline-flex"
                  onClick={() => dispatch({ type: "back" })}
                >
                  Назад
                </Button>
              </>
            )}
            {!confirmed && (
              <>
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  {today === null ? (
                    "Подготвяме датата на салона…"
                  ) : (
                    <>
                      Днес:{" "}
                      <time dateTime={today}>{formatBusinessDate(today)}</time>
                    </>
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  Всички часове са местни за салона в София (Europe/Sofia).
                </p>
              </>
            )}
            <noscript>
              За избор на услуги е необходимо да включиш JavaScript.
            </noscript>
          </section>
          {!confirmed && (
            <BookingSummary
              salon={salon}
              state={state}
              confirmed={false}
              action={
                <>
                  <p
                    id="booking-next"
                    className="text-sm text-muted-foreground"
                  >
                    {nextLabel}
                  </p>
                  <Button
                    // Replace the node on navigation: a button click must not
                    // acquire a new form-submit default action mid-event.
                    key={`${state.step}-${reviewing}`}
                    aria-describedby="booking-next"
                    type={actionForm ? "submit" : "button"}
                    form={actionForm}
                    disabled={
                      salon === null ||
                      pending ||
                      (state.step === "staff" && state.staffId === null) ||
                      (state.step === "time" && state.start === null)
                    }
                    className="h-auto min-h-13 w-full whitespace-normal lg:w-auto lg:min-w-65"
                    onClick={
                      reviewing
                        ? confirm
                        : state.step === "staff" || state.step === "time"
                          ? () => dispatch({ type: "next" })
                          : undefined
                    }
                  >
                    {pending && (
                      <LoaderCircle
                        aria-hidden="true"
                        data-icon="inline-start"
                        className="motion-safe:animate-spin"
                      />
                    )}
                    {reviewing
                      ? pending
                        ? "Потвърждаваме…"
                        : confirmationError
                          ? "Опитай отново"
                          : "Потвърди демо резервация"
                      : state.step === "details"
                        ? "Провери данните"
                        : "Продължи"}
                    {!reviewing && (
                      <ArrowRight aria-hidden="true" data-icon="inline-end" />
                    )}
                  </Button>
                </>
              }
              onEdit={(step) => dispatch({ type: "edit", step })}
            />
          )}
        </fieldset>
      </main>
    </>
  );
}
