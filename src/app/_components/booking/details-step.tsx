import { getCountries, getCountryCallingCode } from "libphonenumber-js/max";
import { ChevronLeft } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/app/_components/alert";
import { Review } from "@/app/_components/booking/review";
import { Button } from "@/app/_components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/app/_components/field";
import { Input } from "@/app/_components/input";
import { Textarea } from "@/app/_components/textarea";
import type { ContactDraft } from "@/app/_lib/booking/state";
import {
  type ContactErrors,
  contactLimits,
  validateContact,
} from "@/app/_lib/booking/validation";

const countryNames = new Intl.DisplayNames(["bg"], { type: "region" });
const countries = getCountries()
  .map((code) => ({ code, name: countryNames.of(code) ?? code }))
  .sort((a, b) => a.name.localeCompare(b.name, "bg"));

const fields = [
  {
    key: "name",
    label: "Име и фамилия",
    summaryLabel: "Име",
    hint: undefined,
    type: "text",
    autoComplete: "name",
    inputMode: "text",
  },
  {
    key: "phone",
    label: "Телефон",
    summaryLabel: "Телефон",
    hint: "Напр. 088 123 4567 за България или +44 20 7946 0958. Международният код (+ или 00) е с предимство пред държавата. Без вътрешен номер.",
    type: "tel",
    autoComplete: "tel",
    inputMode: "tel",
  },
  {
    key: "email",
    label: "Имейл",
    summaryLabel: "Имейл",
    hint: "Тук ще получите потвърждението и линк за промяна или отказ.",
    type: "email",
    autoComplete: "email",
    inputMode: "email",
  },
] as const;

export function DetailsStep({
  draft,
  onChange,
  onConfirm,
  pending,
  retryable,
  appointment,
  onBack,
  onEditSelection,
  checked,
  onChecked,
  showPrimaryAction = true,
}: {
  showPrimaryAction?: boolean;
  checked: boolean;
  onChecked: (checked: boolean) => void;
  draft: ContactDraft;
  onChange: (draft: Partial<ContactDraft>) => void;
  onConfirm: () => void;
  pending: boolean;
  retryable: boolean;
  appointment: {
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
  };
  onBack: () => void;
  onEditSelection: (step: "services" | "staff" | "time") => void;
}) {
  const [errors, setErrors] = useState<ContactErrors>({});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const first = (
      ["name", "phoneCountry", "phone", "email", "note"] as const
    ).find((key) => errors[key]);
    if (first) {
      const control = form.current?.elements.namedItem(first);
      if (control instanceof HTMLElement) control.focus();
    }
  }, [errors]);
  function change(key: keyof ContactDraft, value: string) {
    onChecked(false);
    onChange({ [key]: value });
  }
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {checked ? (
        <Review
          showPrimaryAction={showPrimaryAction}
          contact={draft}
          {...appointment}
          pending={pending}
          retryable={retryable}
          onConfirm={onConfirm}
          onEditSelection={onEditSelection}
          onEdit={() => {
            onChecked(false);
            requestAnimationFrame(() => {
              const control = form.current?.elements.namedItem("name");
              if (control instanceof HTMLElement) control.focus();
            });
          }}
        />
      ) : (
        <form
          id="booking-contact"
          ref={form}
          noValidate
          className="booking-contact flex flex-col gap-4"
          onSubmit={(event) => {
            // Never allow native submission to put contact fields in the URL/network.
            event.preventDefault();
            const nextErrors = validateContact(draft);
            setErrors(nextErrors);
            onChecked(Object.keys(nextErrors).length === 0);
          }}
        >
          <div className="flex flex-col gap-2">
            <h3 className="text-[28px] leading-[34px] font-semibold lg:text-4xl lg:leading-[42px]">
              Вашите данни
            </h3>
            <p className="text-base text-muted-foreground">
              Без регистрация и парола. Използваме ги само за тази резервация.
            </p>
          </div>
          {Object.keys(errors).length > 0 && (
            <Alert variant="destructive" className="rounded-card px-4 py-3.5">
              <AlertTitle>
                Проверете {Object.keys(errors).length}{" "}
                {Object.keys(errors).length === 1 ? "поле" : "полета"}
              </AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {[
                    ...fields,
                    {
                      key: "phoneCountry",
                      summaryLabel: "Държава за телефона",
                    } as const,
                    { key: "note", summaryLabel: "Бележка" } as const,
                  ].map(({ key, summaryLabel }) =>
                    errors[key] ? (
                      <li key={key}>
                        <a
                          href={`#contact-${key}`}
                          className="underline underline-offset-2"
                          onClick={(event) => {
                            event.preventDefault();
                            requestAnimationFrame(() => {
                              const control =
                                form.current?.elements.namedItem(key);
                              if (control instanceof HTMLElement)
                                control.focus();
                            });
                          }}
                        >
                          {summaryLabel}: {errors[key]}
                        </a>
                      </li>
                    ) : null,
                  )}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          <FieldGroup className="gap-6">
            {fields.map(
              ({ key, label, summaryLabel: _summaryLabel, hint, ...input }) => (
                <Fragment key={key}>
                  {key === "phone" && (
                    <Field data-invalid={Boolean(errors.phoneCountry)}>
                      <FieldLabel htmlFor="contact-phoneCountry">
                        Държава за телефона
                      </FieldLabel>
                      <select
                        id="contact-phoneCountry"
                        name="phoneCountry"
                        autoComplete="off"
                        required
                        value={draft.phoneCountry ?? "BG"}
                        onChange={(event) =>
                          change("phoneCountry", event.target.value)
                        }
                        aria-invalid={Boolean(errors.phoneCountry)}
                        aria-describedby={
                          errors.phoneCountry
                            ? "contact-phoneCountry-error"
                            : undefined
                        }
                        className="h-13 w-full min-w-0 rounded-lg border border-input bg-background px-3.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
                      >
                        {countries.map(({ code, name }) => (
                          <option key={code} value={code}>
                            {name} (+{getCountryCallingCode(code)})
                          </option>
                        ))}
                      </select>
                      <FieldError id="contact-phoneCountry-error">
                        {errors.phoneCountry}
                      </FieldError>
                    </Field>
                  )}
                  <Field data-invalid={Boolean(errors[key])}>
                    <FieldLabel htmlFor={`contact-${key}`}>{label}</FieldLabel>
                    {hint && (
                      <FieldDescription id={`contact-${key}-hint`}>
                        {hint}
                      </FieldDescription>
                    )}
                    <Input
                      {...input}
                      id={`contact-${key}`}
                      name={key}
                      required
                      value={draft[key]}
                      onChange={(event) => change(key, event.target.value)}
                      aria-invalid={Boolean(errors[key])}
                      aria-describedby={
                        [
                          errors[key] && `contact-${key}-error`,
                          hint && `contact-${key}-hint`,
                        ]
                          .filter(Boolean)
                          .join(" ") || undefined
                      }
                    />
                    <FieldError id={`contact-${key}-error`}>
                      {errors[key]}
                    </FieldError>
                  </Field>
                </Fragment>
              ),
            )}
            <Field data-invalid={Boolean(errors.note)}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <FieldLabel htmlFor="contact-note">
                  Бележка към салона{" "}
                  <span className="font-normal text-muted-foreground">
                    (по желание)
                  </span>
                </FieldLabel>
                <span
                  id="contact-note-limit"
                  className="text-sm text-muted-foreground tabular-nums"
                >
                  {draft.note.length} / {contactLimits.note}
                </span>
              </div>
              <Textarea
                id="contact-note"
                name="note"
                value={draft.note}
                rows={3}
                className="h-24 field-sizing-fixed"
                onChange={(event) => change("note", event.target.value)}
                aria-invalid={Boolean(errors.note)}
                aria-describedby={
                  errors.note
                    ? "contact-note-limit contact-note-error"
                    : "contact-note-limit"
                }
              />
              <FieldError id="contact-note-error">{errors.note}</FieldError>
            </Field>
          </FieldGroup>
          {showPrimaryAction && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                className="hidden min-h-11 lg:inline-flex"
                onClick={onBack}
              >
                <ChevronLeft aria-hidden="true" data-icon="inline-start" />
                Назад
              </Button>
              <Button type="submit" className="min-h-13 min-w-65">
                Към преглед
              </Button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
