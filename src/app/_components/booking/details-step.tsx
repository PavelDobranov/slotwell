import { ArrowLeft, ArrowRight, CircleAlert, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
import { Separator } from "@/app/_components/separator";
import { Textarea } from "@/app/_components/textarea";
import type { ContactDraft } from "@/app/_lib/booking/state";
import {
  type ContactErrors,
  contactLimits,
  validateContact,
} from "@/app/_lib/booking/validation";

const fields = [
  {
    key: "name",
    label: "Име",
    type: "text",
    autoComplete: "name",
    inputMode: "text",
  },
  {
    key: "phone",
    label: "Телефон",
    type: "tel",
    autoComplete: "tel",
    inputMode: "tel",
  },
  {
    key: "email",
    label: "Имейл",
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
    services: { name: string; durationMinutes: number; priceCents: number }[];
    salonName: string;
    address: string;
    durationMinutes: number;
    priceCents: number;
  };
  onBack: () => void;
  onEditSelection: (step: "services" | "staff" | "time") => void;
}) {
  const [errors, setErrors] = useState<ContactErrors>({});
  const [noteOpen, setNoteOpen] = useState(draft.note !== "");
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const first = (["name", "phone", "email", "note"] as const).find(
      (key) => errors[key],
    );
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
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            // Never allow native submission to put contact fields in the URL/network.
            event.preventDefault();
            const nextErrors = validateContact(draft);
            setErrors(nextErrors);
            onChecked(Object.keys(nextErrors).length === 0);
            if (nextErrors.note) setNoteOpen(true);
          }}
        >
          <h3 className="text-xl font-semibold">Твоите данни</h3>
          <p className="text-sm text-muted-foreground">
            Всички полета без бележката са задължителни. Използваме ги само за
            тази резервация.
          </p>
          {Object.keys(errors).length > 0 && (
            <Alert variant="destructive" className="px-4 py-3.5">
              <CircleAlert aria-hidden="true" />
              <AlertTitle>
                Провери {Object.keys(errors).length}{" "}
                {Object.keys(errors).length === 1 ? "поле" : "полета"}, за да
                продължиш
              </AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {[...fields, { key: "note", label: "Бележка" } as const].map(
                    ({ key, label }) =>
                      errors[key] ? (
                        <li key={key}>
                          <a
                            href={`#contact-${key}`}
                            className="inline-flex min-h-11 items-center underline underline-offset-4"
                            onClick={(event) => {
                              event.preventDefault();
                              if (key === "note") setNoteOpen(true);
                              requestAnimationFrame(() => {
                                const control =
                                  form.current?.elements.namedItem(key);
                                if (control instanceof HTMLElement)
                                  control.focus();
                              });
                            }}
                          >
                            {label} — {errors[key]}
                          </a>
                        </li>
                      ) : null,
                  )}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          <FieldGroup className="gap-6">
            {fields.map(({ key, label, ...input }) => (
              <Field key={key} data-invalid={Boolean(errors[key])}>
                <FieldLabel htmlFor={`contact-${key}`}>{label}</FieldLabel>
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
                      key === "phone" && "contact-phone-hint",
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined
                  }
                />
                <FieldError id={`contact-${key}-error`}>
                  {errors[key]}
                </FieldError>
                {key === "phone" && (
                  <FieldDescription id="contact-phone-hint">
                    Например 0888 123 456
                  </FieldDescription>
                )}
              </Field>
            ))}
            <details
              open={noteOpen}
              onToggle={(event) => setNoteOpen(event.currentTarget.open)}
            >
              <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 rounded-sm py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                <Plus aria-hidden="true" className="size-4" />
                Добави бележка (по желание)
              </summary>
              <Field data-invalid={Boolean(errors.note)}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <FieldLabel htmlFor="contact-note">
                    Бележка (по желание)
                  </FieldLabel>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {draft.note.length} / {contactLimits.note}
                  </span>
                </div>
                <Textarea
                  id="contact-note"
                  name="note"
                  value={draft.note}
                  rows={3}
                  onChange={(event) => change("note", event.target.value)}
                  aria-invalid={Boolean(errors.note)}
                  aria-describedby={
                    errors.note
                      ? "contact-note-limit contact-note-error"
                      : "contact-note-limit"
                  }
                />
                <p
                  id="contact-note-limit"
                  className="text-sm text-muted-foreground"
                >
                  До {contactLimits.note} знака. Не включвай чувствителни данни.
                </p>
                <FieldError id="contact-note-error">{errors.note}</FieldError>
              </Field>
            </details>
          </FieldGroup>
          <Separator />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              className="hidden min-h-11 lg:inline-flex"
              onClick={onBack}
            >
              <ArrowLeft aria-hidden="true" data-icon="inline-start" />
              Назад
            </Button>
            {showPrimaryAction && (
              <Button type="submit" className="min-h-11">
                Провери данните
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
