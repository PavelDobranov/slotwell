"use client";

import { TriangleAlertIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/app/_components/alert";
import { Button } from "@/app/_components/button";
import { Skeleton } from "@/app/_components/skeleton";
import { CatalogApiError } from "@/app/_features/booking/api";
import { useBooking } from "@/app/_features/booking/context";
import { DetailsStep } from "@/app/_features/booking/details/details-step";
import { ServicesStep } from "@/app/_features/booking/services/services-step";
import { SpecialistStep } from "@/app/_features/booking/specialist/specialist-step";
import { TimeStep } from "@/app/_features/booking/time-selection/time-step";

function loadErrorMessage(error: unknown): string {
  if (error instanceof CatalogApiError && error.code === "network")
    return "Няма връзка със сървъра. Провери връзката си и опитай отново.";
  return "Нещо се обърка при зареждането. Опитай отново.";
}

export function BookingFlow() {
  const { state, catalog, submission, busy, draftLocked, commands } =
    useBooking();
  const business = catalog.data?.business;
  const current = submission?.booking.current;
  const recoveryHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (
      !busy &&
      current &&
      (current.kind === "unresolved" ||
        current.kind === "fenced" ||
        (current.kind === "pending" && !current.canSubmit) ||
        (current.kind === "committed" && !current.receipt))
    )
      recoveryHeading.current?.focus();
  }, [current, busy]);
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
            onClick={commands.initialize}
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
                onClick={commands.initialize}
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
                  onClick={() => commands.resume(id)}
                >
                  Възстанови опит {index + 1}
                </Button>
              ))}
            </div>
            {!problem && (
              <Button disabled={busy} onClick={commands.startNew}>
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
                onClick={commands.recover}
              >
                Провери резултата
              </Button>
            )}
            {current.kind !== "committed" &&
              current.canRetry &&
              !current.canSubmit && (
                <Button
                  disabled={busy || submission?.associationProblem}
                  onClick={commands.retry}
                >
                  Повтори същото потвърждение
                </Button>
              )}
            {current.kind !== "committed" && (
              <Button
                variant="outline"
                disabled={busy || submission?.associationProblem}
                onClick={commands.clear}
              >
                Изчисти този опит
              </Button>
            )}
            {current.kind === "committed" && current.receipt && (
              <Button onClick={commands.openConfirmation}>
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
          <ServicesStep />
        ) : (state.step === "details" || state.step === "review") &&
          business ? (
          <DetailsStep business={business} />
        ) : state.step === "time" && business ? (
          <TimeStep timeZone={business.timeZone} />
        ) : (
          <SpecialistStep />
        )}
      </fieldset>
    </main>
  );
}
