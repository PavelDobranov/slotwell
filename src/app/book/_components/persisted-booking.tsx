"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, TriangleAlertIcon } from "lucide-react";
import { useEffect, useReducer, useRef, useState } from "react";

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
import {
  initialPersistedState,
  persistedReducer,
} from "@/app/_lib/booking/persisted-state";
import type {
  BookingAgreement,
  BookingReceipt,
} from "@/app/_lib/booking/submission-api";
import { formatDuration } from "@/app/_lib/duration";
import {
  formatPersistedPrice,
  PersistedDetails,
} from "@/app/book/_components/persisted-details";
import { PersistedTime } from "@/app/book/_components/persisted-time";
import { createPersistedSubmission } from "@/app/book/_lib/persisted-submission";

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

function command(action: () => Promise<void>) {
  void action().catch(() => {});
}
function openConfirmation(receipt: BookingReceipt) {
  window.location.assign(
    `/confirmation#${new URLSearchParams({ appointmentId: receipt.appointmentId, viewToken: receipt.viewToken })}`,
  );
}

export function PersistedBooking() {
  const [state, dispatch] = useReducer(persistedReducer, initialPersistedState);
  const queryClient = useQueryClient();
  const session = useRef<ReturnType<typeof createPersistedSubmission> | null>(
    null,
  );
  const [submission, setSubmission] = useState<ReturnType<
    ReturnType<typeof createPersistedSubmission>["getSnapshot"]
  > | null>(null);
  const handled = useRef<unknown>(null);
  const navigated = useRef<BookingReceipt | null>(null);
  const recoveryHeading = useRef<HTMLHeadingElement>(null);
  function act(
    action: (
      binding: ReturnType<typeof createPersistedSubmission>,
    ) => Promise<void>,
  ) {
    const binding = session.current;
    if (binding) command(() => action(binding));
  }
  useEffect(() => {
    const binding = createPersistedSubmission();
    session.current = binding;
    const unsubscribe = binding.subscribe(() =>
      setSubmission(binding.getSnapshot()),
    );
    setSubmission(binding.getSnapshot());
    command(() => binding.initialize());
    return () => {
      unsubscribe();
      binding.dispose();
      session.current = null;
    };
  }, []);

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
    if (staff.isSuccess && !staff.isFetching && staff.isFetchedAfterMount)
      dispatch({
        type: "qualified-staff",
        serviceIds: state.serviceIds,
        staffIds: staff.data.map((member) => member.id),
      });
  }, [
    staff.data,
    staff.isSuccess,
    staff.isFetching,
    staff.isFetchedAfterMount,
    state.serviceIds,
  ]);

  const business = catalog.data?.business;
  const selectedServices = state.serviceIds.flatMap(
    (id) => catalog.data?.services.find((service) => service.id === id) ?? [],
  );
  const selectedStaff = staff.data?.find(({ id }) => id === state.staffId);
  const current = submission?.booking.current;
  const busy = !submission?.ready || submission.busy;
  const noSelectionProblem =
    !current &&
    Boolean(
      submission?.booking.problem || submission?.booking.retainedIds.length,
    );
  const draftLocked =
    busy ||
    Boolean(
      submission?.associationProblem ||
        noSelectionProblem ||
        (current &&
          (current.kind === "committed" ||
            current.kind === "fenced" ||
            !current.canSubmit)),
    );
  useEffect(() => {
    if (catalog.isSuccess && !catalog.isFetching && !draftLocked)
      dispatch({
        type: "catalog",
        services: catalog.data.services.filter(({ id }) =>
          state.serviceIds.includes(id),
        ),
      });
  }, [
    catalog.data,
    catalog.isSuccess,
    catalog.isFetching,
    draftLocked,
    state.serviceIds,
  ]);
  const consent = selectedServices.map(
    ({ id, name, priceCents, currency, durationMinutes, cleanupMinutes }) => ({
      id,
      name,
      priceCents,
      currency,
      durationMinutes,
      cleanupMinutes,
    }),
  );
  const reviewMatches =
    state.reviewedServices !== null &&
    JSON.stringify(state.reviewedServices) === JSON.stringify(consent) &&
    selectedServices.length === state.serviceIds.length;
  const timingCurrent =
    state.catalogTimingKey ===
      JSON.stringify(
        consent.map(({ id, durationMinutes, cleanupMinutes }) => [
          id,
          durationMinutes,
          cleanupMinutes,
        ]),
      ) && state.slotTimingKey === state.catalogTimingKey;
  const canConfirm =
    !draftLocked &&
    reviewMatches &&
    timingCurrent &&
    !catalog.isFetching &&
    !catalog.isError;
  useEffect(() => {
    if (
      current?.kind === "committed" &&
      current.receipt &&
      navigated.current !== current.receipt
    ) {
      navigated.current = current.receipt;
      openConfirmation(current.receipt);
    }
    if (
      current?.kind === "rejected" &&
      current.canSubmit &&
      handled.current !== current
    ) {
      handled.current = current;
      dispatch({ type: "submission-rejected", code: current.code });
      if (
        current.code === "review_required" ||
        current.code === "selection_unavailable"
      )
        void queryClient.invalidateQueries({ queryKey: ["catalog"] });
      void queryClient.invalidateQueries({ queryKey: ["availability"] });
      void queryClient.invalidateQueries({ queryKey: ["qualified-staff"] });
    }
    if (
      !busy &&
      current &&
      (current.kind === "unresolved" ||
        current.kind === "fenced" ||
        (current.kind === "pending" && !current.canSubmit) ||
        (current.kind === "committed" && !current.receipt))
    )
      recoveryHeading.current?.focus();
  }, [current, queryClient, busy]);
  useEffect(() => {
    if (
      state.step === "review" &&
      !reviewMatches &&
      !draftLocked &&
      selectedServices.length === state.serviceIds.length
    )
      dispatch({ type: "submission-rejected", code: "review_required" });
  }, [
    state.step,
    reviewMatches,
    draftLocked,
    selectedServices.length,
    state.serviceIds.length,
  ]);
  async function confirm() {
    const binding = session.current;
    if (
      !binding ||
      binding.getSnapshot().busy ||
      !canConfirm ||
      !state.staffId ||
      !state.slot ||
      !state.reviewedServices
    )
      return;
    const agreement: BookingAgreement = {
      staffId: state.staffId,
      serviceIds: [...state.serviceIds],
      startsAt: state.slot.start,
      reviewedServices: state.reviewedServices.map((service) => ({
        ...service,
      })),
      contact: { ...state.contact },
    };
    if (!binding.getSnapshot().booking.current) await binding.startNew();
    const snapshot = binding.getSnapshot();
    const selected = snapshot.booking.current;
    if (
      !snapshot.associationProblem &&
      selected &&
      selected.kind !== "committed" &&
      selected.canSubmit
    )
      await binding.submit(agreement);
  }
  const problem = submission?.booking.problem;
  const needsRecovery =
    !busy &&
    current &&
    (current.kind === "committed" ||
      current.kind === "fenced" ||
      !current.canSubmit);

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

      <nav
        aria-label="Стъпки на резервацията"
        className="text-sm text-muted-foreground"
      >
        Услуги → Специалист → Дата и час → Данни → Преглед
      </nav>
      <output className="text-sm text-muted-foreground" aria-live="polite">
        {busy
          ? "Обработваме заявката…"
          : `Текуща стъпка: ${{ services: "Услуги", staff: "Специалист", time: "Дата и час", details: "Данни", review: "Преглед" }[state.step]}`}
      </output>
      {submission?.associationProblem ||
      (!submission?.ready && !submission?.busy && submission !== null) ? (
        <Alert variant="error">
          <AlertTitle>
            {submission?.associationProblem
              ? "Не можем да свържем запазения опит с този раздел."
              : "Съхранението на опитите не е достъпно."}
          </AlertTitle>
          <AlertDescription>
            Няма да започнем друг опит автоматично. Запазените опити не са
            изтрити.
          </AlertDescription>
          <Button
            variant="outline"
            disabled={submission?.busy}
            onClick={() => act((binding) => binding.initialize())}
          >
            Провери съхранението отново
          </Button>
        </Alert>
      ) : null}
      {problem &&
        submission?.ready &&
        !submission.associationProblem &&
        !needsRecovery && (
          <Alert variant="warning">
            <AlertTitle>
              {problem === "intent_capacity_reached"
                ? "Достигнат е лимитът от 16 запазени опита."
                : problem === "intent_not_retained"
                  ? "Опитът не е намерен в съхранението. Няма да започнем друг автоматично."
                  : problem === "intent_storage_unavailable"
                    ? "Съхранението на опитите не е достъпно."
                    : "Проверете избора и данните отново."}
            </AlertTitle>
            {!current && problem === "intent_storage_unavailable" && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => act((binding) => binding.initialize())}
              >
                Провери съхранението отново
              </Button>
            )}
          </Alert>
        )}
      {!current &&
        submission?.ready &&
        !submission.associationProblem &&
        submission.booking.retainedIds.length > 0 && (
          <section aria-label="Запазени опити" className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold">Имате запазени опити</h2>
            <p>
              Изберете опит за възстановяване или изрично започнете отделна
              резервация. Запазените опити не се заменят.
            </p>
            <div className="flex flex-wrap gap-2">
              {submission.booking.retainedIds.map((id, index) => (
                <Button
                  key={id}
                  variant="outline"
                  disabled={busy}
                  onClick={() => act((binding) => binding.resume(id))}
                >
                  Възстанови опит {index + 1}
                </Button>
              ))}
            </div>
            {!problem && (
              <Button
                disabled={busy}
                onClick={() => act((binding) => binding.startNew())}
              >
                Започни отделна резервация
              </Button>
            )}
          </section>
        )}
      {current && (
        <section
          aria-labelledby={needsRecovery ? "recovery-heading" : undefined}
          className="flex flex-col gap-3"
          aria-busy={busy}
        >
          {needsRecovery && (
            <Alert variant="info">
              <AlertTitle>
                <h2 id="recovery-heading" ref={recoveryHeading} tabIndex={-1}>
                  {current.kind === "committed"
                    ? "Резервацията е потвърдена"
                    : current.kind === "fenced"
                      ? "Завършете безопасното изчистване"
                      : current.kind === "pending" && !current.canRetry
                        ? "Този запазен опит е само за възстановяване"
                        : "Резултатът още не е известен"}
                </h2>
              </AlertTitle>
              <AlertDescription>
                {current.kind === "committed"
                  ? "Възстановете личния линк, ако още не се е отворил."
                  : "Не започвайте повторна резервация. Проверете резултата или изчистете опита безопасно. Изчистването не отменя потвърдена резервация."}
              </AlertDescription>
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            {current.kind !== "fenced" && (
              <Button
                variant="outline"
                disabled={busy || submission?.associationProblem}
                onClick={() => act((binding) => binding.recover())}
              >
                Провери резултата
              </Button>
            )}
            {current.kind !== "committed" &&
              current.canRetry &&
              !current.canSubmit && (
                <Button
                  disabled={busy || submission?.associationProblem}
                  onClick={() => act((binding) => binding.retry())}
                >
                  Повтори същото потвърждение
                </Button>
              )}
            {current.kind !== "committed" && (
              <Button
                variant="outline"
                disabled={busy || submission?.associationProblem}
                onClick={() => {
                  const binding = session.current;
                  if (binding)
                    command(async () => {
                      await binding.clear();
                      if (!binding.getSnapshot().booking.current)
                        dispatch({ type: "edit", step: "details" });
                    });
                }}
              >
                Изчисти този опит
              </Button>
            )}
            {current.kind === "committed" && current.receipt && (
              <Button
                onClick={() =>
                  current.receipt && openConfirmation(current.receipt)
                }
              >
                Отвори потвърждението
              </Button>
            )}
          </div>
        </section>
      )}
      {state.notice && (
        <output className="text-sm text-muted-foreground">
          {state.notice}
        </output>
      )}
      <fieldset
        disabled={draftLocked}
        className="flex min-w-0 flex-col gap-6 border-0 p-0"
      >
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
                <fieldset
                  key={category}
                  className="flex min-w-0 flex-col gap-2"
                >
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
                          disabled={draftLocked}
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
                          {formatPersistedPrice(
                            service.priceCents,
                            service.currency,
                          )}
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
        ) : (state.step === "details" || state.step === "review") &&
          business ? (
          <PersistedDetails
            state={state}
            services={selectedServices}
            staffName={selectedStaff?.name ?? "Избраният специалист"}
            business={business}
            dispatch={dispatch}
            canConfirm={canConfirm}
            onConfirm={() => command(confirm)}
          />
        ) : state.step === "time" && business ? (
          <PersistedTime
            state={state}
            timeZone={business.timeZone}
            disabled={draftLocked}
            dispatch={dispatch}
          />
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
              {selectedServices.map(({ name }) => name).join(", ")}. Изберете
              кой да ги извърши — изборът е ваш дори когато е възможен само един
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
                disabled={draftLocked}
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
              <>
                <Alert variant="info" aria-atomic="true">
                  <Check aria-hidden="true" />
                  <AlertTitle>Избрахте {selectedStaff.name}</AlertTitle>
                </Alert>
                <Button
                  className="self-end"
                  disabled={staff.isFetching || staff.isError}
                  onClick={() => dispatch({ type: "next" })}
                >
                  Продължи към дата и час
                </Button>
              </>
            )}
          </section>
        )}
      </fieldset>
    </main>
  );
}
