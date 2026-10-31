import { formatDuration } from "@/app/_lib/duration";
import type {
  ConfirmationCredential,
  ConfirmationView,
} from "@/server/booking";

export type ConfirmationDisplay = ReturnType<typeof formatConfirmation>;

export function parseConfirmationFragment(
  hash: string,
): ConfirmationCredential | null {
  const params = new URLSearchParams(hash.slice(1));
  const appointmentId = params.get("appointmentId");
  const viewToken = params.get("viewToken");
  if (
    params.size !== 2 ||
    !appointmentId ||
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(appointmentId) ||
    !viewToken ||
    !/^[a-f0-9]{64}$/.test(viewToken)
  )
    return null;
  return { appointmentId, viewToken };
}

// The caller owns request lifetime and checks freshness before reading the body.
export function fetchConfirmation(
  credential: ConfirmationCredential,
  signal: AbortSignal,
) {
  return fetch("/api/confirmations/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credential),
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    redirect: "error",
    signal,
  });
}

export function formatConfirmation(view: ConfirmationView) {
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
