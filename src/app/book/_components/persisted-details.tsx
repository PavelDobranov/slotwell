"use client";

import { getCountries, getCountryCallingCode } from "libphonenumber-js/max";
import { type Dispatch, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/app/_components/alert";
import { Button } from "@/app/_components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/app/_components/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/app/_components/field";
import { Input } from "@/app/_components/input";
import { Textarea } from "@/app/_components/textarea";
import type { BusinessView, ServiceView } from "@/app/_lib/booking/api";
import { formatDuration } from "@/app/_lib/booking/format";
import type {
  PersistedAction,
  PersistedState,
} from "@/app/_lib/booking/persisted-state";
import {
  type ContactErrors,
  contactLimits,
  parseGuestContact,
} from "@/shared/guest-contact";

const countryNames = new Intl.DisplayNames(["bg"], { type: "region" });
const countries = getCountries()
  .map((code) => ({ code, name: countryNames.of(code) ?? code }))
  .sort((a, b) => a.name.localeCompare(b.name, "bg"));
const fields = [
  { key: "name", label: "Име", type: "text", autoComplete: "name" },
  { key: "phone", label: "Телефон", type: "tel", autoComplete: "tel" },
  { key: "email", label: "Имейл", type: "email", autoComplete: "email" },
] as const;

export function formatPersistedPrice(
  priceCents: number | null,
  currency: string,
): string {
  return priceCents === null
    ? "Цената се уточнява на място"
    : new Intl.NumberFormat("bg-BG", { style: "currency", currency }).format(
        priceCents / 100,
      );
}

export function PersistedDetails({
  state,
  services,
  staffName,
  business,
  dispatch,
  onConfirm,
  canConfirm,
}: {
  state: PersistedState;
  services: readonly ServiceView[];
  staffName: string;
  business: BusinessView;
  dispatch: Dispatch<PersistedAction>;
  onConfirm: () => void;
  canConfirm: boolean;
}) {
  const [errors, setErrors] = useState<ContactErrors>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.step === "details" || state.step === "review")
      heading.current?.focus();
  }, [state.step]);
  const reviewing = state.step === "review";
  const slot = state.slot;
  if (!slot) return null;
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
    <section
      aria-labelledby="details-heading"
      className="flex min-w-0 flex-col gap-5"
    >
      <h2
        id="details-heading"
        ref={heading}
        tabIndex={-1}
        className="text-[28px] leading-[34px] font-semibold lg:text-4xl lg:leading-[42px]"
      >
        {reviewing ? "Проверете и потвърдете" : "Вашите данни"}
      </h2>
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
            {time.format(new Date(slot.start))}–
            {time.format(new Date(slot.end))}
          </p>
          <p className="text-sm text-muted-foreground">
            Часова зона: {timeZone}
          </p>
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
              <Button
                key={step}
                variant="link"
                onClick={() => dispatch({ type: "edit", step })}
              >
                {label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
      {reviewing ? (
        <>
          <Alert role="note" variant="info">
            <AlertTitle>Все още няма потвърдена резервация.</AlertTitle>
            <AlertDescription>
              Часът се проверява и запазва при потвърждение. След успех ще
              отворим личния линк за преглед на резервацията.
            </AlertDescription>
          </Alert>
          <Card className="rounded-card shadow-none">
            <CardHeader>
              <CardTitle>
                <h3>Контакти и бележка</h3>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-col gap-1 whitespace-pre-wrap wrap-anywhere">
              <p className="font-semibold">{state.contact.name}</p>
              <p>{state.contact.phone}</p>
              <p>{state.contact.email}</p>
              <p>{state.contact.note || "Без бележка"}</p>
            </CardContent>
          </Card>
          <div className="flex flex-wrap justify-between gap-3">
            <Button
              variant="outline"
              onClick={() => dispatch({ type: "edit", step: "details" })}
            >
              Редактирай данните
            </Button>
            <Button disabled={!canConfirm} onClick={onConfirm}>
              Потвърди резервацията
            </Button>
          </div>
        </>
      ) : (
        <form
          ref={form}
          noValidate
          className="booking-contact flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            const result = parseGuestContact(
              state.contact,
              business.defaultPhoneCountry,
            );
            const nextErrors = result.success ? {} : result.errors;
            setErrors(nextErrors);
            if (result.success)
              dispatch({
                type: "review",
                services,
                defaultPhoneCountry: business.defaultPhoneCountry,
              });
            else {
              const first = (
                ["name", "phoneCountry", "phone", "email", "note"] as const
              ).find((key) => nextErrors[key]);
              const control = first
                ? form.current?.elements.namedItem(first)
                : null;
              if (control instanceof HTMLElement) control.focus();
            }
          }}
        >
          <p className="text-muted-foreground">
            Без регистрация. Данните са за тази резервация и не се запазват в
            браузъра.
          </p>
          {Object.keys(errors).length > 0 && (
            <Alert variant="error">
              <AlertTitle>Проверете данните</AlertTitle>
              <AlertDescription>
                Коригирайте отбелязаните полета.
              </AlertDescription>
            </Alert>
          )}
          <FieldGroup>
            <Field data-invalid={Boolean(errors.phoneCountry)}>
              <FieldLabel htmlFor="persisted-phoneCountry">
                Държава за телефона
              </FieldLabel>
              <select
                id="persisted-phoneCountry"
                name="phoneCountry"
                required
                value={
                  state.contact.phoneCountry ?? business.defaultPhoneCountry
                }
                onChange={(event) =>
                  dispatch({
                    type: "contact",
                    draft: { phoneCountry: event.target.value },
                  })
                }
                aria-invalid={Boolean(errors.phoneCountry)}
                aria-describedby="persisted-phoneCountry-error"
                className="h-13 w-full min-w-0 rounded-lg border border-input bg-background px-3.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
              >
                {countries.map(({ code, name }) => (
                  <option key={code} value={code}>
                    {name} (+{getCountryCallingCode(code)})
                  </option>
                ))}
              </select>
              <FieldError id="persisted-phoneCountry-error">
                {errors.phoneCountry}
              </FieldError>
            </Field>
            {fields.map(({ key, label, ...input }) => (
              <Field key={key} data-invalid={Boolean(errors[key])}>
                <FieldLabel htmlFor={`persisted-${key}`}>{label}</FieldLabel>
                <Input
                  {...input}
                  id={`persisted-${key}`}
                  name={key}
                  required
                  value={state.contact[key]}
                  onChange={(event) =>
                    dispatch({
                      type: "contact",
                      draft: { [key]: event.target.value },
                    })
                  }
                  aria-invalid={Boolean(errors[key])}
                  aria-describedby={`persisted-${key}-error${key === "phone" ? " persisted-phone-hint" : ""}`}
                />
                {key === "phone" && (
                  <FieldDescription id="persisted-phone-hint">
                    Може да използвате международен код (+ или 00), без вътрешен
                    номер.
                  </FieldDescription>
                )}
                <FieldError id={`persisted-${key}-error`}>
                  {errors[key]}
                </FieldError>
              </Field>
            ))}
            <Field data-invalid={Boolean(errors.note)}>
              <FieldLabel htmlFor="persisted-note">
                Бележка (по желание)
              </FieldLabel>
              <Textarea
                id="persisted-note"
                name="note"
                rows={3}
                value={state.contact.note}
                onChange={(event) =>
                  dispatch({
                    type: "contact",
                    draft: { note: event.target.value },
                  })
                }
                aria-invalid={Boolean(errors.note)}
                aria-describedby="persisted-note-limit persisted-note-error"
              />
              <FieldDescription id="persisted-note-limit">
                {state.contact.note.length} / {contactLimits.note}
              </FieldDescription>
              <FieldError id="persisted-note-error">{errors.note}</FieldError>
            </Field>
          </FieldGroup>
          <div className="flex flex-wrap justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => dispatch({ type: "edit", step: "time" })}
            >
              Назад към часа
            </Button>
            <Button type="submit">Прегледай резервацията</Button>
          </div>
        </form>
      )}
    </section>
  );
}
