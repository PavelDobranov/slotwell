import {
  type CountryCode,
  isSupportedCountry,
  parsePhoneNumberFromString,
} from "libphonenumber-js/max";

/** Shared by browser drafts and server validation. Never use contact data as authorization. */
export type GuestContactDraft = {
  name: string;
  phone: string;
  email: string;
  note: string;
  phoneCountry?: string;
};
export type ContactErrors = Partial<Record<keyof GuestContactDraft, string>>;
export const contactLimits = {
  name: 100,
  phone: 32,
  email: 254,
  note: 1000,
} as const;

// Pragmatic unquoted email syntax; not mailbox existence or ownership verification.
function validEmail(email: string): boolean {
  const [local, domain, extra] = email.split("@");
  return Boolean(
    local &&
      domain &&
      extra === undefined &&
      /^[^\s.<>(),;:\\"[\]]+(?:\.[^\s.<>(),;:\\"[\]]+)*$/.test(local) &&
      /^[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)+$/i.test(
        domain,
      ),
  );
}

export type GuestContactResult =
  | {
      success: true;
      contact: {
        name: string;
        phone: string;
        normalizedPhone: string;
        email: string;
        note: string;
      };
    }
  | { success: false; errors: ContactErrors };

/** UTF-16 limits match browser counters. Trim required fields only; never truncate,
 * case-fold email, rewrite names, or look up existing clients. Validity is not ownership.
 * The caller supplies business configuration when it differs from the BG default.
 */
export function parseGuestContact(
  input: unknown,
  defaultPhoneCountry = "BG",
): GuestContactResult {
  const draft: Record<string, unknown> =
    input !== null && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const errors: ContactErrors = {};
  const name = typeof draft.name === "string" ? draft.name.trim() : "";
  const phone = typeof draft.phone === "string" ? draft.phone.trim() : "";
  const email = typeof draft.email === "string" ? draft.email.trim() : "";
  const note = draft.note === undefined ? "" : draft.note;
  const country =
    draft.phoneCountry === undefined ? defaultPhoneCountry : draft.phoneCountry;
  const supportedCountry =
    typeof country === "string" && isSupportedCountry(country);

  if (!name) errors.name = "Въведете име.";
  else if (name.length > contactLimits.name)
    errors.name = "Името трябва да е до 100 знака.";
  if (!phone) errors.phone = "Въведете телефонен номер.";
  else if (phone.length > contactLimits.phone)
    errors.phone = "Телефонът трябва да е до 32 знака.";
  if (!supportedCountry)
    errors.phoneCountry = "Изберете валидна държава за телефона.";

  let normalizedPhone = "";
  if (!errors.phone && supportedCountry) {
    const international = phone.startsWith("00") ? `+${phone.slice(2)}` : phone;
    const parsed = /^\+?[\d\s().-]+$/.test(international)
      ? parsePhoneNumberFromString(international, {
          defaultCountry: country as CountryCode,
          extract: false,
        })
      : undefined;
    if (!parsed || parsed.ext || !parsed.isValid())
      errors.phone =
        "Въведете валиден телефонен номер за избраната държава или с международен код (+ или 00), без вътрешен номер.";
    else normalizedPhone = parsed.number;
  }
  if (!email) errors.email = "Въведете имейл адрес.";
  else if (email.length > contactLimits.email)
    errors.email = "Имейлът трябва да е до 254 знака.";
  else if (!validEmail(email))
    errors.email = "Въведи валиден имейл, например ivan@example.com.";

  if (typeof note !== "string") errors.note = "Въведете бележка като текст.";
  else if (note.length > contactLimits.note)
    errors.note = "Бележката трябва да е до 1000 знака.";
  if (Object.keys(errors).length > 0 || typeof note !== "string")
    return { success: false, errors };
  return {
    success: true,
    contact: { name, phone, normalizedPhone, email, note },
  };
}
