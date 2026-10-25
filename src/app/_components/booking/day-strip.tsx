import { CheckIcon } from "lucide-react";

import { businessWeekday, formatBusinessDate } from "@/app/_lib/booking/time";

export function DayStrip({
  days,
  today,
  date,
  onDate,
  disabled = false,
}: {
  days: { date: string; count: number }[];
  today: string;
  date: string;
  onDate: (date: string) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="sr-only">Дата на посещението</legend>
      <div className="overflow-x-auto p-1">
        <div className="flex gap-2 sm:grid sm:grid-cols-7">
          {days.map(({ date: value, count }) => (
            <label
              key={value}
              className="relative flex h-18 w-14.5 shrink-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-button border border-border bg-background px-1 py-1.5 text-foreground sm:w-auto has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:disabled]:cursor-not-allowed has-[:disabled]:border-dashed has-[:disabled]:bg-background has-[:disabled]:text-muted-foreground has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring"
            >
              <input
                type="radio"
                name="visit-date"
                value={value}
                checked={date === value}
                disabled={count === 0}
                onChange={() => onDate(value)}
                aria-label={`${formatBusinessDate(value)} · ${count > 0 ? `${count} свободни` : "Няма часове"}${value === today ? " · днес" : ""}`}
                className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
              />
              <span aria-hidden="true" className="text-xs leading-4">
                {value === today
                  ? "днес"
                  : ["нед", "пон", "вт", "ср", "чт", "пт", "съб"][
                      businessWeekday(value)
                    ]}
              </span>
              <span
                aria-hidden="true"
                className="flex items-center gap-0.5 font-heading text-[19px] leading-[22px] font-semibold tabular-nums"
              >
                {Number(value.slice(8))}
                {date === value && <CheckIcon className="size-3" />}
              </span>
              <span aria-hidden="true" className="text-[11px] leading-[14px]">
                {count > 0 ? `${count} часа` : "Заето"}
              </span>
            </label>
          ))}
        </div>
      </div>
    </fieldset>
  );
}
