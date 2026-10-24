import { TriangleAlertIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/app/_components/alert";
import { SpecialistOption } from "@/app/_components/booking/specialist-option";
import { Button } from "@/app/_components/button";
import {
  FieldDescription,
  FieldLegend,
  FieldSet,
} from "@/app/_components/field";
import { RadioGroup } from "@/app/_components/radio-group";
import { qualifiedStaff } from "@/app/_lib/booking/availability";
import type { DemoSalon } from "@/app/_lib/booking/types";

export function SpecialistStep({
  salon,
  serviceIds,
  staffId,
  availableStaffIds,
  onSelect,
  onNext,
  onEditServices,
  onServices,
  onEditTime,
}: {
  salon: DemoSalon;
  serviceIds: readonly string[];
  staffId: string | null;
  availableStaffIds?: readonly string[];
  onSelect: (id: string) => void;
  onNext: () => void;
  onEditServices: () => void;
  onServices: (ids: string[]) => void;
  onEditTime: () => void;
}) {
  const qualified = qualifiedStaff(salon, serviceIds);
  const eligible = qualified.filter(
    ({ id }) =>
      availableStaffIds === undefined || availableStaffIds.includes(id),
  );
  const selectedServices = salon.services.filter(({ id }) =>
    serviceIds.includes(id),
  );
  const noCoverage = qualified.length === 0;
  // Only offer a removal when it alone makes this combination bookable.
  const fixes = selectedServices.filter(({ id }) => {
    const remaining = serviceIds.filter((serviceId) => serviceId !== id);
    return remaining.length > 0 && qualifiedStaff(salon, remaining).length > 0;
  });

  return (
    <>
      <FieldDescription id="specialists-description">
        {availableStaffIds === undefined
          ? "Показваме кой може да направи всички избрани услуги. Свободните часове ще видиш в следващата стъпка."
          : "Избери специалист, свободен за цялото посещение в избрания час, включително времето за подготовка след услугите."}{" "}
        Изборът е задължителен дори когато има само един специалист.
      </FieldDescription>
      {noCoverage && (
        <Alert variant="warning" className="gap-x-3 px-4 py-3.5">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>
            Никой специалист не прави всички избрани услуги заедно
          </AlertTitle>
          <AlertDescription className="col-start-2 flex min-w-0 flex-col gap-3">
            <p>
              {salon.staff
                .map((member) => {
                  const covered = selectedServices.filter(({ id }) =>
                    member.serviceIds.includes(id),
                  );
                  const missing = selectedServices.filter(
                    ({ id }) => !member.serviceIds.includes(id),
                  );
                  return `${member.name}: ${covered.length ? `прави ${covered.map(({ name }) => name).join(", ")}, но не и` : "не прави"} ${missing.map(({ name }) => name).join(", ")}.`;
                })
                .join(" ")}
            </p>
            <div className="flex flex-wrap gap-2">
              {fixes.map((service) => (
                <Button
                  key={service.id}
                  variant="outline"
                  className="h-auto min-h-10 whitespace-normal text-left"
                  onClick={() =>
                    onServices(serviceIds.filter((id) => id !== service.id))
                  }
                >
                  Махни „{service.name}“
                </Button>
              ))}
              <Button variant="link" onClick={onEditServices}>
                Към услугите
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      <FieldSet className="min-w-0 gap-2">
        <FieldLegend className="sr-only">Избери специалист</FieldLegend>
        <RadioGroup
          aria-label="Специалисти"
          aria-describedby="specialists-description"
          value={eligible.some(({ id }) => id === staffId) ? staffId : null}
          onValueChange={(id) => {
            if (
              typeof id === "string" &&
              eligible.some((member) => member.id === id)
            )
              onSelect(id);
          }}
        >
          {salon.staff.map((member) => {
            const missing = selectedServices.filter(
              ({ id }) => !member.serviceIds.includes(id),
            );
            const reason =
              missing.length > 0
                ? `Не прави: ${missing.map(({ name }) => name).join(", ")}`
                : !eligible.some(({ id }) => id === member.id)
                  ? "Не е свободен за цялото посещение в избрания час"
                  : undefined;
            return (
              <SpecialistOption
                key={member.id}
                member={member}
                services={salon.services
                  .filter(({ id }) => member.serviceIds.includes(id))
                  .map(({ name }) => name)
                  .join(" · ")}
                selected={!reason && staffId === member.id}
                reason={reason}
              />
            );
          })}
        </RadioGroup>
      </FieldSet>
      {!noCoverage && eligible.length === 0 && (
        <Alert variant="warning">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>Няма свободен специалист за избрания час</AlertTitle>
          <AlertDescription className="col-start-2 flex flex-wrap gap-2">
            <Button variant="outline" onClick={onEditTime}>
              Към дата и час
            </Button>
            <Button variant="link" onClick={onEditServices}>
              Към услугите
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <Button
        className="self-end"
        disabled={!eligible.some(({ id }) => id === staffId)}
        onClick={onNext}
      >
        Продължи
      </Button>
    </>
  );
}
