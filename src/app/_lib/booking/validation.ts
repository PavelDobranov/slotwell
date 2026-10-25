import type { ContactDraft } from "@/app/_lib/booking/state";

export type ContactErrors = Partial<Record<keyof ContactDraft, string>>;
export const contactLimits = {
  name: 100,
  phone: 32,
  email: 254,
  note: 1000,
} as const;

/** Plausibility only, not identity verification. Never mutate or truncate the draft. */
export function validateContact(draft: ContactDraft): ContactErrors {
  const errors: ContactErrors = {};
  const name = draft.name.trim();
  const phone = draft.phone.trim();
  const email = draft.email.trim();
  if (!name) errors.name = "Въведи име.";
  else if (name.length > contactLimits.name)
    errors.name = "Името трябва да е до 100 знака.";

  if (!phone) errors.phone = "Въведи телефон.";
  else if (phone.length > contactLimits.phone)
    errors.phone = "Телефонът трябва да е до 32 знака.";
  else if (
    !/^(?:0[1-9]\d{7,8}|(?:\+|00)[1-9]\d{6,14})$/.test(
      phone.replace(/[\s().-]/g, ""),
    )
  )
    errors.phone =
      "Въведи телефон с код на държавата или български номер с начална 0.";

  if (!email) errors.email = "Въведи имейл.";
  else if (email.length > contactLimits.email)
    errors.email = "Имейлът трябва да е до 254 знака.";
  else if (!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email))
    errors.email = "Въведи валиден имейл, например ivan@example.com.";

  if (draft.note.length > contactLimits.note)
    errors.note = "Бележката трябва да е до 1000 знака.";
  return errors;
}
