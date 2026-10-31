"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { type Dispatch, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/app/_components/alert";
import { Button } from "@/app/_components/button";
import { RadioGroup, RadioGroupItem } from "@/app/_components/radio-group";
import { Skeleton } from "@/app/_components/skeleton";
import { fetchAvailability } from "@/app/_lib/booking/api";
import {
  availabilitySelectionKey,
  type PersistedAction,
  type PersistedState,
} from "@/app/_lib/booking/persisted-state";
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

export function PersistedTime({
  state,
  timeZone,
  dispatch,
  disabled = false,
}: {
  state: PersistedState;
  timeZone: string;
  disabled?: boolean;
  dispatch: Dispatch<PersistedAction>;
}) {
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
      <RadioGroup
        disabled={disabled}
        aria-label="Дати"
        value={visibleDate}
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        onValueChange={(date) => {
          if (typeof date === "string") dispatch({ type: "date", date });
        }}
      >
        {Array.from({ length: 7 }, (_, index) =>
          addCalendarDays(page.from, index),
        ).map((date) => (
          <label
            key={date}
            htmlFor={`date-${date}`}
            className="flex min-h-14 cursor-pointer items-center gap-2 rounded-card border border-border bg-card p-3 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 has-data-checked:border-primary has-data-checked:bg-selected"
          >
            <RadioGroupItem id={`date-${date}`} value={date} />
            <span className="text-sm">{dateLabel(date)}</span>
          </label>
        ))}
      </RadioGroup>
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
        <RadioGroup
          disabled={disabled}
          aria-label={`Часове за ${dateLabel(visibleDate)}`}
          value={state.slot?.date === visibleDate ? state.slot.start : null}
          className="grid grid-cols-2 gap-2 sm:grid-cols-3"
          onValueChange={(start) => {
            const slot = slots.find((slot) => slot.start === start);
            if (slot)
              dispatch({
                type: "slot",
                selectionKey,
                catalogTimingKey: state.catalogTimingKey,
                slot: { ...slot, date: visibleDate, timeZone: zone },
              });
          }}
        >
          {slots.map((slot) => (
            <label
              key={slot.start}
              htmlFor={`slot-${slot.start}`}
              className="flex min-h-14 cursor-pointer items-center gap-2 rounded-card border border-border bg-card p-3 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 has-data-checked:border-primary has-data-checked:bg-selected"
            >
              <RadioGroupItem id={`slot-${slot.start}`} value={slot.start} />
              <span className="text-sm font-medium whitespace-nowrap tabular-nums">
                {range(slot)}
              </span>
            </label>
          ))}
        </RadioGroup>
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
