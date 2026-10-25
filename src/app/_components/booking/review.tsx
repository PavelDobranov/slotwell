import { ArrowLeft, Check, Info, LoaderCircle } from "lucide-react";
import { useEffect, useRef } from "react";

import { Alert, AlertDescription } from "@/app/_components/alert";
import { Button } from "@/app/_components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/app/_components/card";
import { Separator } from "@/app/_components/separator";
import { euros } from "@/app/_lib/booking/format";
import type { ContactDraft } from "@/app/_lib/booking/state";
import {
  businessDateAt,
  formatBusinessDate,
  formatBusinessTime,
} from "@/app/_lib/booking/time";

export function Review({
  contact,
  start,
  staffName,
  services,
  salonName,
  address,
  durationMinutes,
  priceCents,
  pending,
  retryable,
  onEdit,
  onEditSelection,
  onConfirm,
  showPrimaryAction = true,
}: {
  showPrimaryAction?: boolean;
  contact: ContactDraft;
  start: number;
  staffName: string;
  services: { name: string; durationMinutes: number; priceCents: number }[];
  salonName: string;
  address: string;
  durationMinutes: number;
  priceCents: number;
  pending: boolean;
  retryable: boolean;
  onEdit: () => void;
  onEditSelection: (step: "services" | "staff" | "time") => void;
  onConfirm: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const rows = [
    {
      label: "Услуги",
      editLabel: "Промени услугите в прегледа",
      onEdit: () => onEditSelection("services"),
      content: (
        <ul className="flex flex-col gap-2">
          {services.map((service) => (
            <li
              key={service.name}
              className="flex flex-wrap justify-between gap-x-3 gap-y-1"
            >
              <span>
                {service.name} · {service.durationMinutes} мин
              </span>
              <span className="tabular-nums">
                {euros.format(service.priceCents / 100)}
              </span>
            </li>
          ))}
        </ul>
      ),
    },
    {
      label: "Специалист",
      editLabel: "Промени специалиста в прегледа",
      onEdit: () => onEditSelection("staff"),
      content: <p className="font-semibold">{staffName}</p>,
    },
    {
      label: "Дата и час",
      editLabel: "Промени датата и часа в прегледа",
      onEdit: () => onEditSelection("time"),
      content: (
        <div className="flex flex-col gap-1">
          <p className="font-semibold">
            {formatBusinessDate(businessDateAt(start))}
          </p>
          <p className="tabular-nums">
            {formatBusinessTime(start)}–
            {formatBusinessTime(start + durationMinutes * 60_000)} ·{" "}
            {durationMinutes} мин
          </p>
        </div>
      ),
    },
    {
      label: "Данни за контакт",
      editLabel: "Редактирай данните за контакт",
      onEdit,
      content: (
        <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
          {[
            ["Име", contact.name],
            ["Телефон", contact.phone],
            ["Имейл", contact.email],
          ].map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="whitespace-pre-wrap wrap-anywhere">{value}</dd>
            </div>
          ))}
        </dl>
      ),
    },
    {
      label: "Бележка",
      content: (
        <p className="whitespace-pre-wrap wrap-anywhere">
          {contact.note || "Без бележка"}
        </p>
      ),
    },
    {
      label: "Място",
      content: (
        <p>
          <strong>{salonName}</strong>
          <br />
          {address}
        </p>
      ),
    },
  ];
  return (
    <section
      aria-label="Преглед и потвърждение"
      aria-busy={pending}
      className="flex min-w-0 flex-col gap-5"
    >
      <div className="flex flex-col gap-2">
        <h3
          ref={heading}
          tabIndex={-1}
          className="rounded-sm text-xl font-semibold"
        >
          Провери и потвърди
        </h3>
        <output className="sr-only">
          Данните са валидни за демонстрацията. Все още няма резервация.
        </output>
      </div>
      <Alert role="note" variant="success" className="px-4 py-3.5">
        <Info aria-hidden="true" />
        <AlertDescription>
          Часът не е задържан, докато преглеждаш. Ако междувременно бъде зает,
          ще те върнем към избора на час, без да губиш данните си.
        </AlertDescription>
      </Alert>
      <Card className="gap-0 shadow-none [--card-spacing:--spacing(5)]">
        <CardHeader className="sr-only">
          <CardTitle>Твоят демо час</CardTitle>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          {rows.map((row) => (
            <section
              key={row.label}
              className="flex min-w-0 flex-col gap-2"
              aria-label={row.label}
            >
              <div className="flex flex-wrap items-center justify-between gap-x-3">
                <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {row.label}
                </h4>
                {row.onEdit && (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    disabled={pending}
                    onClick={row.onEdit}
                    aria-label={row.editLabel}
                  >
                    Промени
                  </Button>
                )}
              </div>
              {row.content}
              <Separator className="mt-2" />
            </section>
          ))}
          <p className="flex flex-wrap items-baseline justify-between gap-2 font-semibold">
            <span>Общо {durationMinutes} мин ·</span>{" "}
            <span className="font-heading text-xl tabular-nums">
              {euros.format(priceCents / 100)}
            </span>
          </p>
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">
        Това е само демонстрация, не реално записване. Няма плащане. Не
        изпращаме имейл и не създаваме достъп за управление на резервация.
        Записът изчезва при презареждане.
      </p>
      {showPrimaryAction && (
        <Button
          type="button"
          className="self-start"
          disabled={pending}
          onClick={onConfirm}
        >
          {pending ? (
            <LoaderCircle
              aria-hidden="true"
              data-icon="inline-start"
              className="motion-safe:animate-spin"
            />
          ) : (
            <Check aria-hidden="true" data-icon="inline-start" />
          )}
          {pending
            ? "Потвърждаваме…"
            : retryable
              ? "Опитай отново"
              : "Потвърди демо резервацията"}
        </Button>
      )}
      <output className="text-sm text-muted-foreground empty:hidden">
        {pending ? "Проверяваме дали часът е още свободен." : ""}
      </output>
      <Button
        type="button"
        variant="outline"
        className="self-start"
        onClick={onEdit}
        disabled={pending}
      >
        <ArrowLeft aria-hidden="true" data-icon="inline-start" />
        Назад към данните
      </Button>
    </section>
  );
}
