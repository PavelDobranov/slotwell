"use client";

import { useEffect, useRef } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/app/_components/alert";
import { Button } from "@/app/_components/button";
import { useBooking } from "@/app/_features/booking/context";
import { recoveryPermissions } from "@/app/_features/booking/submission/recovery-permissions";

/** Connected recovery UI. Every action delegates to the existing binding. */
export function BookingRecovery() {
  const { submission, busy, commands } = useBooking();
  const current = submission?.booking.current;
  const problem = submission?.booking.problem;
  const permissions = recoveryPermissions(current, busy);
  const { needsRecovery } = permissions;
  const recoveryHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (recoveryPermissions(current, busy).focusNotice)
      recoveryHeading.current?.focus();
  }, [current, busy]);

  return (
    <>
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
            {permissions.canRecover && (
              <Button
                variant="outline"
                disabled={busy || submission?.associationProblem}
                onClick={commands.recover}
              >
                Провери резултата
              </Button>
            )}
            {permissions.canRetry && (
              <Button
                disabled={busy || submission?.associationProblem}
                onClick={commands.retry}
              >
                Повтори същото потвърждение
              </Button>
            )}
            {permissions.canClear && (
              <Button
                variant="outline"
                disabled={busy || submission?.associationProblem}
                onClick={commands.clear}
              >
                Изчисти този опит
              </Button>
            )}
            {permissions.canOpenConfirmation && (
              <Button onClick={commands.openConfirmation}>
                Отвори потвърждението
              </Button>
            )}
          </div>
        </section>
      )}
    </>
  );
}
