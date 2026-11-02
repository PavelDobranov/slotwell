import { Button } from "@/app/_components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/app/_components/card";
import type { BusinessView, ServiceView } from "@/app/_features/booking/api";
import type { SelectedSlot } from "@/app/_features/booking/context";
import { formatPersistedPrice } from "@/app/_features/booking/price";
import { formatDuration } from "@/app/_lib/duration";

/** Current catalog facts and selected time; no query or booking-context access. */
export function BookingSummary({
  services,
  staffName,
  business,
  slot,
  onEdit,
}: {
  services: readonly ServiceView[];
  staffName: string;
  business: BusinessView;
  slot: SelectedSlot;
  onEdit: (step: "services" | "staff" | "time") => void;
}) {
  const timeZone = slot.timeZone ?? business.timeZone;
  const date = new Intl.DateTimeFormat("bg-BG", {
    timeZone,
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const time = new Intl.DateTimeFormat("bg-BG", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const totals = new Map<string, { amount: number; variable: boolean }>();
  for (const service of services) {
    const total = totals.get(service.currency) ?? {
      amount: 0,
      variable: false,
    };
    total.amount += service.priceCents ?? 0;
    total.variable ||= service.priceCents === null;
    totals.set(service.currency, total);
  }
  return (
    <Card className="rounded-card shadow-none">
      <CardHeader>
        <CardTitle>
          <h3>Вашата резервация</h3>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <ul className="flex flex-col gap-3">
          {services.map((service) => (
            <li
              key={service.id}
              className="flex min-w-0 flex-wrap justify-between gap-2"
            >
              <span className="wrap-anywhere">
                {service.name} · {formatDuration(service.durationMinutes)}
              </span>
              <span className="tabular-nums">
                {formatPersistedPrice(service.priceCents, service.currency)}
              </span>
            </li>
          ))}
        </ul>
        <p>
          <strong>Специалист:</strong> {staffName}
        </p>
        <p className="tabular-nums">
          {date.format(new Date(slot.start))} ·{" "}
          {time.format(new Date(slot.start))}–{time.format(new Date(slot.end))}
        </p>
        <p className="text-sm text-muted-foreground">Часова зона: {timeZone}</p>
        <p className="wrap-anywhere">{business.address}</p>
        <div className="flex flex-col gap-1 rounded-xl bg-background p-4">
          <p className="font-semibold">
            Общо ·{" "}
            {formatDuration(
              services.reduce(
                (sum, service) => sum + service.durationMinutes,
                0,
              ),
            )}
          </p>
          {[...totals].map(([currency, total]) => (
            <p key={currency} className="font-semibold tabular-nums">
              {total.variable && total.amount > 0 ? "от " : ""}
              {formatPersistedPrice(
                total.variable && total.amount === 0 ? null : total.amount,
                currency,
              )}
            </p>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["services", "Промени услугите"],
              ["staff", "Смени специалиста"],
              ["time", "Промени датата и часа"],
            ] as const
          ).map(([step, label]) => (
            <Button key={step} variant="link" onClick={() => onEdit(step)}>
              {label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
