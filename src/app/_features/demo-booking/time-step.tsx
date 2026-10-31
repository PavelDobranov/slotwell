import {
  CalendarXIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/app/_components/alert";
import { Button } from "@/app/_components/button";
import {
  type AvailabilityInput,
  availableSlots,
} from "@/app/_features/demo-booking/availability";
import { DayStrip } from "@/app/_features/demo-booking/day-strip";
import { serviceTotals } from "@/app/_features/demo-booking/fixtures";
import {
  addCalendarDays,
  businessDateAt,
  businessWeekday,
  formatBusinessDate,
  formatBusinessMonthRange,
  formatBusinessTime,
  formatBusinessWeekdayDate,
} from "@/app/_features/demo-booking/time";
import { TimeSlots } from "@/app/_features/demo-booking/time-slots";
import type { Weekday } from "@/app/_features/demo-booking/types";
import { formatDuration } from "@/app/_lib/duration";

export function TimeStep({
  availability,
  start,
  selectedDate,
  onDate,
  onSelect,
  onNext,
  onEditServices,
  onEditStaff,
  loading = false,
  showPrimaryAction = true,
}: {
  showPrimaryAction?: boolean;
  availability: Omit<AvailabilityInput, "date">;
  start: number | null;
  selectedDate: string | null;
  onDate: (date: string) => void;
  onSelect: (start: number) => void;
  onNext: () => void;
  onEditServices: () => void;
  onEditStaff: () => void;
  loading?: boolean;
}) {
  const today = businessDateAt(availability.now);
  const lastDate = addCalendarDays(today, 60);
  const date =
    selectedDate !== null && selectedDate >= today && selectedDate <= lastDate
      ? selectedDate
      : today;
  const { salon, now, serviceIds, staffId, sessionOccupied } = availability;
  // Evaluate visible days and opened calendar months, not the whole horizon
  // on every selection. Reuse results within each availability snapshot.
  const slotsForDate = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof availableSlots>>();
    return (date: string) => {
      let slots = cache.get(date);
      if (!slots) {
        slots = availableSlots({
          salon,
          now,
          serviceIds,
          staffId,
          sessionOccupied,
          date,
        });
        cache.set(date, slots);
      }
      return slots;
    };
  }, [salon, now, serviceIds, staffId, sessionOccupied]);
  const days = Array.from({ length: 61 }, (_, index) => {
    const value = addCalendarDays(today, index);
    return {
      date: value,
      open: salon.hours[businessWeekday(value) as Weekday].length > 0,
    };
  });
  const selectedIndex = days.findIndex((day) => day.date === date);
  // Paging never changes the booking. A new chosen date (including calendar and
  // recovery selections) resets the visible page without an effect/focus jump.
  const [page, setPage] = useState({
    date,
    today,
    offset: Math.floor(selectedIndex / 7) * 7,
  });
  const offset =
    page.date === date && page.today === today
      ? page.offset
      : Math.floor(selectedIndex / 7) * 7;
  if (page.date !== date || page.today !== today) {
    setPage({ date, today, offset });
  }
  const slots = slotsForDate(date);
  const nextDay =
    !loading && slots.length === 0
      ? days.find((day) => day.date > date && slotsForDate(day.date).length > 0)
      : undefined;
  const duration = serviceTotals(
    salon.services.filter((service) => serviceIds.includes(service.id)),
  ).durationMinutes;
  const staff = salon.staff.find((staff) => staff.id === staffId);
  const selected = slots.find((slot) => slot.start === start);
  const monthLabel = formatBusinessMonthRange(
    days[offset].date,
    days[Math.min(offset + 6, 60)].date,
  );
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-heading text-xl leading-[26px] font-semibold">
          {staff
            ? `Свободни часове при ${staff.name.split(" ")[0]}`
            : "Изберете дата и час"}
        </h3>
        <p className="text-sm text-muted-foreground">Часове по София (EET)</p>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-medium" aria-live="polite">
          {monthLabel}
        </p>
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Предишни дни"
            className="h-18 shrink-0 bg-card disabled:text-unavailable disabled:opacity-100"
            disabled={loading || offset === 0}
            onClick={() =>
              setPage({ date, today, offset: Math.max(0, offset - 7) })
            }
          >
            <ChevronLeftIcon />
          </Button>
          <DayStrip
            days={days.slice(offset, offset + 7).map((day) => ({
              date: day.date,
              count: slotsForDate(day.date).length,
              open: day.open,
            }))}
            today={today}
            date={date}
            onDate={onDate}
            disabled={loading}
          />
          <Button
            variant="outline"
            size="icon"
            aria-label="Следващи дни"
            className="h-18 shrink-0 bg-card disabled:text-unavailable disabled:opacity-100"
            disabled={loading || offset + 7 > 60}
            onClick={() => setPage({ date, today, offset: offset + 7 })}
          >
            <ChevronRightIcon />
          </Button>
        </div>
      </div>
      {loading || slots.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-3">
          <h4 className="font-heading text-base leading-6 font-semibold">
            {formatBusinessWeekdayDate(date)}
          </h4>
          <TimeSlots
            slots={slots}
            date={date}
            start={start}
            onSelect={onSelect}
            loading={loading}
          />
          {selected && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <ClockIcon aria-hidden="true" className="size-4 shrink-0" />
              <span>
                Избрахте{" "}
                <strong className="font-semibold tabular-nums text-foreground">
                  {formatBusinessTime(selected.start)}–
                  {formatBusinessTime(selected.end)}
                </strong>{" "}
                · {formatDuration(duration)}
              </span>
            </p>
          )}
        </div>
      ) : (
        <Alert role="status" className="gap-y-3 rounded-card p-5">
          <CalendarXIcon aria-hidden="true" />
          <AlertTitle className="font-heading text-[17px] leading-[23px]">
            <output>Няма свободни часове за тази дата.</output>
          </AlertTitle>
          <AlertDescription>
            {staff ? `${staff.name} няма` : "Няма"} {duration} последователни
            свободни минути на {formatBusinessDate(date)}.
          </AlertDescription>
          <div className="col-span-full flex flex-wrap gap-2">
            {nextDay ? (
              <Button
                variant="outline"
                className="h-auto min-h-14 max-w-full whitespace-normal py-2 text-left"
                onClick={() => onDate(nextDay.date)}
              >
                Към {formatBusinessDate(nextDay.date)} · първи час{" "}
                {formatBusinessTime(slotsForDate(nextDay.date)[0].start)}
              </Button>
            ) : (
              <output className="text-sm text-muted-foreground">
                Няма по-късна свободна дата в следващите 60 дни. Избери друга
                дата, специалист или услуги.
              </output>
            )}
            <Button variant="outline" onClick={onEditStaff}>
              Смени специалиста
            </Button>
          </div>
          <Button
            variant="link"
            className="col-span-full justify-self-start"
            onClick={onEditServices}
          >
            Промени избора на услуги
          </Button>
        </Alert>
      )}
      <p className="text-sm text-muted-foreground">
        След това: {staffId ? "вашите данни" : "специалист"}. Можете да смените
        реда по всяко време.
      </p>
      {showPrimaryAction && (
        <Button
          className="self-end"
          disabled={loading || !slots.some((slot) => slot.start === start)}
          onClick={onNext}
        >
          Продължи
        </Button>
      )}
    </div>
  );
}
