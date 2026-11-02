"use client";

import { Check, TriangleAlertIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/app/_components/alert";
import { Button } from "@/app/_components/button";
import { RadioGroup } from "@/app/_components/radio-group";
import { Skeleton } from "@/app/_components/skeleton";
import { CatalogApiError } from "@/app/_features/booking/api";
import { useBooking } from "@/app/_features/booking/context";
import { SpecialistOption } from "@/app/_features/booking/specialist/specialist-option";

export function SpecialistStep() {
  const {
    state,
    dispatch,
    staff,
    selectedServices,
    selectedStaff,
    draftLocked,
  } = useBooking();

  return (
    <section aria-labelledby="staff-heading" className="flex flex-col gap-4">
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
        Избрани услуги: {selectedServices.map(({ name }) => name).join(", ")}.
        Изберете кой да ги извърши — изборът е ваш дори когато е възможен само
        един специалист.
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
            <p>
              {staff.error instanceof CatalogApiError &&
              staff.error.code === "network"
                ? "Няма връзка със сървъра. Провери връзката си и опитай отново."
                : "Нещо се обърка при зареждането. Опитай отново."}
            </p>
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
          {staff.data.map((member) => (
            <SpecialistOption
              key={member.id}
              member={member}
              selected={state.staffId === member.id}
            />
          ))}
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
  );
}
