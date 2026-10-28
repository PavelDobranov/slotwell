export type BookingTransport = {
  origin: string;
  secureCookies: boolean;
};

/** Trusted server environment only; invoke lazily, never with request data.
 * Importing this module does not read the environment or open a database.
 * Owns the transport origin and the cookie policy derived from it; the booking
 * key/application configuration lives in the booking capability, not here.
 * Never derive the origin from Host/forwarded headers or request data. */
export function readBookingTransport(
  environment: Readonly<Record<string, string | undefined>>,
): BookingTransport {
  try {
    const origin = environment.SLOTWELL_BOOKING_ORIGIN;
    if (typeof origin !== "string") throw new Error();
    const url = new URL(origin);
    if (
      url.origin !== origin ||
      (url.protocol !== "https:" &&
        (url.protocol !== "http:" ||
          !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    )
      throw new Error();
    // Secure-cookie policy follows HTTPS; loopback HTTP is not deployment approval.
    return { origin, secureCookies: url.protocol === "https:" };
  } catch {
    // URL errors may contain configuration. Never retain a cause.
    throw new Error("booking_configuration_unavailable");
  }
}
