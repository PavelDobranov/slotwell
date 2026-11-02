import { getCountries, getCountryCallingCode } from "libphonenumber-js/max";
import { useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/app/_components/alert";
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
import type { PersistedContact } from "@/app/_features/booking/context";
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

/** Field errors and focus stay local; the owner retains the memory-only draft. */
export function ContactForm({
  contact,
  defaultPhoneCountry,
  onChange,
  onReview,
  onBack,
}: {
  contact: PersistedContact;
  defaultPhoneCountry: string;
  onChange: (draft: Partial<PersistedContact>) => void;
  onReview: () => void;
  onBack: () => void;
}) {
  const [errors, setErrors] = useState<ContactErrors>({});
  const form = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={form}
      noValidate
      className="booking-contact flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        const result = parseGuestContact(contact, defaultPhoneCountry);
        const nextErrors = result.success ? {} : result.errors;
        setErrors(nextErrors);
        if (result.success) onReview();
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
          <AlertDescription>Коригирайте отбелязаните полета.</AlertDescription>
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
            value={contact.phoneCountry ?? defaultPhoneCountry}
            onChange={(event) => onChange({ phoneCountry: event.target.value })}
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
              value={contact[key]}
              onChange={(event) => onChange({ [key]: event.target.value })}
              aria-invalid={Boolean(errors[key])}
              aria-describedby={`persisted-${key}-error${key === "phone" ? " persisted-phone-hint" : ""}`}
            />
            {key === "phone" && (
              <FieldDescription id="persisted-phone-hint">
                Може да използвате международен код (+ или 00), без вътрешен
                номер.
              </FieldDescription>
            )}
            <FieldError id={`persisted-${key}-error`}>{errors[key]}</FieldError>
          </Field>
        ))}
        <Field data-invalid={Boolean(errors.note)}>
          <FieldLabel htmlFor="persisted-note">Бележка (по желание)</FieldLabel>
          <Textarea
            id="persisted-note"
            name="note"
            rows={3}
            value={contact.note}
            onChange={(event) => onChange({ note: event.target.value })}
            aria-invalid={Boolean(errors.note)}
            aria-describedby="persisted-note-limit persisted-note-error"
          />
          <FieldDescription id="persisted-note-limit">
            {contact.note.length} / {contactLimits.note}
          </FieldDescription>
          <FieldError id="persisted-note-error">{errors.note}</FieldError>
        </Field>
      </FieldGroup>
      <div className="flex flex-wrap justify-between gap-3">
        <Button type="button" variant="outline" onClick={onBack}>
          Назад към часа
        </Button>
        <Button type="submit">Прегледай резервацията</Button>
      </div>
    </form>
  );
}
