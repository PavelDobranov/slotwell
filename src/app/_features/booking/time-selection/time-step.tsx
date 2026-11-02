"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/app/_components/alert";
import { Button } from "@/app/_components/button";
import { Skeleton } from "@/app/_components/skeleton";
import { fetchAvailability } from "@/app/_features/booking/api";
import {
  availabilitySelectionKey,
  useBooking,
} from "@/app/_features/booking/context";
import { TimeOptions } from "@/app/_features/booking/time-selection/time-options";
import { addCalendarDays } from "@/shared/booking-time";

function dateAt(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const part = (type: string) =>
    parts.find((part) => part.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

// Civil dates are calendar labels, not midnight instants in the device zone.
function dateLabel(date: string): string {
  return new Intl.DateTimeFormat("bg-BG", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "long",
  }).format(new Date(`${date}T00:00:00Z`));
}

export function TimeStep({ timeZone }: { timeZone: string }) {
  const { state, dispatch, draftLocked: disabled } = useBooking();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const [page, setPage] = useState(() => ({
    from: state.date ?? dateAt(new Date().toISOString(), timeZone),
    browsed: false,
  }));
  const to = addCalendarDays(page.from, 6);
  const selectionKey = availabilitySelectionKey(
    state.serviceIds,
    state.staffId,
  );
  const query = useQuery({
    queryKey: [
      "availability",
      selectionKey,
      state.catalogTimingKey,
      page.from,
      to,
    ],
    queryFn: ({ signal }) =>
      fetchAvailability(
        {
          staffId: state.staffId ?? "",
          serviceIds: state.serviceIds,
          from: page.from,
          to,
        },
        signal,
      ),
    enabled: state.staffId !== null,
    staleTime: 0,
    retry: false,
  });
  const ready =
    query.isSuccess && !query.isFetching && query.isFetchedAfterMount;
  useEffect(() => {
    // Cached success, failed refreshes and pages for another selection are not
    // evidence that the selected time disappeared.
    if (!ready) return;
    dispatch({
      type: "availability",
      selectionKey,
      catalogTimingKey: state.catalogTimingKey,
      days: query.data.days,
    });
    if (!page.browsed && state.date === null) {
      const serverDate = dateAt(query.data.serverNow, query.data.timeZone);
      if (serverDate !== page.from)
        setPage({ from: serverDate, browsed: false });
    }
  }, [
    ready,
    query.data,
    selectionKey,
    dispatch,
    page.browsed,
    page.from,
    state.date,
    state.catalogTimingKey,
  ]);

  const zone = query.data?.timeZone ?? timeZone;
  const clock = (instant: string) =>
    new Intl.DateTimeFormat("bg-BG", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(instant));
  const range = (slot: { start: string; end: string }) =>
    `${clock(slot.start)}–${clock(slot.end)}`;
  const visibleDate =
    state.date && state.date >= page.from && state.date <= to
      ? state.date
      : page.from;
  const slots = ready
    ? (query.data.days.find(({ date }) => date === visibleDate)?.slots ?? [])
    : [];

  return (
    <section
      aria-labelledby="time-heading"
      className="flex min-w-0 flex-col gap-4"
    >
      <h2
        ref={heading}
        tabIndex={-1}
        id="time-heading"
        className="text-xl font-semibold"
      >
        Изберете дата и час
      </h2>
      <p className="text-sm text-muted-foreground">Часова зона: {zone}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="link"
          onClick={() => dispatch({ type: "edit", step: "services" })}
        >
          Промени услугите
        </Button>
        <Button
          variant="link"
          onClick={() => dispatch({ type: "edit", step: "staff" })}
        >
          Смени специалиста
        </Button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Предишни дни"
          onClick={() =>
            setPage({ from: addCalendarDays(page.from, -7), browsed: true })
          }
        >
          <ChevronLeftIcon />
        </Button>
        <p className="text-center text-sm" aria-live="polite">
          {dateLabel(page.from)} – {dateLabel(to)}
        </p>
        <Button
          variant="outline"
          size="icon"
          aria-label="Следващи дни"
          onClick={() =>
            setPage({ from: addCalendarDays(page.from, 7), browsed: true })
          }
        >
          <ChevronRightIcon />
        </Button>
      </div>
      <TimeOptions
        disabled={disabled}
        label="Дати"
        idPrefix="date"
        value={visibleDate}
        options={Array.from({ length: 7 }, (_, index) => {
          const date = addCalendarDays(page.from, index);
          return { value: date, label: dateLabel(date) };
        })}
        onSelect={(date) => dispatch({ type: "date", date })}
      />
      {query.isFetching || query.isPending ? (
        <output aria-busy="true" className="flex flex-col gap-2">
          <span className="sr-only">Зареждаме свободните часове…</span>
          <Skeleton className="h-18 w-full" />
        </output>
      ) : query.isError ? (
        <Alert variant="error">
          <AlertTitle>Неуспешно зареждане на часовете</AlertTitle>
          <AlertDescription>
            Изборът ви е запазен. Опитайте отново.
          </AlertDescription>
          <Button variant="outline" onClick={() => query.refetch()}>
            Опитай отново
          </Button>
        </Alert>
      ) : slots.length === 0 ? (
        <Alert role="status">
          <AlertTitle>Няма свободни часове за тази дата.</AlertTitle>
          <AlertDescription>
            Изберете друга дата, специалист или услуги.
          </AlertDescription>
        </Alert>
      ) : (
        <TimeOptions
          disabled={disabled}
          label={`Часове за ${dateLabel(visibleDate)}`}
          idPrefix="slot"
          value={state.slot?.date === visibleDate ? state.slot.start : null}
          options={slots.map((slot) => ({
            value: slot.start,
            label: range(slot),
          }))}
          onSelect={(start) => {
            const slot = slots.find((slot) => slot.start === start);
            if (slot)
              dispatch({
                type: "slot",
                selectionKey,
                catalogTimingKey: state.catalogTimingKey,
                slot: { ...slot, date: visibleDate, timeZone: zone },
              });
          }}
        />
      )}
      <Button
        variant="outline"
        className="self-start"
        disabled={query.isFetching}
        onClick={() => query.refetch()}
      >
        Обнови часовете
      </Button>
      {state.slot && (
        <output className="text-sm">
          Избраният час е предварителен: {dateLabel(state.slot.date)},{" "}
          {range(state.slot)} ({zone}). Ще бъде проверен отново при
          потвърждение.
        </output>
      )}
      <Button
        className="self-end"
        disabled={
          !ready ||
          !state.slot ||
          state.slotSelectionKey !== selectionKey ||
          state.slotTimingKey !== state.catalogTimingKey
        }
        onClick={() => dispatch({ type: "next" })}
      >
        Продължи към данните
      </Button>
    </section>
  );
}
