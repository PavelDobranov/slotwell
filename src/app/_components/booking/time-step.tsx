import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { DatePopover } from "@/app/_components/booking/date-popover";
import { DayStrip } from "@/app/_components/booking/day-strip";
import { TimeSlots } from "@/app/_components/booking/time-slots";
import { Button } from "@/app/_components/button";
import {
  type AvailabilityInput,
  availableSlots,
} from "@/app/_lib/booking/availability";
import { serviceTotals } from "@/app/_lib/booking/fixtures";
import {
  addCalendarDays,
  businessDateAt,
  formatBusinessDate,
  formatBusinessTime,
} from "@/app/_lib/booking/time";

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
}: {
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
  const days = Array.from({ length: 61 }, (_, index) => ({
    date: addCalendarDays(today, index),
  }));
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
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Свободни часове {staff ? `при ${staff.name}` : "при всички специалисти"}{" "}
        за посещение от {duration} мин.
      </p>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium" aria-live="polite">
              Дата · {formatBusinessDate(days[offset].date)} –{" "}
              {formatBusinessDate(days[Math.min(offset + 6, 60)].date)}
            </p>
            <p className="text-xs text-muted-foreground">
              Запазване от 1 час до 60 дни напред.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label="Предишните 7 дни"
              disabled={loading || offset === 0}
              onClick={() =>
                setPage({ date, today, offset: Math.max(0, offset - 7) })
              }
            >
              <ChevronLeftIcon />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Следващите 7 дни"
              disabled={loading || offset + 7 > 60}
              onClick={() => setPage({ date, today, offset: offset + 7 })}
            >
              <ChevronRightIcon />
            </Button>
            <DatePopover
              today={today}
              lastDate={lastDate}
              date={date}
              isDateAvailable={(value) =>
                value >= today &&
                value <= lastDate &&
                slotsForDate(value).length > 0
              }
              onDate={onDate}
              disabled={loading}
            />
          </div>
        </div>
        <DayStrip
          days={days.slice(offset, offset + 7).map((day) => ({
            date: day.date,
            count: slotsForDate(day.date).length,
          }))}
          today={today}
          date={date}
          onDate={onDate}
          disabled={loading}
        />
      </div>
      {loading || slots.length > 0 ? (
        <TimeSlots
          slots={slots}
          date={date}
          start={start}
          onSelect={onSelect}
          loading={loading}
        />
      ) : (
        <div className="flex flex-col gap-4 rounded-lg border p-5">
          <output className="font-medium">
            Няма свободни часове за тази дата.
          </output>
          <p className="text-sm text-muted-foreground">
            {staff ? `${staff.name} няма` : "Няма"} {duration} последователни
            свободни минути на {formatBusinessDate(date)}.
          </p>
          <div className="flex flex-wrap gap-2">
            {nextDay ? (
              <Button
                className="h-auto min-h-13 max-w-full whitespace-normal py-2 text-left"
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
            className="self-start"
            onClick={onEditServices}
          >
            Промени избора на услуги
          </Button>
        </div>
      )}
      <Button
        className="self-end"
        disabled={loading || !slots.some((slot) => slot.start === start)}
        onClick={onNext}
      >
        Продължи
      </Button>
    </div>
  );
}
