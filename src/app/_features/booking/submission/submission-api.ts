import type { RetainedBookingIntent } from "@/app/_features/booking/submission/intent-storage";
import type { ServiceView } from "@/app/_lib/booking/api";
import type { GuestContactDraft } from "@/shared/guest-contact";

export type BookingAgreement = {
  staffId: string;
  serviceIds: readonly string[];
  startsAt: string;
  reviewedServices: readonly Pick<
    ServiceView,
    | "id"
    | "name"
    | "priceCents"
    | "currency"
    | "durationMinutes"
    | "cleanupMinutes"
  >[];
  contact: Omit<GuestContactDraft, "note"> & { note?: string };
};
export type BookingReceipt = {
  appointmentId: string;
  confirmationExpiresAt: string;
  viewToken: string;
};
export type BookingIntentResolution =
  | { state: "pending"; submitBefore: string }
  | { state: "committed"; receipt: BookingReceipt };
export type BookingIntentFence = { state: "fenced" } | { state: "committed" };

type Action = "submit" | "resolve" | "clear";
const paths = {
  submit: "/api/bookings",
  resolve: "/api/booking-intents/resolve",
  clear: "/api/booking-intents/clear",
};
const rejected = {
  invalid_booking: 400,
  invalid_contact: 400,
  origin_forbidden: 403,
  request_too_large: 413,
  unsupported_media_type: 415,
  operation_unavailable: 409,
  review_required: 409,
  selection_unavailable: 409,
  availability_conflict: 409,
  payload_conflict: 409,
  method_not_allowed: 405,
} as const;
type FailureCode =
  | keyof typeof rejected
  | "booking_busy"
  | "recovery_unavailable"
  | "unknown_outcome";

/** No causes, input or raw responses. Every failure requires retaining the pair. */
export class BookingApiError extends Error {
  constructor(
    readonly code: FailureCode,
    readonly outcome: "rejected" | "unknown",
    readonly status: number,
  ) {
    super(code);
    this.name = "BookingApiError";
  }
}
const unknown = (status = 0) =>
  new BookingApiError("unknown_outcome", "unknown", status);
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}
function instant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
function isReceipt(value: unknown): value is BookingReceipt {
  return (
    object(value) &&
    keys(value, ["appointmentId", "confirmationExpiresAt", "viewToken"]) &&
    typeof value.appointmentId === "string" &&
    /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value.appointmentId) &&
    instant(value.confirmationExpiresAt) &&
    typeof value.viewToken === "string" &&
    /^[a-f0-9]{64}$/.test(value.viewToken)
  );
}
function isResolution(value: unknown): value is BookingIntentResolution {
  return (
    object(value) &&
    ((value.state === "pending" &&
      keys(value, ["state", "submitBefore"]) &&
      instant(value.submitBefore)) ||
      (value.state === "committed" &&
        keys(value, ["state", "receipt"]) &&
        isReceipt(value.receipt)))
  );
}
function isFence(value: unknown): value is BookingIntentFence {
  return (
    object(value) &&
    keys(value, ["state"]) &&
    (value.state === "fenced" || value.state === "committed")
  );
}
async function readJson(response: Response): Promise<unknown> {
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
      response.headers.get("content-type") ?? "",
    )
  )
    throw unknown(response.status);
  const reader = response.body?.getReader();
  if (!reader) throw unknown(response.status);
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let size = 0;
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) throw unknown(response.status);
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch {
    await reader.cancel().catch(() => {});
    throw unknown(response.status);
  } finally {
    reader.releaseLock();
  }
}
function failure(
  action: Action,
  status: number,
  body: unknown,
): BookingApiError {
  if (!object(body) || !keys(body, ["error"]) || !object(body.error))
    return unknown(status);
  const error = body.error;
  const code = error.code;
  if (
    status === 503 &&
    keys(error, ["code", "outcome"]) &&
    error.outcome === "unknown" &&
    (code === "recovery_unavailable" ||
      (action === "submit" && code === "booking_busy"))
  )
    return new BookingApiError(code, "unknown", status);
  if (
    typeof code !== "string" ||
    !Object.hasOwn(rejected, code) ||
    !keys(error, ["code"])
  )
    return unknown(status);
  const known = code as keyof typeof rejected;
  const submitOnly = [
    "invalid_contact",
    "review_required",
    "selection_unavailable",
    "availability_conflict",
    "payload_conflict",
  ].includes(known);
  if (
    rejected[known] !== status ||
    (submitOnly && action !== "submit") ||
    (known === "method_not_allowed" && action === "submit")
  )
    return unknown(status);
  return new BookingApiError(known, "rejected", status);
}
async function request<T>(
  action: Action,
  body: () => unknown,
  accepts: (value: unknown) => value is T,
  signal?: AbortSignal,
): Promise<T> {
  let status = 0;
  try {
    // Serialize before the first await: caller edits cannot alter an in-flight agreement.
    const serialized = JSON.stringify(body());
    const response = await fetch(paths[action], {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: serialized,
      signal,
      mode: "same-origin",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    status = response.status;
    const value = await readJson(response);
    if (status !== 200) throw failure(action, status, value);
    if (!accepts(value)) throw unknown(status);
    return value;
  } catch (error) {
    if (error instanceof BookingApiError) throw error;
    throw unknown(status);
  }
}
function copyPair(pair: RetainedBookingIntent) {
  return { operationId: pair.operationId, credential: pair.credential };
}

/** Caller must await durable allocation first. No automatic retry or replacement. */
export function submitBookingIntent(
  pair: RetainedBookingIntent,
  agreement: BookingAgreement,
  signal?: AbortSignal,
): Promise<BookingReceipt> {
  return request(
    "submit",
    () => {
      const { staffId, startsAt, contact } = agreement;
      const booking = {
        staffId,
        serviceIds: [...agreement.serviceIds],
        startsAt,
        reviewedServices: agreement.reviewedServices.map(
          ({
            id,
            name,
            priceCents,
            currency,
            durationMinutes,
            cleanupMinutes,
          }) => ({
            id,
            name,
            priceCents,
            currency,
            durationMinutes,
            cleanupMinutes,
          }),
        ),
        contact: {
          name: contact.name,
          phone: contact.phone,
          email: contact.email,
          note: contact.note,
          phoneCountry: contact.phoneCountry,
        },
      };
      return { ...copyPair(pair), booking };
    },
    isReceipt,
    signal,
  );
}
/** Pending is a snapshot, not permission to remove or replace an intent. */
export function resolveRetainedBookingIntent(
  pair: RetainedBookingIntent,
  signal?: AbortSignal,
): Promise<BookingIntentResolution> {
  return request("resolve", () => copyPair(pair), isResolution, signal);
}
/** Use only for explicit clear, via clearRetainedBookingIntent. Committed is not forget permission. */
export function requestBookingIntentFence(
  pair: RetainedBookingIntent,
  signal?: AbortSignal,
): Promise<BookingIntentFence> {
  return request("clear", () => copyPair(pair), isFence, signal);
}
