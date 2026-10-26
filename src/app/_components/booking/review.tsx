import { ChevronLeft, Info, LoaderCircle, MapPin } from "lucide-react";
import { Fragment, useEffect, useRef } from "react";

import { Alert, AlertDescription } from "@/app/_components/alert";
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
  hasVariablePrice,
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
  services: {
    name: string;
    durationMinutes: number;
    priceCents: number | null;
  }[];
  salonName: string;
  address: string;
  durationMinutes: number;
  priceCents: number;
  hasVariablePrice: boolean;
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
                {service.name}
                <span className="text-muted-foreground">
                  {" "}
                  · {service.durationMinutes} мин
                </span>
              </span>
              <span className="tabular-nums">
                {formatServicePrice(service.priceCents, true)}
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
        <div className="flex flex-col">
          <p className="font-semibold first-letter:uppercase">
            {formatBusinessDate(businessDateAt(start)).replace(/ г\.$/, "")}
          </p>
          <p className="tabular-nums">
            {formatBusinessTime(start)} –{" "}
            {formatBusinessTime(start + durationMinutes * 60_000)} ·{" "}
            {durationMinutes} мин
          </p>
        </div>
      ),
    },
    {
      label: "Контакти",
      editLabel: "Редактирай данните за контакт",
      onEdit,
      content: (
        <div className="flex min-w-0 flex-col whitespace-pre-wrap wrap-anywhere">
          <p className="font-semibold">{contact.name}</p>
          <p>{contact.phone}</p>
          <p>{contact.email}</p>
        </div>
      ),
    },
    {
      label: "Бележка",
      content: (
        <p
          className={
            contact.note
              ? "whitespace-pre-wrap wrap-anywhere"
              : "text-muted-foreground"
          }
        >
          {contact.note || "Без бележка"}
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
      <h3
        ref={heading}
        tabIndex={-1}
        className="rounded-sm text-[28px] leading-[34px] font-semibold lg:text-4xl lg:leading-[42px]"
      >
        Проверете и потвърдете
      </h3>
      <output className="sr-only">
        Данните са валидни. Все още няма резервация.
      </output>
      <Alert
        role="note"
        variant="success"
        className="rounded-card border-0 px-4 py-3 text-base has-[>svg]:gap-x-3 [&>svg]:size-5"
      >
        <Info aria-hidden="true" />
        <AlertDescription className="text-base leading-6 text-pretty">
          Часът се запазва едва когато натиснете „Потвърди резервацията“.
          Плащането е на място — онлайн не плащате нищо.
        </AlertDescription>
      </Alert>
      <Card className="gap-0 rounded-[18px] py-0 text-base leading-6 shadow-none">
        <CardHeader className="sr-only">
          <CardTitle>Твоят час</CardTitle>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col px-0">
          {rows.map((row) => (
            <Fragment key={row.label}>
              <section
                className="flex min-w-0 items-center gap-5 px-5 py-4"
                aria-label={row.label}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <h4 className="text-xs leading-4 font-semibold tracking-wide text-muted-foreground uppercase">
                    {row.label}
                  </h4>
                  {row.content}
                </div>
                {row.onEdit && (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="shrink-0 self-start px-0 text-sm font-semibold underline underline-offset-4"
                    disabled={pending}
                    onClick={row.onEdit}
                    aria-label={row.editLabel}
                  >
                    Промени
                  </Button>
                )}
              </section>
              <Separator className="opacity-50" />
              {row.label === "Дата и час" && (
                <>
                  <p className="flex flex-wrap items-center justify-between gap-2 bg-background px-5 py-4 font-semibold">
                    <span>Общо · {durationMinutes} мин</span>
                    <span className="font-heading text-xl tabular-nums">
                      {formatTotalPrice({ priceCents, hasVariablePrice }, true)}
                    </span>
                  </p>
                  <Separator className="opacity-50" />
                </>
              )}
            </Fragment>
          ))}
          <section
            aria-label="Място"
            className="flex items-start gap-3 px-5 py-4"
          >
            <MapPin
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-muted-foreground"
            />
            <p className="min-w-0 wrap-anywhere">
              <strong className="font-semibold">{salonName}</strong>
              <br />
              {address}
            </p>
          </section>
        </CardContent>
      </Card>
      <div className="mt-3 flex items-center justify-between gap-4">
        <Button
          type="button"
          variant="outline"
          aria-label="Назад към данните"
          className="bg-card px-4 font-semibold"
          onClick={onEdit}
          disabled={pending}
        >
          <ChevronLeft aria-hidden="true" data-icon="inline-start" />
          Назад
        </Button>
        {showPrimaryAction && (
          <Button
            type="button"
            className="h-auto min-h-13 min-w-0 flex-1 whitespace-normal px-5 font-semibold transition-colors sm:flex-none lg:min-w-65"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending && (
              <LoaderCircle
                aria-hidden="true"
                data-icon="inline-start"
                className="motion-safe:animate-spin"
              />
            )}
            {pending
              ? "Потвърждаваме…"
              : retryable
                ? "Опитай отново"
                : "Потвърди резервацията"}
          </Button>
        )}
      </div>
      <output className="text-sm text-muted-foreground empty:hidden">
        {pending ? "Проверяваме дали часът е още свободен." : ""}
      </output>
    </section>
  );
}
