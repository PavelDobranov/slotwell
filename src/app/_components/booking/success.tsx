import { Info, Plus } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/app/_components/alert";
import { Button } from "@/app/_components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/app/_components/card";
import { Separator } from "@/app/_components/separator";
import { euros } from "@/app/_lib/booking/format";
import { type BookingState, selectedTotals } from "@/app/_lib/booking/state";
import {
  businessDateAt,
  formatBusinessDate,
  formatBusinessTime,
} from "@/app/_lib/booking/time";
import type { DemoSalon } from "@/app/_lib/booking/types";
import { cn } from "@/app/_lib/utils";

export function Success({
  salon,
  state,
  onNewBooking,
}: {
  salon: DemoSalon;
  state: BookingState & { start: number };
  onNewBooking: () => void;
}) {
  const { durationMinutes, priceCents } = selectedTotals(state, salon);
  const staffName = salon.staff.find(({ id }) => id === state.staffId)?.name;
  const date = formatBusinessDate(businessDateAt(state.start));
  const time = `${formatBusinessTime(state.start)}–${formatBusinessTime(state.start + durationMinutes * 60_000)}`;
  return (
    <>
      <p className="text-muted-foreground">
        {date} · <strong className="font-medium text-foreground">{time}</strong>{" "}
        при {staffName}
      </p>
      <Card className="[--card-spacing:--spacing(4)] sm:[--card-spacing:--spacing(5)]">
        <CardHeader className="hidden sm:grid">
          <CardTitle>
            <h3>Твоето посещение</h3>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-5">
          <section aria-label="Твоето посещение">
            <aside aria-label="Твоят избор">
              <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-3 text-sm sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-x-4">
                {[
                  [
                    "Услуги",
                    salon.services
                      .filter(({ id }) => state.serviceIds.includes(id))
                      .map(({ name }) => name)
                      .join(" · "),
                  ],
                  [
                    "Общо",
                    `${durationMinutes} мин · ${euros.format(priceCents / 100)}`,
                  ],
                  ["Специалист", staffName],
                  ["Дата и час", `${date} · ${time} (Europe/Sofia)`],
                  ["Място", `${salon.name}, ${salon.address}`],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className={cn(
                      "contents",
                      (label === "Специалист" || label === "Дата и час") &&
                        "hidden sm:contents",
                    )}
                  >
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="wrap-anywhere">{value}</dd>
                  </div>
                ))}
              </dl>
            </aside>
          </section>
          <Separator />
          <h3 className="hidden font-medium sm:block">Данни за контакт</h3>
          <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-3 text-sm sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-x-4">
            {[
              ["Име", state.contact.name],
              ["Телефон", state.contact.phone],
              ["Имейл", state.contact.email],
              ...(state.contact.note ? [["Бележка", state.contact.note]] : []),
            ].map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="whitespace-pre-wrap wrap-anywhere">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <Alert className="px-4 py-3">
        <Info aria-hidden="true" />
        <AlertTitle>
          <h3>Какво означава „демо“?</h3>
        </AlertTitle>
        <AlertDescription>
          Това не е реална резервация. Не изпращаме имейл или SMS и всичко се
          изтрива при презареждане.
          <span className="hidden sm:inline">
            {" "}
            Часът е зает само в тази демонстрация, докато страницата е отворена.
            Няма достъп за управление на резервация. Запиши си данните, ако ти
            трябват.
          </span>
        </AlertDescription>
      </Alert>
      <Button
        variant="outline"
        className="min-h-11 w-full sm:w-fit"
        onClick={onNewBooking}
      >
        <Plus
          aria-hidden="true"
          data-icon="inline-start"
          className="hidden sm:block"
        />
        Нова демо резервация
      </Button>
    </>
  );
}
