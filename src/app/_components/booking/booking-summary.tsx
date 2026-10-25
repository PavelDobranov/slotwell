import { ChevronUp } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/app/_components/button";
import { Card, CardContent, CardHeader } from "@/app/_components/card";
import { Separator } from "@/app/_components/separator";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/app/_components/sheet";
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
  const [open, setOpen] = useState(false);
  const editing = useRef(false);
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
            onClick={() => {
              editing.current = true;
              setOpen(false);
              onEdit(step);
            }}
            aria-label={editLabel}
          >
            Промени
          </Button>
        )}
      </div>
    );
  }
  const card = (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardHeader className="hidden lg:grid">
        <h2 className="text-base font-semibold">Твоят избор</h2>
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
            <p className="text-muted-foreground">Предстои — стъпка 2</p>
          ) : (
            <p>{salon?.staff.find(({ id }) => id === state.staffId)?.name}</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          {sectionHeading("time", "Дата и час", "Промени датата и часа")}
          {state.start === null ? (
            <p className="text-muted-foreground">Предстои — стъпка 2</p>
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
  );
  return (
    <aside aria-label="Твоят избор" className="min-w-0 lg:sticky lg:top-6">
      <div className="hidden lg:block">{card}</div>
      <Sheet open={open} onOpenChange={setOpen}>
        <div className="fixed inset-x-0 bottom-0 border-t bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-sm lg:hidden">
          <SheetTrigger
            render={
              <Button
                variant="outline"
                className="min-h-11 w-full justify-between"
              />
            }
            onClick={() => {
              editing.current = false;
            }}
          >
            <span className="tabular-nums">
              {totals?.durationMinutes ?? 0} мин ·{" "}
              {euros.format((totals?.priceCents ?? 0) / 100)}
            </span>
            <span className="flex items-center gap-2">
              Виж избора <ChevronUp aria-hidden="true" data-icon="inline-end" />
            </span>
          </SheetTrigger>
        </div>
        <SheetContent
          side="bottom"
          className="max-h-[90dvh] overflow-y-auto rounded-t-2xl"
          finalFocus={() =>
            editing.current ? document.getElementById("step-heading") : true
          }
        >
          <SheetHeader className="pr-16">
            <SheetTitle>Твоят избор</SheetTitle>
            <SheetDescription>
              Всички часове са местни за салона в София (Europe/Sofia).
            </SheetDescription>
          </SheetHeader>
          <div className="px-4">{card}</div>
          <SheetFooter>
            <SheetClose
              render={<Button variant="outline" className="min-h-11" />}
            >
              Затвори
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </aside>
  );
}
