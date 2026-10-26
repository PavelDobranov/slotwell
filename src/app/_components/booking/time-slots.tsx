import { CheckIcon } from "lucide-react";

import { Skeleton } from "@/app/_components/skeleton";
import type { availableSlots } from "@/app/_lib/booking/availability";
import {
  formatBusinessDate,
  formatBusinessTime,
} from "@/app/_lib/booking/time";

export function TimeSlots({
  slots,
  date,
  start,
  onSelect,
  loading = false,
}: {
  slots: ReturnType<typeof availableSlots>;
  date: string;
  start: number | null;
  onSelect: (start: number) => void;
  loading?: boolean;
}) {
  const morning = slots.filter(
    (slot) => formatBusinessTime(slot.start) < "12:00",
  );
  const afternoon = slots.filter((slot) => {
    const time = formatBusinessTime(slot.start);
    return time >= "12:00" && time < "17:00";
  });
  const evening = slots.filter(
    (slot) => formatBusinessTime(slot.start) >= "17:00",
  );
  return (
    <div className="@container flex min-w-0 flex-col gap-4" aria-busy={loading}>
      {loading ? (
        <>
          <output className="text-sm">
            Търсим свободни часове за {formatBusinessDate(date)}…
          </output>
          <div
            aria-hidden="true"
            className="grid grid-cols-2 gap-2 @min-[20rem]:grid-cols-4 @min-[30rem]:grid-cols-6"
          >
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((placeholder) => (
              <Skeleton key={placeholder} className="h-12 rounded-slot" />
            ))}
          </div>
        </>
      ) : (
        <fieldset className="flex min-w-0 flex-col gap-4">
          <legend className="sr-only">
            Свободни начални часове за {formatBusinessDate(date)}
          </legend>
          {(
            [
              ["Сутрин", morning],
              ["Следобед", afternoon],
              ["Вечер", evening],
            ] as const
          )
            .filter(([, group]) => group.length > 0)
            .map(([title, group]) => (
              <div key={title} className="flex flex-col gap-2">
                <p className="text-[13px] leading-[18px] text-muted-foreground">
                  {title}
                </p>
                <div className="grid grid-cols-2 gap-2 @min-[20rem]:grid-cols-4 @min-[30rem]:grid-cols-6">
                  {group.map((slot) => (
                    <label
                      key={slot.start}
                      className="relative flex min-h-12 cursor-pointer items-center justify-center gap-1 rounded-slot border border-border bg-card text-[15px] font-semibold tabular-nums has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring"
                    >
                      <input
                        type="radio"
                        name="start-time"
                        value={slot.start}
                        checked={start === slot.start}
                        onChange={() => onSelect(slot.start)}
                        aria-label={formatBusinessTime(slot.start)}
                        className="absolute inset-0 size-full cursor-pointer opacity-0"
                      />
                      <span aria-hidden="true">
                        {formatBusinessTime(slot.start)}
                      </span>
                      {start === slot.start && (
                        <CheckIcon aria-hidden="true" className="size-3" />
                      )}
                    </label>
                  ))}
                </div>
              </div>
            ))}
        </fieldset>
      )}
    </div>
  );
}
