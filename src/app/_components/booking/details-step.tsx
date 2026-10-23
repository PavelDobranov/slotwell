import { useEffect, useRef, useState } from "react";

import { Button } from "@/app/_components/button";
import {
  Field,
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
}: {
  draft: ContactDraft;
  onChange: (draft: Partial<ContactDraft>) => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  const [errors, setErrors] = useState<ContactErrors>({});
  const [checked, setChecked] = useState(false);
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
    setChecked(false);
    onChange({ [key]: value });
  }
  return (
    <form
      ref={form}
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        // Never allow native submission to put contact fields in the URL/network.
        event.preventDefault();
        const nextErrors = validateContact(draft);
        setErrors(nextErrors);
        setChecked(Object.keys(nextErrors).length === 0);
        if (nextErrors.note) setNoteOpen(true);
      }}
    >
      <p className="text-sm text-muted-foreground">
        Всички полета без бележката са задължителни. Използвай измислени данни
        за демонстрацията. Данните остават само в паметта на тази страница. Не
        проверяваме самоличност или собственост на телефон и имейл.
      </p>
      <FieldGroup>
        {fields.map(({ key, label, ...input }) => (
          <Field key={key} data-invalid={Boolean(errors[key])}>
            <FieldLabel htmlFor={`contact-${key}`}>{label}</FieldLabel>
            <Input
              {...input}
              id={`contact-${key}`}
              name={key}
              required
              className="min-h-11"
              value={draft[key]}
              onChange={(event) => change(key, event.target.value)}
              aria-invalid={Boolean(errors[key])}
              aria-describedby={
                errors[key] ? `contact-${key}-error` : undefined
              }
            />
            <FieldError id={`contact-${key}-error`}>{errors[key]}</FieldError>
          </Field>
        ))}
        <details
          open={noteOpen}
          onToggle={(event) => setNoteOpen(event.currentTarget.open)}
        >
          <summary className="min-h-11 cursor-pointer rounded-sm py-3 font-medium focus-visible:outline-2 focus-visible:outline-ring">
            Добави бележка (по желание)
          </summary>
          <Field data-invalid={Boolean(errors.note)}>
            <FieldLabel htmlFor="contact-note">Бележка (по желание)</FieldLabel>
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
      <Button type="submit" className="min-h-11 self-start">
        Провери данните
      </Button>
      <output className="text-sm text-muted-foreground">
        {checked
          ? "Данните са валидни за демонстрацията. Все още няма резервация."
          : ""}
      </output>
      {checked && (
        <Button
          type="button"
          className="min-h-11 self-start"
          disabled={pending}
          onClick={onConfirm}
        >
          {pending ? "Потвърждаваме…" : "Потвърди демо резервация"}
        </Button>
      )}
      <p className="text-sm text-muted-foreground">
        Това е само демонстрация, не реално записване. Не изпращаме имейл и не
        създаваме достъп за управление на резервация.
      </p>
    </form>
  );
}
