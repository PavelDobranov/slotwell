import { ArrowLeft, Check, LoaderCircle } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/app/_components/button";
import {
  Card,
  CardAction,
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
  durationMinutes,
  priceCents,
  pending,
  retryable,
  onEdit,
  onConfirm,
  showPrimaryAction = true,
}: {
  showPrimaryAction?: boolean;
  contact: ContactDraft;
  start: number;
  staffName: string;
  durationMinutes: number;
  priceCents: number;
  pending: boolean;
  retryable: boolean;
  onEdit: () => void;
  onConfirm: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <section
      aria-label="Преглед и потвърждение"
      className="flex min-w-0 flex-col gap-6"
    >
      <div className="flex flex-col gap-2">
        <h3
          ref={heading}
          tabIndex={-1}
          className="rounded-sm text-xl font-semibold"
        >
          Провери и потвърди
        </h3>
        <p className="text-sm text-muted-foreground">
          Данните са попълнени правилно. Все още няма демо резервация — потвърди
          с бутона по-долу.
        </p>
        <output className="sr-only">
          Данните са валидни за демонстрацията. Все още няма резервация.
        </output>
      </div>
      <Card className="[--card-spacing:--spacing(5)]">
        <CardHeader>
          <CardTitle>
            <h4>Данни за контакт</h4>
          </CardTitle>
          <CardAction>
            <Button
              variant="link"
              size="sm"
              disabled={pending}
              onClick={onEdit}
              aria-label="Редактирай данните за контакт"
            >
              Редактирай
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-3 text-sm">
            {[
              ["Име", contact.name],
              ["Телефон", contact.phone],
              ["Имейл", contact.email],
              ...(contact.note ? [["Бележка", contact.note]] : []),
            ].map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="whitespace-pre-wrap wrap-anywhere">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <Card className="[--card-spacing:--spacing(5)]">
        <CardHeader>
          <CardTitle>
            <h4>
              {formatBusinessDate(businessDateAt(start))} ·{" "}
              {formatBusinessTime(start)}–
              {formatBusinessTime(start + durationMinutes * 60_000)} при{" "}
              {staffName}
            </h4>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Часът не е задържан, докато преглеждаш. Ако междувременно бъде зает,
            ще те върнем към избора на час, без да губиш данните си.
          </p>
          <p className="text-sm text-muted-foreground">
            Това е само демонстрация, не реално записване. Няма плащане. Не
            изпращаме имейл и не създаваме достъп за управление на резервация.
            Записът изчезва при презареждане.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {showPrimaryAction && (
              <Button
                type="button"
                className="min-h-11"
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
                    : "Потвърди демо резервация"}
              </Button>
            )}
            <span className="text-sm text-muted-foreground tabular-nums">
              Общо {durationMinutes} мин · {euros.format(priceCents / 100)}
            </span>
          </div>
          <output className="text-sm text-muted-foreground empty:hidden">
            {pending ? "Проверяваме дали часът е още свободен." : ""}
          </output>
        </CardContent>
      </Card>
      <Separator />
      <Button
        variant="outline"
        className="min-h-11 self-start"
        onClick={onEdit}
        disabled={pending}
      >
        <ArrowLeft aria-hidden="true" data-icon="inline-start" />
        Назад към данните
      </Button>
    </section>
  );
}
