import { ChevronUp } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";

import { ReservationSummaryCard } from "@/app/_components/booking/reservation-summary-card";
import { Button } from "@/app/_components/button";
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
import { formatTotalPrice } from "@/app/_features/demo-booking/format";
import {
  businessDateAt,
  formatBusinessDate,
  formatBusinessTime,
} from "@/app/_features/demo-booking/time";
import type { DemoSalon } from "@/app/_features/demo-booking/types";
import {
  type BookingState,
  type BookingStep,
  selectedTotals,
  stepOrder,
} from "@/app/_lib/booking/state";
import { formatDuration } from "@/app/_lib/duration";
import { cn } from "@/app/_lib/utils";

export function BookingSummary({
  salon,
  state,
  confirmed,
  onEdit,
  action,
  backAction,
}: {
  backAction?: ReactNode;
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
    !confirmed &&
    (state.step === "time" ||
      (state.step === "staff" &&
        (step !== "time" ||
          state.path === "time-first" ||
          state.staffId !== null)) ||
      order.indexOf(step) < order.indexOf(state.step));
  const card = (
    <ReservationSummaryCard
      services={selected}
      staffName={salon?.staff.find(({ id }) => id === state.staffId)?.name}
      start={state.start}
      durationMinutes={totals?.durationMinutes ?? 0}
      priceCents={totals?.priceCents ?? 0}
      hasVariablePrice={totals?.hasVariablePrice ?? false}
      address={salon?.address}
      canEdit={canEdit}
      onEdit={(step) => {
        editing.current = true;
        setOpen(false);
        onEdit(step);
      }}
    />
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
                    : `${selected.length} ${selected.length === 1 ? "услуга" : "услуги"} · ${formatDuration(totals?.durationMinutes ?? 0)}`}
                </span>
                <span className="text-sm font-normal text-muted-foreground">
                  {formatTotalPrice(
                    {
                      priceCents: totals?.priceCents ?? 0,
                      hasVariablePrice: totals?.hasVariablePrice ?? false,
                    },
                    true,
                  )}
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
              <SheetTitle className="sr-only">Вашата резервация</SheetTitle>
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
        className={cn(
          "flex min-w-0 flex-col gap-2 bg-card px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] lg:col-start-1 lg:row-start-2 lg:bg-transparent lg:p-0",
          backAction
            ? "lg:flex-row lg:items-center lg:justify-between"
            : "lg:items-end",
        )}
      >
        {backAction}
        {action}
      </fieldset>
    </>
  );
}
