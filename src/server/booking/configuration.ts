import {
  type BookingKeys,
  createBookingOperations,
} from "@/server/booking/operations";

function object(value: unknown, fields?: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error();
  const result = value as Record<string, unknown>;
  if (
    fields &&
    (Object.keys(result).length !== fields.length ||
      fields.some((field) => !Object.hasOwn(result, field)))
  )
    throw new Error();
  return result;
}

function keyRing(value: unknown): BookingKeys["fingerprint"] {
  const ring = object(value, ["currentId", "keys"]);
  const encoded = object(ring.keys);
  const entries = Object.entries(encoded);
  if (
    typeof ring.currentId !== "string" ||
    !Object.hasOwn(encoded, ring.currentId) ||
    entries.length < 1 ||
    entries.length > 16
  )
    throw new Error();
  const keys: Record<string, Buffer> = Object.create(null);
  for (const [id, hex] of entries) {
    if (
      !/^[a-zA-Z0-9_-]{1,64}$/.test(id) ||
      typeof hex !== "string" ||
      !/^[a-f0-9]{64}$/.test(hex)
    )
      throw new Error();
    keys[id] = Buffer.from(hex, "hex");
  }
  return { currentId: ring.currentId, keys };
}

/** Trusted server environment only; invoke lazily, never with request data.
 * Importing this module does not read the environment or open a database.
 * Owns the booking key/application configuration; transport origin and cookie
 * policy live in the HTTP adapter, not here. */
export function readBookingKeys(
  environment: Readonly<Record<string, string | undefined>>,
): BookingKeys {
  try {
    const encoded = environment.SLOTWELL_BOOKING_KEYS;
    if (
      typeof encoded !== "string" ||
      Buffer.byteLength(encoded, "utf8") > 16_384
    )
      throw new Error();
    const value = object(JSON.parse(encoded), ["fingerprint", "replay"]);
    const keys = {
      fingerprint: keyRing(value.fingerprint),
      replay: keyRing(value.replay),
    };
    // Enforce #70's retained-key independence rules with the same private
    // factory the use case uses; it is not re-exposed as a business operation.
    createBookingOperations(keys);
    return keys;
  } catch {
    // Parser/crypto errors may contain configuration. Never retain a cause.
    throw new Error("booking_configuration_unavailable");
  }
}
