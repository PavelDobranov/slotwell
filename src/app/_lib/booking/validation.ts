import type { ContactDraft } from "@/app/_lib/booking/state";
import { type ContactErrors, parseGuestContact } from "@/shared/guest-contact";

export { type ContactErrors, contactLimits } from "@/shared/guest-contact";

/** UI errors use the server's pure parser, without replacing or truncating the draft. */
export function validateContact(draft: ContactDraft): ContactErrors {
  const result = parseGuestContact(draft);
  return result.success ? {} : result.errors;
}
