"use client";

import { useEffect, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/app/_components/alert";
import { Button } from "@/app/_components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/_components/card";
import { formatDuration } from "@/app/_lib/booking/format";
import type { ConfirmationView } from "@/server/booking";

type Display = ReturnType<typeof formatConfirmation>;
type State =
  | { status: "loading" | "unavailable" | "temporary" }
  | { status: "confirmed"; display: Display };

function formatConfirmation(view: ConfirmationView) {
  if (
    view.status !== "confirmed" ||
    !view.staffName?.trim() ||
    !view.businessAddress?.trim() ||
    !view.services.length
  )
    throw new Error();
  const date = new Intl.DateTimeFormat("bg-BG", {
    timeZone: view.bookingTimeZone,
    dateStyle: "long",
  });
  const time = new Intl.DateTimeFormat("bg-BG", {
    timeZone: view.bookingTimeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const start = new Date(view.startsAt);
  const end = new Date(view.serviceEndsAt);
  return {
    date: date.format(start),
    // Include both dates if the service interval crosses business-local midnight.
    range: `${time.format(start)} – ${date.format(start) === date.format(end) ? "" : `${date.format(end)}, `}${time.format(end)}`,
    expiry: `${date.format(new Date(view.confirmationExpiresAt))}, ${time.format(new Date(view.confirmationExpiresAt))}`,
    zone: view.bookingTimeZone,
    staff: view.staffName,
    address: view.businessAddress,
    services: view.services.map((service) => ({
      name: service.name,
      duration: formatDuration(service.durationMinutes),
      price:
        service.priceCents === null
          ? "Цената се уточнява на място"
          : new Intl.NumberFormat("bg-BG", {
              style: "currency",
              currency: service.currency,
            }).format(service.priceCents / 100),
    })),
  };
}

export function Confirmation() {
  const [attempt, setAttempt] = useState(0);
  return (
    <ConfirmationRead
      key={attempt}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}

function ConfirmationRead({ onRetry }: { onRetry: () => void }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const resultHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (state.status === "confirmed") resultHeading.current?.focus();
  }, [state.status]);

  useEffect(() => {
    let current = 0;
    let controller: AbortController | undefined;
    async function load() {
      const request = ++current;
      controller?.abort();
      setState({ status: "loading" });
      const params = new URLSearchParams(window.location.hash.slice(1));
      const appointmentId = params.get("appointmentId");
      const viewToken = params.get("viewToken");
      if (
        params.size !== 2 ||
        !appointmentId ||
        !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(appointmentId) ||
        !viewToken ||
        !/^[a-f0-9]{64}$/.test(viewToken)
      ) {
        setState({ status: "unavailable" });
        return;
      }
      controller = new AbortController();
      const activeController = controller;
      const timeout = window.setTimeout(() => activeController.abort(), 15_000);
      try {
        const response = await fetch("/api/confirmations/read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appointmentId, viewToken }),
          cache: "no-store",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          redirect: "error",
          signal: activeController.signal,
        });
        if (request !== current) return;
        if (response.status === 400 || response.status === 404) {
          setState({ status: "unavailable" });
          return;
        }
        if (!response.ok) throw new Error();
        const display = formatConfirmation(await response.json());
        if (request === current) setState({ status: "confirmed", display });
      } catch {
        // Never retain/log credentials, bodies, snapshots or raw failures.
        if (request === current) setState({ status: "temporary" });
      } finally {
        window.clearTimeout(timeout);
      }
    }
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) void load();
    };
    void load();
    window.addEventListener("hashchange", load);
    window.addEventListener("pageshow", restore);
    return () => {
      current++;
      controller?.abort();
      window.removeEventListener("hashchange", load);
      window.removeEventListener("pageshow", restore);
    };
  }, []);

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
