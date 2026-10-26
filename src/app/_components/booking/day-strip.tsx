import { businessWeekday, formatBusinessDate } from "@/app/_lib/booking/time";

export function DayStrip({
  days,
  today,
  date,
  onDate,
  disabled = false,
}: {
  days: { date: string; count: number; open: boolean }[];
  today: string;
  date: string;
  onDate: (date: string) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0 flex-1">
      <legend className="sr-only">Дата на посещението</legend>
      <div className="overflow-x-auto py-1 lg:overflow-visible">
        <div className="flex gap-2 lg:grid lg:grid-cols-7">
          {days.map(({ date: value, count, open }) => {
            const closed = !open;
            const busy = open && count === 0;
            const tag = closed
              ? "почивен"
              : busy
                ? "заето"
                : value === today
                  ? "днес"
                  : "";
            const ariaTag = closed
              ? ", почивен ден"
              : busy
                ? ", няма свободни часове"
                : value === today
                  ? ", днес"
                  : "";
            return (
              <label
                key={value}
                className="relative flex h-18 w-14.5 shrink-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-button border border-border bg-card px-1 py-1.5 text-foreground lg:w-auto has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:disabled]:cursor-not-allowed has-[:disabled]:border-dashed has-[:disabled]:bg-background has-[:disabled]:text-muted-foreground has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring"
              >
                <input
                  type="radio"
                  name="visit-date"
                  value={value}
                  checked={date === value}
                  disabled={count === 0}
                  onChange={() => onDate(value)}
                  aria-label={`${formatBusinessDate(value)}${ariaTag}`}
                  className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                />
                <span aria-hidden="true" className="text-xs leading-4">
                  {
                    ["нд", "пн", "вт", "ср", "чт", "пт", "сб"][
                      businessWeekday(value)
                    ]
                  }
                </span>
                <span
                  aria-hidden="true"
                  className="flex items-center gap-0.5 font-heading text-[19px] leading-[22px] font-semibold tabular-nums"
                >
                  {Number(value.slice(8))}
                </span>
                <span
                  aria-hidden="true"
                  className="min-h-3.5 text-[11px] leading-[14px]"
                >
                  {tag}
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </fieldset>
  );
}
