"use client";

import { TriangleAlertIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/app/_components/alert";
import { Button } from "@/app/_components/button";
import { Skeleton } from "@/app/_components/skeleton";
import { CatalogApiError } from "@/app/_features/booking/api";
import { useBooking } from "@/app/_features/booking/context";
import { DetailsStep } from "@/app/_features/booking/details/details-step";
import { ServicesStep } from "@/app/_features/booking/services/services-step";
import { SpecialistStep } from "@/app/_features/booking/specialist/specialist-step";
import { BookingRecovery } from "@/app/_features/booking/submission/recovery";
import { TimeStep } from "@/app/_features/booking/time-selection/time-step";

function loadErrorMessage(error: unknown): string {
  if (error instanceof CatalogApiError && error.code === "network")
    return "Няма връзка със сървъра. Провери връзката си и опитай отново.";
  return "Нещо се обърка при зареждането. Опитай отново.";
}

export function BookingFlow() {
  const { state, catalog, busy, draftLocked } = useBooking();
  const business = catalog.data?.business;

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
      <BookingRecovery />
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
