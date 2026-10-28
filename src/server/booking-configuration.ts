// Temporary compatibility shim. Booking key/application configuration now lives
// in src/server/booking/configuration.ts (private to the capability, reached
// through its public interface @/server/booking); transport origin and cookie
// policy live in the HTTP adapter at src/server/http/booking-configuration.ts.
//
// This flat path composes both to preserve the pre-migration
// `@/server/booking-configuration` surface for the colocated configuration test
// (booking-configuration.test) until it relocates in #105. Validation runs in
// the original order — transport origin first, then keys — and any failure is
// the same generic booking_configuration_unavailable, never a retained cause.

import type { BookingKeys } from "@/server/booking";
import { readBookingKeys } from "@/server/booking";
import {
  type BookingTransport,
  readBookingTransport,
} from "@/server/http/booking-configuration";

export type BookingConfiguration = BookingTransport & { keys: BookingKeys };

/** Trusted server environment only; invoke lazily, never with request data.
 * Importing this module does not read the environment or open a database. */
export function readBookingConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): BookingConfiguration {
  const transport = readBookingTransport(environment);
  const keys = readBookingKeys(environment);
  return { ...transport, keys };
}
