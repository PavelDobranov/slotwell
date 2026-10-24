import { Button } from "@/app/_components/button";
import { Card, CardContent, CardHeader } from "@/app/_components/card";
import { Separator } from "@/app/_components/separator";
import { euros } from "@/app/_lib/booking/format";
import {
  type BookingState,
  type BookingStep,
  selectedTotals,
  stepOrder,
} from "@/app/_lib/booking/state";
import {
  businessDateAt,
  formatBusinessDate,
  formatBusinessTime,
} from "@/app/_lib/booking/time";
import type { DemoSalon } from "@/app/_lib/booking/types";

export function BookingSummary({
  salon,
  state,
  confirmed,
  onEdit,
}: {
  salon: DemoSalon | null;
  state: BookingState;
  confirmed: boolean;
  onEdit: (step: BookingStep) => void;
}) {
  const selected =
    salon?.services.filter(({ id }) => state.serviceIds.includes(id)) ?? [];
  const totals = salon === null ? null : selectedTotals(state, salon);
  const order = stepOrder(state.path);
  const canEdit = (step: BookingStep) =>
    !confirmed && order.indexOf(step) < order.indexOf(state.step);
  function sectionHeading(step: BookingStep, label: string, editLabel: string) {
    return (
      <div className="flex min-h-8 items-center justify-between gap-2">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </span>
        {canEdit(step) && (
          <Button
            variant="link"
            size="sm"
            onClick={() => onEdit(step)}
            aria-label={editLabel}
          >
            Промени
          </Button>
        )}
      </div>
    );
  }
  return (
    <aside
      aria-labelledby="summary-heading"
      className="min-w-0 lg:sticky lg:top-6"
    >
      <Card className="[--card-spacing:--spacing(5)]">
        <CardHeader>
          <h2 id="summary-heading" className="text-base font-semibold">
            Твоят избор
          </h2>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            {sectionHeading("services", "Услуги", "Промени услугите")}
            {selected.length === 0 ? (
              <p className="text-muted-foreground">
                Все още няма избрани услуги.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {selected.map((service) => (
                  <li
                    key={service.id}
                    className="flex flex-wrap justify-between gap-x-3 gap-y-1"
                  >
                    <span>{service.name}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {service.durationMinutes} мин ·{" "}
                      {euros.format(service.priceCents / 100)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Separator />
          <p
            className="flex flex-wrap justify-between gap-2 font-semibold"
            aria-live="polite"
          >
            <span>Общо:</span>
            <span className="tabular-nums">
              {totals?.durationMinutes ?? 0} мин ·{" "}
              {euros.format((totals?.priceCents ?? 0) / 100)}
            </span>
          </p>
          <div className="flex flex-col gap-1">
            {sectionHeading("staff", "Специалист", "Промени специалиста")}
            {state.staffId === null ? (
              <p className="text-muted-foreground">
                Предстои — стъпка {order.indexOf("staff") + 1}
              </p>
            ) : (
              <p>{salon?.staff.find(({ id }) => id === state.staffId)?.name}</p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            {sectionHeading("time", "Дата и час", "Промени датата и часа")}
            {state.start === null ? (
              <p className="text-muted-foreground">
                Предстои — стъпка {order.indexOf("time") + 1}
              </p>
            ) : (
              <p className="tabular-nums">
                {formatBusinessDate(businessDateAt(state.start))} ·{" "}
                {formatBusinessTime(state.start)}–
                {formatBusinessTime(
                  state.start + (totals?.durationMinutes ?? 0) * 60_000,
                )}
              </p>
            )}
          </div>
          {(state.step === "details" || confirmed) && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Място
              </span>
              <p>
                Място: {salon?.name}, {salon?.address}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </aside>
  );
}
