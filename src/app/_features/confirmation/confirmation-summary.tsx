import type { Ref } from "react";

import { Alert, AlertDescription } from "@/app/_components/alert";
import { Button } from "@/app/_components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/_components/card";
import type { ConfirmationDisplay } from "@/app/_features/confirmation/confirmation-api";

export type ConfirmationState =
  | { status: "loading" | "unavailable" | "temporary" }
  | { status: "confirmed"; display: ConfirmationDisplay };

export function ConfirmationSummary({
  state,
  onRetry,
  resultHeading,
}: {
  state: ConfirmationState;
  onRetry: () => void;
  resultHeading: Ref<HTMLHeadingElement>;
}) {
  if (state.status === "loading")
    return <output>Зареждаме резервацията…</output>;
  if (state.status !== "confirmed")
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="error">
          <AlertDescription>
            {state.status === "unavailable"
              ? "Линкът е невалиден или е изтекъл."
              : "Не успяхме да заредим резервацията. Опитайте отново."}
          </AlertDescription>
        </Alert>
        {state.status === "temporary" && (
          <Button variant="outline" onClick={onRetry}>
            Опитай отново
          </Button>
        )}
      </div>
    );
  const { display } = state;
  return (
    <section
      aria-label="Вашата резервация"
      className="flex flex-col gap-4 wrap-anywhere"
      aria-live="polite"
    >
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 ref={resultHeading} tabIndex={-1}>
              Резервацията е потвърдена
            </h2>
          </CardTitle>
          <CardDescription>
            Часова зона на резервацията: {display.zone}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <dl className="flex flex-col gap-3">
            <div>
              <dt className="text-sm text-muted-foreground">Дата и час</dt>
              <dd className="font-semibold">{display.date}</dd>
              <dd className="font-heading text-2xl tabular-nums">
                {display.range}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Специалист</dt>
              <dd>{display.staff}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Адрес</dt>
              <dd>{display.address}</dd>
            </div>
          </dl>
          <div className="flex flex-col gap-2">
            <h3 className="font-semibold">Услуги</h3>
            <ul className="flex flex-col gap-3">
              {display.services.map((service, index) => (
                <li
                  key={`${index}-${service.name}`}
                  className="flex flex-col gap-1"
                >
                  <span className="font-medium">{service.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {service.duration} · {service.price}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(display.address)}`}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
            className="font-semibold text-primary underline underline-offset-4"
          >
            Упътване до салона
          </a>
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">
        Пазете този линк личен. Всеки, който го притежава, може да види
        резервацията до {display.expiry} ({display.zone}).
      </p>
    </section>
  );
}
