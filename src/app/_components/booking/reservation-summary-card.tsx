import { MapPin } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/app/_components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/app/_components/card";
import { Separator } from "@/app/_components/separator";
import {
  formatServicePrice,
  formatTotalPrice,
} from "@/app/_lib/booking/format";
import {
  businessDateAt,
  formatBusinessShortDate,
  formatBusinessTime,
} from "@/app/_lib/booking/time";
import { formatDuration } from "@/app/_lib/duration";
import { cn } from "@/app/_lib/utils";

export type SummaryStep = "services" | "staff" | "time";

type Props = {
  services: {
    name: string;
    durationMinutes: number;
    priceCents: number | null;
  }[];
  staffName?: string;
  start: number | null;
  durationMinutes: number;
  priceCents: number;
  hasVariablePrice: boolean;
  address?: string;
  onEdit: (step: SummaryStep) => void;
  canEdit?: (step: SummaryStep) => boolean;
  editLabelSuffix?: string;
};

/** One presentation for every booking step, desktop rail, and mobile sheet. */
export function ReservationSummaryCard({
  services,
  staffName,
  start,
  durationMinutes,
  priceCents,
  hasVariablePrice,
  address,
  onEdit,
  canEdit = () => true,
  editLabelSuffix = "",
}: Props) {
  function section(
    step: SummaryStep,
    label: string,
    editLabel: string,
    content: ReactNode,
  ) {
    return (
      <section
        aria-label={label}
        className="relative flex min-w-0 flex-col gap-1"
      >
        <h3 className="pr-20 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {label}
        </h3>
        <div className={cn(step !== "services" && canEdit(step) && "pr-20")}>
          {content}
        </div>
        {canEdit(step) && (
          <Button
            type="button"
            variant="link"
            size="sm"
            className={cn(
              "absolute right-0 px-0 text-sm font-semibold underline underline-offset-4",
              step === "services"
                ? "top-0 -translate-y-3"
                : "top-1/2 -translate-y-1/2",
            )}
            aria-label={`${editLabel}${editLabelSuffix}`}
            onClick={() => onEdit(step)}
          >
            Промени
          </Button>
        )}
      </section>
    );
  }
  return (
    <Card className="rounded-[18px] text-base leading-5 shadow-none [--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle className="text-lg font-semibold">
          <h2>Вашата резервация</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        {section(
          "services",
          "Услуги",
          "Промени услугите",
          services.length === 0 ? (
            <p className="text-muted-foreground">
              Все още няма избрани услуги.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {services.map((service) => (
                <li
                  key={service.name}
                  className="flex min-w-0 justify-between gap-3"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="wrap-anywhere">{service.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {formatDuration(service.durationMinutes)}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {formatServicePrice(service.priceCents, true)}
                  </span>
                </li>
              ))}
            </ul>
          ),
        )}
        <Separator />
        {section(
          "staff",
          "Специалист",
          "Промени специалиста",
          <p className="font-semibold">{staffName || "Не е избран"}</p>,
        )}
        {section(
          "time",
          "Дата и час",
          "Промени датата и часа",
          <p className="font-semibold tabular-nums">
            {start === null
              ? "Не е избран"
              : `${formatBusinessShortDate(businessDateAt(start))} · ${formatBusinessTime(start)}–${formatBusinessTime(start + durationMinutes * 60_000)}`}
          </p>,
        )}
        <div
          className="flex flex-col gap-1.5 rounded-xl bg-background px-4 py-3"
          aria-live="polite"
        >
          <p className="flex flex-wrap items-center justify-between gap-2 font-semibold">
            <span>Общо · {formatDuration(durationMinutes)}</span>
            <span className="font-heading text-xl tabular-nums">
              {formatTotalPrice({ priceCents, hasVariablePrice }, true)}
            </span>
          </p>
          <p className="text-sm text-muted-foreground">
            Плащане на място в салона.
          </p>
        </div>
        {address && (
          <p className="flex items-center gap-2 text-sm text-secondary-foreground">
            <MapPin aria-hidden="true" className="size-5 shrink-0" />
            <span className="min-w-0 wrap-anywhere">{address}</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
