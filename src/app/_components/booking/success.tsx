import { MapPin } from "lucide-react";

import { Avatar, AvatarFallback } from "@/app/_components/avatar";
import { Button } from "@/app/_components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/_components/card";
import { Separator } from "@/app/_components/separator";
import {
  formatServicePrice,
  formatTotalPrice,
} from "@/app/_lib/booking/format";
import { type BookingState, selectedTotals } from "@/app/_lib/booking/state";
import {
  businessDateAt,
  formatBusinessDate,
  formatBusinessTime,
} from "@/app/_lib/booking/time";
import type { DemoSalon } from "@/app/_lib/booking/types";

export function Success({
  salon,
  state,
  onNewBooking,
}: {
  salon: DemoSalon;
  state: BookingState & { start: number };
  onNewBooking: () => void;
}) {
  const { durationMinutes, priceCents, hasVariablePrice } = selectedTotals(
    state,
    salon,
  );
  const staff = salon.staff.find(({ id }) => id === state.staffId);
  const date = formatBusinessDate(businessDateAt(state.start)).replace(
    / г\.$/,
    "",
  );
  const time = `${formatBusinessTime(state.start)} – ${formatBusinessTime(state.start + durationMinutes * 60_000)}`;
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(salon.address)}`;

  return (
    <>
      <p className="mb-1 text-base leading-6 text-muted-foreground wrap-anywhere">
        Очакваме ви. Резервацията е свързана с{" "}
        <strong className="font-semibold">{state.contact.email}</strong>. Това е
        демо — не изпращаме имейли.
      </p>
      <section aria-label="Твоето посещение">
        <aside aria-label="Вашата резервация">
          <Card className="gap-0 rounded-[16px] py-0 text-base leading-6 shadow-none [--card-spacing:--spacing(5)]">
            <CardHeader className="gap-1 bg-accent py-5 text-accent-foreground">
              <CardTitle className="sr-only">Твоето посещение</CardTitle>
              <dl className="flex flex-col gap-1">
                <dt className="sr-only">Дата и час</dt>
                <dd className="font-semibold first-letter:uppercase">{date}</dd>
                <dd className="font-heading text-[30px] leading-9 font-bold tabular-nums">
                  {time}
                </dd>
              </dl>
              <CardDescription className="font-medium text-accent-foreground">
                {durationMinutes} мин · по българско време
              </CardDescription>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-col px-0">
              <div className="flex items-center gap-3.5 px-5 py-4">
                <Avatar aria-hidden="true" className="size-11 shrink-0">
                  <AvatarFallback className="bg-accent font-semibold text-accent-foreground">
                    {staff?.name
                      .split(" ")
                      .map((part) => part.charAt(0))
                      .join("")}
                  </AvatarFallback>
                </Avatar>
                <dl className="min-w-0">
                  <dt className="sr-only">Специалист</dt>
                  <dd className="font-semibold wrap-anywhere">{staff?.name}</dd>
                  <dd className="text-sm leading-5 text-muted-foreground wrap-anywhere">
                    {staff?.description}
                  </dd>
                </dl>
              </div>
              <Separator className="opacity-50" />
              <div className="px-5 py-4">
                <dl className="flex flex-col gap-2">
                  {salon.services
                    .filter(({ id }) => state.serviceIds.includes(id))
                    .map((service) => (
                      <div
                        key={service.id}
                        className="flex justify-between gap-4"
                      >
                        <dt className="wrap-anywhere">{service.name}</dt>
                        <dd className="shrink-0 tabular-nums">
                          {formatServicePrice(service.priceCents, true)}
                        </dd>
                      </div>
                    ))}
                </dl>
                <Separator className="my-2 border-t border-dashed bg-transparent opacity-50" />
                <dl className="flex justify-between gap-4 text-sm leading-5 font-semibold">
                  <dt>Общо · {durationMinutes} мин</dt>
                  <dd className="shrink-0 tabular-nums">
                    {formatTotalPrice({ priceCents, hasVariablePrice }, true)}
                  </dd>
                </dl>
              </div>
              <Separator className="opacity-50" />
              <div className="flex items-start gap-3 px-5 py-4">
                <MapPin
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                />
                <dl className="flex min-w-0 flex-col gap-1 text-sm leading-5">
                  <dt className="sr-only">Място</dt>
                  <dd className="font-semibold wrap-anywhere">{salon.name}</dd>
                  <dd className="wrap-anywhere">{salon.address}</dd>
                  <dd className="mt-1">
                    <a
                      className="font-semibold text-primary underline underline-offset-4"
                      href={directionsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Упътване до салона
                    </a>
                  </dd>
                </dl>
              </div>
            </CardContent>
          </Card>
        </aside>
      </section>
      <section
        aria-labelledby="booking-changes-heading"
        className="mt-1 flex flex-col gap-2 rounded-[16px] border p-5 text-sm leading-5"
      >
        <h3 id="booking-changes-heading" className="font-semibold">
          Нужна е промяна?
        </h3>
        <p className="text-muted-foreground">
          Линкът в имейла ви позволява да смените часа или да откажете по всяко
          време.
        </p>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
          <Button
            variant="link"
            size="sm"
            disabled
            className="h-auto min-h-6 px-0 font-semibold underline underline-offset-4 disabled:opacity-100"
          >
            Промени часа
          </Button>
          <Button
            variant="link"
            size="sm"
            disabled
            className="h-auto min-h-6 px-0 font-semibold text-muted-foreground underline underline-offset-4 disabled:opacity-100"
          >
            Откажи резервацията
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Промяна и отказ не са налични в демото.
        </p>
      </section>
      <details className="text-sm text-muted-foreground">
        <summary className="w-fit cursor-pointer underline underline-offset-4">
          Данни за контакт и нова резервация
        </summary>
        <div className="mt-4 flex min-w-0 flex-col gap-4">
          <h3 className="font-semibold text-foreground">Данни за контакт</h3>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
            {[
              ["Име", state.contact.name],
              ["Телефон", state.contact.phone],
              ["Имейл", state.contact.email],
              ...(state.contact.note ? [["Бележка", state.contact.note]] : []),
            ].map(([label, value]) => (
              <div key={label} className="contents">
                <dt>{label}</dt>
                <dd className="whitespace-pre-wrap text-foreground wrap-anywhere">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <Button
            variant="outline"
            className="self-start"
            onClick={onNewBooking}
          >
            Нова резервация
          </Button>
        </div>
      </details>
    </>
  );
}
