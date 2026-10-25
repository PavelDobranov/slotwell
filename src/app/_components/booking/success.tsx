import { Check, MapPin, Plus } from "lucide-react";

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
import { euros } from "@/app/_lib/booking/format";
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
  const { durationMinutes, priceCents } = selectedTotals(state, salon);
  const staffName = salon.staff.find(({ id }) => id === state.staffId)?.name;
  const date = formatBusinessDate(businessDateAt(state.start));
  const time = `${formatBusinessTime(state.start)}–${formatBusinessTime(state.start + durationMinutes * 60_000)}`;
  return (
    <>
      <p className="text-muted-foreground">
        Очакваме ви. Ето твоя избор за посещението.
      </p>
      <section aria-label="Твоето посещение">
        <aside aria-label="Вашата резервация">
          <Card className="pt-0 [--card-spacing:--spacing(5)]">
            <CardHeader className="gap-3 bg-accent py-5">
              <CardTitle>
                <h3 className="sr-only">Твоето посещение</h3>
              </CardTitle>
              <dl className="flex flex-col gap-1">
                <dt className="text-sm text-accent-foreground">Дата и час</dt>
                <dd className="flex flex-col gap-2 text-accent-foreground">
                  <span className="font-medium">{date}</span>
                  <strong className="font-heading text-3xl leading-tight">
                    {time}
                  </strong>
                </dd>
              </dl>
              <CardDescription>
                {durationMinutes} мин · по българско време (Europe/Sofia)
              </CardDescription>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-col gap-5">
              <div className="flex items-center gap-3">
                <Avatar
                  aria-hidden="true"
                  className="size-11 shrink-0 border border-border"
                >
                  <AvatarFallback className="bg-accent text-accent-foreground">
                    {staffName?.charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <dl className="min-w-0">
                  <dt className="text-sm text-muted-foreground">Специалист</dt>
                  <dd className="font-medium wrap-anywhere">{staffName}</dd>
                </dl>
                <Check
                  aria-hidden="true"
                  className="ml-auto size-5 shrink-0 text-primary"
                />
              </div>
              <Separator />
              <dl className="flex flex-col gap-3">
                {salon.services
                  .filter(({ id }) => state.serviceIds.includes(id))
                  .map((service) => (
                    <div
                      key={service.id}
                      className="flex justify-between gap-4"
                    >
                      <dt className="wrap-anywhere">{service.name}</dt>
                      <dd className="shrink-0 font-medium">
                        {euros.format(service.priceCents / 100)}
                      </dd>
                    </div>
                  ))}
              </dl>
              <Separator className="border-t border-dashed bg-transparent" />
              <dl className="flex items-baseline justify-between gap-4">
                <dt>
                  <strong>Общо</strong>
                  <span className="text-muted-foreground">
                    {" "}
                    · {durationMinutes} мин
                  </span>
                </dt>
                <dd className="shrink-0 font-heading text-xl font-semibold">
                  {euros.format(priceCents / 100)}
                </dd>
              </dl>
              <Separator />
              <div className="flex items-start gap-3">
                <MapPin
                  aria-hidden="true"
                  className="size-5 shrink-0 text-primary"
                />
                <dl className="min-w-0">
                  <dt className="sr-only">Място</dt>
                  <dd className="flex flex-col gap-1 wrap-anywhere">
                    <strong className="font-medium">{salon.name}</strong>
                    <span className="text-muted-foreground">
                      {salon.address}
                    </span>
                  </dd>
                </dl>
              </div>
              <Separator />
              <h3 className="font-medium">Данни за контакт</h3>
              <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-3 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-x-4">
                {[
                  ["Име", state.contact.name],
                  ["Телефон", state.contact.phone],
                  ["Имейл", state.contact.email],
                  ...(state.contact.note
                    ? [["Бележка", state.contact.note]]
                    : []),
                ].map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="whitespace-pre-wrap wrap-anywhere">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </aside>
      </section>
      <Button className="w-full sm:w-fit" onClick={onNewBooking}>
        <Plus aria-hidden="true" data-icon="inline-start" />
        Нова резервация
      </Button>
    </>
  );
}
