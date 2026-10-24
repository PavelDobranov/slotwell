import { CalendarIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/app/_components/button";
import { Calendar } from "@/app/_components/calendar";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/app/_components/popover";

// DayPicker uses browser-local Date carriers, not salon instants. Never use
// toISOString() here: visitors may be in a different timezone from Sofia.
function calendarDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}
function dateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function DatePopover({
  today,
  lastDate,
  date,
  isDateAvailable,
  onDate,
  disabled = false,
}: {
  today: string;
  lastDate: string;
  date: string;
  isDateAvailable: (date: string) => boolean;
  onDate: (date: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger disabled={disabled} render={<Button variant="outline" />}>
        <CalendarIcon data-icon="inline-start" />
        Календар
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 max-sm:w-[calc(100vw-2rem)]">
        <PopoverTitle className="sr-only">Избери дата</PopoverTitle>
        <Calendar
          className="mx-auto max-sm:p-0"
          mode="single"
          autoFocus
          required
          defaultMonth={calendarDate(date)}
          selected={calendarDate(date)}
          today={calendarDate(today)}
          startMonth={calendarDate(today)}
          endMonth={calendarDate(lastDate)}
          disabled={(day) => !isDateAvailable(dateKey(day))}
          onSelect={(day) => {
            if (!day || !isDateAvailable(dateKey(day))) return;
            onDate(dateKey(day));
            setOpen(false);
          }}
        />
        <PopoverDescription>
          Запазване от 1 час до 60 дни напред. Неактивните дни нямат свободни
          часове.
        </PopoverDescription>
      </PopoverContent>
    </Popover>
  );
}
