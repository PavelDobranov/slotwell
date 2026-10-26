import { ChevronUp } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";

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
import {
  formatServicePrice,
  formatTotalPrice,
} from "@/app/_lib/booking/format";
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
  action,
}: {
  action: ReactNode;
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
    <Card className="shadow-none [--card-spacing:--spacing(6)]">
      <CardHeader className="hidden lg:grid">
        <h2 className="text-lg font-semibold">Вашата резервация</h2>
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
                    {formatServicePrice(service.priceCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Separator />
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
        <div
          className="flex flex-col gap-2 rounded-xl bg-muted px-4 py-3.5"
          aria-live="polite"
        >
          <p className="flex flex-wrap items-center justify-between gap-2 font-semibold">
            <span>Общо · {totals?.durationMinutes ?? 0} мин</span>
            <span className="font-heading text-xl tabular-nums">
              {formatTotalPrice({
                priceCents: totals?.priceCents ?? 0,
                hasVariablePrice: totals?.hasVariablePrice ?? false,
              })}
            </span>
          </p>
          <p className="text-sm text-muted-foreground">Плащане на място.</p>
        </div>
        {salon !== null && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Място
            </span>
            <p>
              Място: {state.step === "details" && `${salon.name}, `}
              {salon.address}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
  return (
    <>
      <aside
        aria-label="Вашата резервация"
        className="min-w-0 lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1 lg:row-span-2"
      >
        <div className="hidden lg:block">{card}</div>
        <Sheet open={open} onOpenChange={setOpen}>
          <div className="border-t bg-card px-4 pt-2 lg:hidden">
            <SheetTrigger
              render={
                <Button
                  variant="outline"
                  aria-label="Обобщение — Виж избора"
                  aria-describedby="booking-running-total"
                  className="h-auto min-h-12 w-full justify-between gap-3 border-0 px-0 py-2 text-left whitespace-normal"
                />
              }
              onClick={() => {
                editing.current = false;
              }}
            >
              <span
                id="booking-running-total"
                className="flex min-w-0 flex-col gap-1 tabular-nums"
                aria-live="polite"
              >
                <span>
                  {selected.length === 0
                    ? "Няма избрани услуги"
                    : `${selected.length} ${selected.length === 1 ? "услуга" : "услуги"} · ${totals?.durationMinutes ?? 0} мин`}
                </span>
                <span className="text-sm font-normal text-muted-foreground">
                  {formatTotalPrice({
                    priceCents: totals?.priceCents ?? 0,
                    hasVariablePrice: totals?.hasVariablePrice ?? false,
                  })}
                  {state.start !== null && (
                    <>
                      {" "}
                      · {formatBusinessDate(businessDateAt(state.start))} ·{" "}
                      {formatBusinessTime(state.start)}
                    </>
                  )}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-primary">
                Обобщение{" "}
                <ChevronUp aria-hidden="true" data-icon="inline-end" />
              </span>
            </SheetTrigger>
          </div>
          <SheetContent
            side="bottom"
            className="max-h-[78dvh] overflow-y-auto rounded-t-[22px]"
            finalFocus={() =>
              editing.current ? document.getElementById("step-heading") : true
            }
          >
            <SheetHeader className="pr-16">
              <SheetTitle>Вашата резервация</SheetTitle>
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
      <fieldset
        aria-label="Действия по резервацията"
        className="flex min-w-0 flex-col gap-2 bg-card px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] lg:col-start-1 lg:row-start-2 lg:items-end lg:bg-transparent lg:p-0"
      >
        {action}
      </fieldset>
    </>
  );
}
