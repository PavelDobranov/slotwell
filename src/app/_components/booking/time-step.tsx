import { useState } from "react";

import { Button } from "@/app/_components/button";
import {
  type AvailabilityInput,
  availableSlots,
} from "@/app/_lib/booking/availability";
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
}: {
  availability: Omit<AvailabilityInput, "date">;
  start: number | null;
  selectedDate: string | null;
  onDate: (date: string) => void;
  onSelect: (start: number) => void;
  onNext: () => void;
  onEditServices: () => void;
}) {
  const today = businessDateAt(availability.now);
  const dates = Array.from({ length: 61 }, (_, index) =>
    addCalendarDays(today, index),
  );
  const date =
    selectedDate !== null && selectedDate >= today && selectedDate <= dates[60]
      ? selectedDate
      : today;
  const [exhaustedDate, setExhaustedDate] = useState<string | null>(null);
  const slots = availableSlots({ ...availability, date });
  function chooseDate(value: string) {
    setExhaustedDate(null);
    onDate(value);
  }
  function nextAvailableDate() {
    const next = dates.find(
      (candidate) =>
        candidate > date &&
        availableSlots({ ...availability, date: candidate }).length > 0,
    );
    if (next) chooseDate(next);
    else setExhaustedDate(date);
  }
  return (
    <>
      <label htmlFor="visit-date" className="font-medium">
        Дата на посещението
      </label>
      <select
        id="visit-date"
        value={date}
        onChange={(event) => chooseDate(event.target.value)}
        className="min-h-11 w-full min-w-0 rounded-md border border-input bg-background p-3 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {dates.map((value) => (
          <option key={value} value={value}>
            {formatBusinessDate(value)}
          </option>
        ))}
      </select>
      <fieldset className="min-w-0">
        <legend className="mb-3 font-medium">Свободни начални часове</legend>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {slots.map((slot) => (
            <label
              key={slot.start}
              className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border px-2 has-[:checked]:border-primary has-[:checked]:bg-secondary"
            >
              <input
                type="radio"
                name="start-time"
                value={slot.start}
                checked={start === slot.start}
                onChange={() => onSelect(slot.start)}
                className="size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
              {formatBusinessTime(slot.start)}
            </label>
          ))}
        </div>
      </fieldset>
      {slots.length === 0 && (
        <>
          <output>Няма свободни часове за тази дата.</output>
          {exhaustedDate === date || date === dates[60] ? (
            <output>
              Няма по-късна свободна дата в следващите 60 дни. Избери друга
              дата, специалист или услуги.
            </output>
          ) : (
            <Button
              variant="outline"
              className="self-start"
              onClick={nextAvailableDate}
            >
              Следваща свободна дата
            </Button>
          )}
          <Button
            variant="outline"
            className="self-start"
            onClick={onEditServices}
          >
            Промени избора на услуги
          </Button>
        </>
      )}
      <Button
        className="self-start"
        disabled={!slots.some((slot) => slot.start === start)}
        onClick={onNext}
      >
        Продължи
      </Button>
    </>
  );
}
